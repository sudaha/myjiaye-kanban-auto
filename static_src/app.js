(function () {
  "use strict";
  // 双平台静态看板：数据来自 data/<platform>/*.json，筛选与分页在浏览器完成。
  var PLAT_META = {
    zycg: { name: "央采询价招投标", sub: "中央政府采购网 · 电子询价「需求公告」", hint: "可勾选多份公告，一键打包下载询价通知书 PDF" },
    poly: { name: "保利集团招标", sub: "中国保利集团招标采购供应链平台 · 全量项目", hint: "保利以工程/服务类为主，勾选「只看 IT 相关」筛硬件项目" },
    rail: { name: "国铁商城批采招投标", sub: "国铁商城批量采购专区 + 国铁采购平台相关招投标", hint: "可切换查看两个来源的项目公告" },
    bid: { name: "招标公告·新源", sub: "央采主站（招标/征求/更正）+ 中国政府采购网（中央/地方）· 已筛 IT 硬件", hint: "点开卡片跳转原公告页查看采购人与预算；关键词/日期筛选可用" },
    docs: { name: "商务单证", sub: "报价单 / 货物签收单 · 整块粘贴信息，一键生成下载", hint: "选择报价单或货物签收单，整块粘贴信息后生成正式文件；支持 PDF / Word / Excel 三种版本（数据不上传）" },
    picker: { name: "选型助手", sub: "基于央采卖场真实成交记录建库 · 需求一键选型 + 成交价参考", hint: "粘贴需求文本或挑一条公告，按品类/CPU/品牌匹配机型库（含真实成交价带）" },
    records: { name: "参与投标记录", sub: "参与项目档案留存 · 中标率分析 · 竞品型号价格查漏补缺", hint: "点央采/保利卡片上的「参与」自动归档；此处按发布标书时间与品类分类，长期积累不删除" }
  };
  function platFromHash() {
    var h = (location.hash || "").replace("#", "");
    // bid（招标公告·新源）2026-11-17 应用户要求暂时下线，#bid 回退到央采
    return h === "poly" || h === "rail" || h === "picker" || h === "docs" || h === "records" ? h : "zycg";
  }
  var plat = platFromHash();
  var state = { page: 1, pageSize: 20, total: 0, filters: {}, items: [], loaded: false, picked: {}, availableDates: {}, dateBreakdown: {}, dateMonth: null, railSource: "", zycgSource: "", abandoned: {} };
  // 我方重点品牌（国铁商城已上传/有授权的品牌口径，2026-11-20）：卡片品牌行据此提示能否参与
  var FOCUS_BRANDS = ["华为", "联想", "清华同方", "软通华方", "紫光"];
  var ABANDON_TOKEN = "jiaye-abandon-95306"; // 与 functions/api/abandon.js 保持一致的轻量写口令
  var picker = {
    products: null,          // data/products.json 的 products 数组
    meta: null,              // 库元信息（updated_at / product_count）
    zycgList: null,          // 央采公告列表（供「选一条公告」用）
    notices: null,           // data/mall_notices.json 的 notices 映射（成交公告原文缓存）
    noticeFiltered: [],      // 当前搜索/品类筛选后的央采公告（左侧常显列表）
    noticeInitPromise: null, // 公告选择器初始化中的 Promise，防止一键跳转与平台加载竞态
    currentNotice: null,     // 当前正在对比的公告详情
    modelSpecs: null,        // 官网/公开平台核验过的具体型号规格与来源
    browsePage: 1, browseTotal: 0, browseSize: 50
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    if (isNaN(n)) return null;
    return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  }
  function budgetText(it) {
    var m = money(it.budget_num);
    return m ? m + " 元" : "—";
  }
  var DATA_V = (document.currentScript && (document.currentScript.src.match(/[?&]v=([^&]+)/) || [])[1]) || Date.now();
  function getJSON(url) {
    // no-store + 构建版本参数：避免 CDN/浏览器沿用部署前旧 JSON（例如国铁62条旧快照）。
    var sep = url.indexOf("?") >= 0 ? "&" : "?";
    return fetch(url + sep + "v=" + encodeURIComponent(DATA_V), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function pdata(name) { return "data/" + plat + "/" + name; }

  // ---------- 平台切换 ----------
  function setPlatform(p, push) {
    plat = p;
    if (push) { location.hash = p; }
    document.querySelectorAll(".plat").forEach(function (b) {
      b.classList.toggle("on", b.dataset.plat === p);
    });
    var m = PLAT_META[p];
    $("plat-hint").textContent = m.hint;
    var isPicker = p === "picker";
    var isDocs = p === "docs";
    var isRecords = p === "records";
    var noList = isPicker || isDocs || isRecords;
    $("filterbar").classList.toggle("hide", noList);
    if ($("rail-source-status")) $("rail-source-status").classList.toggle("hide", p !== "rail");
    if ($("zycg-source-status")) $("zycg-source-status").classList.toggle("hide", p !== "zycg");
    $("f-it-wrap").classList.toggle("hide", p !== "poly");
    $("batchbar").classList.toggle("hide", p !== "zycg" && p !== "poly");
    if ($("btn-zip")) $("btn-zip").textContent = p === "poly" ? "⬇ 打包下载选中项目资料" : "⬇ 打包下载选中 PDF";
    if ($("notice-date-picker")) $("notice-date-picker").classList.toggle("hide", p !== "zycg" && p !== "poly" && p !== "rail");
    $("pickerbox").classList.toggle("hide", !isPicker);
    if ($("docsbox")) $("docsbox").classList.toggle("hide", !isDocs);
    if ($("recordsbox")) $("recordsbox").classList.toggle("hide", !isRecords);
    $("list").classList.toggle("hide", noList);
    $("pager").classList.toggle("hide", noList);
    document.querySelector(".brand h1").textContent = isPicker
      ? "选型助手 · 成交机型库" : m.name + " · 佳业采购雷达";
    document.querySelector(".brand .sub").textContent = m.sub;
    document.title = isPicker ? "选型助手 · 成交机型库" : m.name + " · 佳业采购雷达";
    if (isPicker) {
      $("st-total-lab").textContent = "机型总数";
      $("st-active-lab").textContent = "有成交价";
      $("st-latest-lab").textContent = "最后更新";
    } else if (isDocs) {
      $("st-total-lab").textContent = "单证类型";
      $("st-active-lab").textContent = "模板";
      $("st-latest-lab").textContent = "生成方式";
    } else if (isRecords) {
      $("st-total-lab").textContent = "参与项目";
      $("st-active-lab").textContent = "我方中标";
      $("st-latest-lab").textContent = "中标率";
    } else if (p === "bid") {
      $("st-total-lab").textContent = "IT 公告";
      $("st-active-lab").textContent = "覆盖天数";
      $("st-latest-lab").textContent = "最新日期";
    } else {
      $("st-total-lab").textContent = "公告总数";
      $("st-active-lab").textContent = "进行中";
      $("st-latest-lab").textContent = "最新日期";
    }
    state.loaded = false; state.items = []; state.page = 1; state.picked = {}; state.filters = {};
    state.availableDates = {}; state.dateMonth = null;
    ["f-keyword", "f-date"].forEach(function (i) { if ($(i)) $(i).value = ""; });
    if ($("f-date-btn")) $("f-date-btn").textContent = "选择公告日期";
    if ($("date-pop")) $("date-pop").classList.add("hide");
    $("f-category").value = ""; $("f-status").value = ""; $("f-it").checked = false;
    updateSel();
    if (isDocs) {
      $("result-count").textContent = "";
      $("upd-time").textContent = "";
      $("st-total").textContent = "2";
      $("st-active").textContent = "佳业同创";
      $("st-latest").textContent = "本地生成";
      return;
    }
    if (isPicker) {
      $("result-count").textContent = "";
      $("upd-time").textContent = "";
      loadPickerStatus();
      initPickerNoticeSelect();
      return;
    }
    if (isRecords) {
      $("result-count").textContent = "";
      $("upd-time").textContent = "";
      renderRecords();
      return;
    }
    loadStatus(); loadCategories(); loadList();
  }

  // ---------- 状态 / 品类 ----------
  function loadStatus() {
    return getJSON(pdata("status.json")).then(function (s) {
      $("st-total").textContent = s.total;
      $("st-active").textContent = s.active != null ? s.active : "-";
      $("st-latest").textContent = (s.latest_date || "-").slice(5);
      var snap = s.last_fetch || s.updated_at || "-";
      var nt = "";
      if ((plat === "zycg" || plat === "poly") && s.new_count > 0) {
        nt = " · 新增 " + s.new_count + " 条（" + (s.new_days || []).join("、") + "）";
      }
      $("upd-time").textContent = snap !== "-" ? "数据快照 " + snap + nt : "";
      $("foot-note").textContent = "数据来源：" + PLAT_META[plat].sub + " · 快照 " + snap + " · 每天 9/13/17/22 点自动更新";
    }).catch(function () { });
  }
  function loadCategoryBadges() {
      ["zycg", "poly", "rail"].forEach(function (p) {
      getJSON("data/" + p + "/status.json").then(function (s) {
        $("n-" + p).textContent = s.total;
      }).catch(function () { });
    });
    getJSON("data/products.json").then(function (d) {
      $("n-picker").textContent = d.product_count;
    }).catch(function () { });
  }
  function loadCategories() {
    // 捕获发起请求时的平台；切换平台后旧请求即使较晚返回，也不能覆盖新平台品类。
    var requestPlat = plat;
    return getJSON("data/" + requestPlat + "/categories.json").then(function (d) {
      if (plat !== requestPlat) return;
      var sel = $("f-category");
      sel.innerHTML = '<option value="">全部品类</option>' +
        (d.categories || []).map(function (c) {
          return '<option value="' + esc(c) + '">' + esc(c) + "</option>";
        }).join("");
    }).catch(function () { });
  }

  // ---------- 公告日期选择器：仅实际有公告的日期可点 ----------
  // 口径统一为公告自身发布日期（export_static.py 已进 pub_date）：央采询价=发布日期、
  // 单独委托=公告发布日期（seen_date 采集日期仅在详情弹层展示）、国铁/保利=公告发布日期
  function itemDay(it) { return String(it.pub_date || it.publish_date || "").slice(0, 10); }
  // 日期弹窗里每个日期按分类标注条数：央采=电询/单托，国铁=批采/公招，保利单一来源显示总数
  var DATE_SRC_SHORT = {
    zycg: { "询价": ["电询", "电询"], "委托": ["单托", "单托"] },
    rail: { "mall.95306.cn批量采购专区": ["批采", "批采"], "cg.95306.cn公开采购公告": ["公招", "公招"] }
  };
  function dateSegParts(iso) {
    var SHORT = DATE_SRC_SHORT[plat];
    var bd = (state.dateBreakdown || {})[iso] || {};
    var parts = [];
    if (SHORT) Object.keys(SHORT).forEach(function (s) { if (bd[s]) parts.push({ short: SHORT[s][0] + bd[s], full: SHORT[s][1] + bd[s] + "条" }); });
    return parts;
  }
  function initAvailableDates() {
    state.availableDates = {};
    state.dateBreakdown = {};
    state.items.forEach(function (it) {
      var d = itemDay(it);
      if (d) {
        state.availableDates[d] = (state.availableDates[d] || 0) + 1;
        var s = it.source || "其他";
        (state.dateBreakdown[d] = state.dateBreakdown[d] || {})[s] = (state.dateBreakdown[d][s] || 0) + 1;
      }
    });
    var days = Object.keys(state.availableDates).sort();
    var anchor = ($("f-date") && $("f-date").value) || days[days.length - 1] || new Date().toISOString().slice(0, 10);
    var a = anchor.split("-");
    state.dateMonth = new Date(+a[0], +a[1] - 1, 1);
    renderDateCalendar();
  }
  function dateISO(y, m, d) {
    return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  function renderDateCalendar() {
    if (!state.dateMonth || !$("date-grid")) return;
    var y = state.dateMonth.getFullYear(), m = state.dateMonth.getMonth();
    $("date-month").textContent = y + "年" + (m + 1) + "月";
    var first = new Date(y, m, 1).getDay(), total = new Date(y, m + 1, 0).getDate();
    var prevTotal = new Date(y, m, 0).getDate();
    var cells = [];
    for (var i = 0; i < 42; i++) {
      var day = i - first + 1, cy = y, cm = m, outside = false;
      if (day < 1) { day = prevTotal + day; cm = m - 1; outside = true; if (cm < 0) { cm = 11; cy--; } }
      else if (day > total) { day -= total; cm = m + 1; outside = true; if (cm > 11) { cm = 0; cy++; } }
      var iso = dateISO(cy, cm, day), count = state.availableDates[iso] || 0;
      var selected = $("f-date") && $("f-date").value === iso;
      var segs = count ? dateSegParts(iso) : [];
      var segHtml = count ? '<small class="cat">' + (segs.length ? segs.map(function (p) { return p.short; }).join("<i>·</i>") : count) + "</small>" : "";
      var segTitle = count ? (segs.length ? segs.map(function (p) { return p.full; }).join(" / ") : count + "条公告") : "";
      cells.push('<button type="button" class="date-day' + (outside ? " outside" : "") +
        (count ? " available" : " unavailable") + (selected ? " selected" : "") + '" data-date="' + iso + '"' +
        (count ? ' title="' + iso + ' · ' + segTitle + '"' : ' disabled title="该日无公告"') + '>' +
        day + segHtml + "</button>");
    }
    $("date-grid").innerHTML = cells.join("");
    $("date-grid").querySelectorAll(".date-day.available").forEach(function (b) {
      b.addEventListener("click", function () {
        $("f-date").value = b.dataset.date;
        var btnSegs = dateSegParts(b.dataset.date);
        $("f-date-btn").textContent = b.dataset.date + "（" + (btnSegs.length ? btnSegs.map(function (p) { return p.short; }).join("·") : state.availableDates[b.dataset.date] + "条") + "）";
        $("date-pop").classList.add("hide");
        state.filters = currentFilters(); state.page = 1; loadList();
      });
    });
  }
  function shiftDateMonth(delta) {
    if (!state.dateMonth) return;
    state.dateMonth = new Date(state.dateMonth.getFullYear(), state.dateMonth.getMonth() + delta, 1);
    renderDateCalendar();
  }

  // ---------- 筛选 ----------
  function currentFilters() {
    return {
      keyword: $("f-keyword").value.trim(),
      category: $("f-category").value,
      brand: "",
      status: $("f-status").value,
      it: $("f-it").checked,
      date: $("f-date") ? $("f-date").value : ""
    };
  }
  function match(it, f) {
    if (f.keyword) {
      var kw = f.keyword.toLowerCase();
      var hay = [it.title, it.enquiry_name, it.org_name, it.purchase_company, it.brands, it.enquiry_no]
        .join(" ").toLowerCase();
      if (hay.indexOf(kw) < 0) return false;
    }
    if (f.category && it.category !== f.category) return false;
    if (plat === "rail" && state.railSource && String(it.id || "").indexOf(state.railSource) !== 0) return false;
    if (plat === "zycg" && state.zycgSource && it.source !== state.zycgSource) return false;
    if (f.brand && String(it.brands || "").toLowerCase().indexOf(f.brand.toLowerCase()) < 0) return false;
    // 按公告发布日期精确选某一天（含询价/委托/国铁/保利，口径统一为公告自身发布日）；无 pub_date 的旧数据退回 publish_date
    if (f.date && String(it.pub_date || it.publish_date || "").slice(0, 10) !== f.date) return false;
    if (f.status === "进行中" && it.is_end !== 0) return false;
    if (f.status === "已截止" && it.is_end !== 1) return false;
    if (f.it && !it.it_hint) return false;
    return true;
  }

  function ensureData() {
    if (state.loaded) return Promise.resolve();
    return getJSON(pdata("list.json")).then(function (d) {
      state.items = d.items || [];
      state.loaded = true;
      if (plat === "rail") {
        var mallN = state.items.filter(function (it) { return String(it.id || "").indexOf("mall_") === 0; }).length;
        var cgN = state.items.filter(function (it) { return String(it.id || "").indexOf("cg_") === 0; }).length;
        if ($("rail-source-all")) $("rail-source-all").textContent = state.items.length;
        if ($("rail-source-cg")) $("rail-source-cg").textContent = cgN;
        if ($("rail-source-mall")) $("rail-source-mall").textContent = mallN;
      }
      if (plat === "zycg") {
        var xjN = state.items.filter(function (it) { return it.source !== "委托"; }).length;
        var wtN = state.items.filter(function (it) { return it.source === "委托"; }).length;
        if ($("zycg-source-all")) $("zycg-source-all").textContent = state.items.length;
        if ($("zycg-source-xj")) $("zycg-source-xj").textContent = xjN;
        if ($("zycg-source-wt")) $("zycg-source-wt").textContent = wtN;
      }
      if (plat === "zycg" || plat === "poly" || plat === "rail") initAvailableDates();
      // 渲染前等云端放弃名单就绪，保证卡片「已放弃」标记与其他成员一致
      return ensureAbandoned();
    });
  }

  // ---------- 放弃项目：Cloudflare KV 云端同步（全员可见） ----------
  var abandonedLoaded = false;
  function ensureAbandoned() {
    if (abandonedLoaded) return Promise.resolve();
    abandonedLoaded = true;
    return fetch("api/abandon?v=" + encodeURIComponent(DATA_V), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { state.abandoned = d.items || {}; })
      .catch(function () { state.abandoned = state.abandoned || {}; }); // API 不可用时降级为纯本地标记
  }
  function toast(msg) {
    var t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }
  function openConfirmBox(q, sub, onOk) {
    var mask = $("confirm-mask");
    if (!mask) { onOk(); return; }
    $("confirm-q").textContent = q;
    $("confirm-sub").textContent = sub || "";
    mask.classList.add("show");
    var okB = $("confirm-ok"), cB = $("confirm-cancel");
    function close() {
      mask.classList.remove("show");
      okB.onclick = null; cB.onclick = null;
      mask.removeEventListener("click", onMask);
    }
    function onMask(e) { if (e.target === mask) close(); }
    okB.onclick = function () { close(); onOk(); };
    cB.onclick = close;
    mask.addEventListener("click", onMask);
  }
  function abandonCommit(it, restore) {
    var prev = state.abandoned[it.id];
    if (!restore) state.abandoned[it.id] = { title: it.title, at: new Date().toISOString().slice(0, 16).replace("T", " ") };
    else delete state.abandoned[it.id];
    fetch("api/abandon", {
      method: "POST",
      headers: { "content-type": "application/json", "x-abandon-token": ABANDON_TOKEN },
      body: JSON.stringify({ id: it.id, platform: plat, title: it.title, action: restore ? "restore" : "abandon" })
    }).then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.ok) throw new Error("HTTP " + r.status); }); })
      .then(function () {
        toast(restore ? "已恢复参与列表（已同步云端）" : "已放弃该项目（已同步云端，其他成员刷新可见）");
        loadList();
      })
      .catch(function () {
        if (restore) { if (prev) state.abandoned[it.id] = prev; } else delete state.abandoned[it.id];
        toast("云端同步失败，本次未生效，请重试");
        loadList();
      });
  }

  function loadList() {
    var list = $("list");
    list.innerHTML = '<div class="loading">加载中…</div>';
    ensureData().then(function () {
      var f = state.filters;
      var all = state.items.filter(function (it) { return match(it, f); });
      // 默认按发布日期（平台上架日）倒序：最新的永远在最前面
      all.sort(function (a, b) {
        var da = String(a.pub_date || a.publish_date || ""), db = String(b.pub_date || b.publish_date || "");
        if (da !== db) return da < db ? 1 : -1;
        var ea = String(a.end_time || ""), eb = String(b.end_time || "");
        if (ea !== eb) return ea < eb ? 1 : -1;
        return (b.id || 0) - (a.id || 0);
      });
      var pages = Math.max(1, Math.ceil(all.length / state.pageSize));
      if (state.page > pages) state.page = pages;
      var slice = all.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
      list.innerHTML = slice.length
        ? slice.map(cardHtml).join("")
        : '<div class="empty">没有符合条件的项目</div>';
      $("result-count").textContent = "共 " + all.length + " 条";
      $("pg-info").textContent = state.page + " / " + pages;
      $("pg-prev").disabled = state.page <= 1;
      $("pg-next").disabled = state.page >= pages;
       Array.prototype.forEach.call(list.querySelectorAll(".card"), function (el) {
        el.addEventListener("click", function (e) {
          if (e.target && (e.target.classList.contains("pick") || e.target.closest(".quick-pick") || e.target.closest(".join-btn") || e.target.closest(".abandon-btn"))) return;
          showDetail(el.dataset.id);
        });
      });
      Array.prototype.forEach.call(list.querySelectorAll(".pick"), function (cb) {
        cb.addEventListener("change", function () {
          var id = cb.dataset.id;
          if (cb.checked) state.picked[id] = true; else delete state.picked[id];
          cb.closest(".card").classList.toggle("picked", cb.checked);
          updateSel();
        });
      });
      Array.prototype.forEach.call(list.querySelectorAll(".quick-pick"), function (b) {
        b.addEventListener("click", function (e) {
          e.preventDefault(); e.stopPropagation(); jumpToPickerNotice(b.dataset.id);
        });
      });
      Array.prototype.forEach.call(list.querySelectorAll(".join-btn"), function (b) {
        b.addEventListener("click", function (e) {
          e.preventDefault(); e.stopPropagation();
          var it = null;
          for (var i = 0; i < state.items.length; i++) if (String(state.items[i].id) === String(b.dataset.id)) { it = state.items[i]; break; }
          if (it) recToggle(it);
        });
      });
      // 放弃项目：首次点击弹二次确认；已放弃的点击直接恢复（云端同步）
      Array.prototype.forEach.call(list.querySelectorAll(".abandon-btn"), function (b) {
        b.addEventListener("click", function (e) {
          e.preventDefault(); e.stopPropagation();
          var it = null;
          for (var i = 0; i < state.items.length; i++) if (String(state.items[i].id) === String(b.dataset.id)) { it = state.items[i]; break; }
          if (!it) return;
          if (state.abandoned[it.id]) { abandonCommit(it, true); return; }
          openConfirmBox("是否确认放弃此项目？", it.title, function () { abandonCommit(it, false); });
        });
      });
      syncPickUI();
    }).catch(function (e) {
      list.innerHTML = '<div class="empty">数据加载失败：' + esc(e.message) + "</div>";
    });
  }

  function cardHtml(it) {
    var on = it.is_end === 0;
    var pickable = (plat === "zycg" || plat === "poly") && it.source !== "委托";
    var participatable = plat === "zycg" || plat === "poly" || plat === "rail";
    var checked = pickable && state.picked[it.id];
    var isBid = plat === "bid";
    var joined = participatable && recJoined(it.platform, it.id);
    var abandoned = !!(state.abandoned && state.abandoned[it.id]);
    // 国铁卡片：标题下规格速览（品目×数量 / 品牌限定 / 商品描述摘要），快速判断能否参与
    var specLine = "";
    if (plat === "rail") {
      var sp = [];
      if (it.item_brief) sp.push('<span><b>品目</b>' + esc(it.item_brief) + "</span>");
      if (it.brand_list) {
        var freeBrand = /未限定|不限品牌|无品牌/.test(it.brand_list);
        var hitFocus = FOCUS_BRANDS.filter(function (f) { return it.brand_list.indexOf(f) >= 0; });
        var focusTag = freeBrand ? "" : (hitFocus.length
          ? '<i class="focus-hit">含我方重点品牌：' + esc(hitFocus.join("、")) + "</i>"
          : '<i class="focus-miss">无我方重点品牌</i>');
        sp.push('<span class="' + (freeBrand ? "free" : "limit") + '"><b>品牌</b>' + esc(it.brand_list) + " " + focusTag + "</span>");
      }
      if (it.spec_brief) sp.push('<span class="spec-brief" title="' + esc(it.spec_brief) + '">' + esc(it.spec_brief) + "</span>");
      if (sp.length) specLine = '<div class="spec-line">' + sp.join("") + "</div>";
    }
    var railSource = plat === "rail"
      ? (String(it.id || "").indexOf("mall_") === 0
          ? '<span class="tag rail-mall-tag">国铁商城批量采购专区</span>'
          : '<span class="tag">国铁采购平台公开招投标</span>')
      : "";
    var zycgSourceTag = plat === "zycg" && it.source === "委托"
      ? '<span class="tag rail-mall-tag">单独委托项目</span>' : "";
    return '<div class="card' + (pickable ? " pickable" : "") + (checked ? " picked" : "") + (abandoned ? " abandoned" : "") + '" data-id="' + it.id + '">' +
      (pickable ? '<input type="checkbox" class="pick" data-id="' + it.id + '"' + (checked ? " checked" : "") + ">" : "") +
      '<div class="row1">' +
         '<div class="title">' + esc(it.title || it.enquiry_name) +
           ((plat === "zycg" || plat === "poly") && it.is_new ? '<span class="newtag">新</span>' : "") + "</div>" +
         (isBid ? "" : '<div class="budget">' + budgetText(it) + "</div>") +
       "</div>" +
       specLine +
      '<div class="row2">' +
        '<span><b>' + (isBid ? "采购人" : "采购方") + '</b> ' + esc(it.org_name || it.purchase_company || "—") + "</span>" +
         '<span><b>发布</b> ' + esc(((it.pub_date || it.publish_date) || "—").slice(0, 16)) + "</span>" +
        (isBid
          ? '<span class="tag cat">' + esc(it.source || "") + "</span>" +
            (it.notice_type ? '<span class="tag">' + esc(it.notice_type) + "</span>" : "") +
            (it.region ? '<span class="tag">' + esc(it.region) + "</span>" : "")
          : '<span><b>' + (plat === "zycg" ? "投标截止" : "截止") + '</b> ' + esc((it.end_time && it.end_time !== "null" ? it.end_time : "未公示").slice(0, 16)) + "</span>" +
             (it.category ? '<span class="tag cat">' + esc(it.category) + "</span>" : "") +
             ((plat === "rail" && it.attachments && it.attachments.length)
               ? '<span class="tag att-tag" title="站内已缓存附件，点开可在线浏览/下载">附件×' + it.attachments.length + "</span>" : "") +
             ((plat === "poly" || plat === "rail") && it.notice_type_name ? '<span class="tag">' + esc(it.notice_type_name) + "</span>" : "") +
            railSource +
            zycgSourceTag +
            '<span class="badge ' + (on ? "on" : "off") + '">' + (on ? "进行中" : "已截止") + "</span>" +
            (joined ? '<span class="join-tag">已参与投标</span>' : "")) +
         (participatable
           ? '<button type="button" class="join-btn' + (joined ? " joined" : "") + '" data-id="' + esc(it.id) + '" title="' + (joined ? "点击取消参与" : "点击参与投标") + '">' + (joined ? "取消参与" : "＋ 参与投标") + "</button>" : "") +
         (plat === "zycg" && it.source !== "委托" ? '<button type="button" class="quick-pick" data-id="' + esc(it.id) + '">一键技术选型</button>' : "") +
         // 放弃项目按钮：央采询价招投标（询价+委托）、国铁商城批采招投标（批采+公招）、保利集团招标 全覆盖（2026-11-20 用户要求）
         (participatable
           ? '<button type="button" class="abandon-btn' + (abandoned ? " off" : "") + '" data-id="' + esc(it.id) + '" title="' + (abandoned ? "点击恢复（云端同步）" : "核查后不适合参与，标记放弃并同步云端，其他成员刷新后同样可见") + '">' + (abandoned ? "已放弃·点击恢复" : "放弃项目") + "</button>" : "") +
       "</div>" +
    "</div>";
  }

  // ---------- 详情 ----------
  function showDetail(id) {
    $("overlay").classList.add("show");
    document.body.style.overflow = "hidden";
    var hit = null;
    for (var _i = 0; _i < state.items.length; _i++) {
      if (String(state.items[_i].id) === String(id)) { hit = state.items[_i]; break; }
    }
    if (hit && hit.source === "委托") {
      $("d-body").innerHTML = detailBid(hit);
      bindZycgDetailLinks($("d-body"));
      return;
    }
    if (plat === "bid") {
      var it = null;
      for (var i = 0; i < state.items.length; i++) {
        if (state.items[i].id === id) { it = state.items[i]; break; }
      }
      $("d-body").innerHTML = it ? detailBid(it) : '<div class="empty">项目未找到</div>';
      bindZycgDetailLinks($("d-body"));
      return;
    }
    $("d-body").innerHTML = '<div class="loading">加载中…</div>';
    // 平台取真实目标；选型助手内跳转时 plat=picker，但详情仍是央采公告。
    var detailBase = plat === "poly" ? "data/poly/detail/" : (plat === "rail" ? "data/rail/detail/" : "data/zycg/detail/");
    getJSON(detailBase + id + ".json").then(function (d) {
      $("d-body").innerHTML = detailBase.indexOf("poly") >= 0 ? detailPoly(d) : (detailBase.indexOf("rail") >= 0 ? detailRail(d) : detailZycg(d));
    }).catch(function (e) {
      $("d-body").innerHTML = '<div class="empty">详情加载失败：' + esc(e.message) + "</div>";
    });
  }
  function openZycgDetail(id) {
    $("overlay").classList.add("show");
    document.body.style.overflow = "hidden";
    $("d-body").innerHTML = '<div class="loading">加载公告详情与技术要求…</div>';
    getJSON("data/zycg/detail/" + id + ".json").then(function (d) {
      $("d-body").innerHTML = detailZycg(d);
    }).catch(function (e) {
      $("d-body").innerHTML = '<div class="empty">详情加载失败：' + esc(e.message) + "</div>";
    });
  }
  function bindZycgDetailLinks(root) {
    (root || document).querySelectorAll(".notice-detail-link").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation(); openZycgDetail(b.dataset.noticeId);
      });
    });
    // 单独委托原公告：去掉 Referer 再打开（央采 WAF 拦截带外部 Referer 的跨站访问会 403）
    (root || document).querySelectorAll(".wt-open-orig").forEach(function (b) {
      b.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (b.dataset.wtUrl) openOfficialNoReferrer(b.dataset.wtUrl);
      });
    });
    // 复制公告链接兜底：官网风控拦掉跨站/冷启动访问时，用户可粘贴到地址栏直接打开
    (root || document).querySelectorAll(".wt-copy-link").forEach(function (b) {
      b.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (b.dataset.wtUrl) copyText(b.dataset.wtUrl, b);
      });
    });
  }
  function copyText(t, btn) {
    function done() {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = "已复制 ✓";
      setTimeout(function () { btn.textContent = old; }, 1500);
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = t;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
      if (!ok) window.prompt("手动复制下方链接：", t);
      done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done, fallback);
    } else fallback();
  }
  function metaIt(k, v) { return '<div class="it"><div class="k">' + k + '</div><div class="v">' + v + "</div></div>"; }

  function detailBid(d) {
    // 单独委托详情：站内缓存的公告要点（来自官网正文快照），官网打不开时也能看预算/品目/联系方式
    var wt = d.wt_detail;
    var wtRows = wt ? [
      ["项目编号", wt.code], ["预算金额", wt.budget], ["最高限价", wt.max_price],
      ["采购需求", wt.procurement], ["投标截止", wt.deadline],
      ["联系方式", wt.contacts], ["投标要点", wt.notes]
    ].filter(function (r) { return r[1]; })
      .map(function (r) { return metaIt(r[0], esc(r[1])); }).join("") : "";
    return '<div class="d-title">' + esc(d.title) + "</div>" +
      '<div class="d-meta">' +
        metaIt("采购人", esc(d.org_name || "—")) +
        metaIt("代理机构", esc(d.agent || "—")) +
        metaIt("公告类型", esc(d.notice_type || "—")) +
        metaIt("地区", esc(d.region || "—")) +
        metaIt("发布时间", esc(d.publish_date || "—")) +
        (d.source === "委托" ? metaIt("采集日期", esc(d.seen_date || d.pub_date || "—")) : "") +
        metaIt("数据来源", esc(d.source === "委托" ? "央采主站·单独委托项目" : (d.source || "—"))) +
      "</div>" +
      (wt ? '<div class="d-sec">公告要点（站内缓存自官网正文' + (wt.cached_at ? " · " + wt.cached_at : "") + "）</div>" +
        '<div class="d-meta">' + wtRows + "</div>" : "") +
      '<div class="d-actions">' +
        '<button type="button" class="btn primary wt-open-orig" data-wt-url="' + esc(d.url) + '">打开原公告（查看预算 / 品目 / 联系方式）</button>' +
        '<button type="button" class="btn ghost wt-copy-link" data-wt-url="' + esc(d.url) + '">复制公告链接</button>' +
      "</div>" +
      '<div class="wt-tip">若新标签页仍提示「文件被删除 / 访问错误」：这是央采官网对该次访问的风控拦截（公告本身在线），点「复制公告链接」→ 浏览器空白新标签页 → 粘贴到地址栏回车打开。</div>';
  }

  function detailZycg(d) {
    var on = d.is_end === 0;
    var m = money(d.budget_num);
    var rows = (d.products || []).map(function (p, i) {
      var fullReq = p.technical_requirements_full || p.specification || "—";
      return "<tr><td>" + (i + 1) + "</td><td>" + esc(p.productName || "—") +
        '</td><td class="spec"><div class="source-badge">' + (p.requirements_source === "pdf" ? "PDF完整原文" : "接口字段") +
        "</div>" + esc(fullReq) +
        "</td><td>" + esc(p.brands || "不限") + "</td><td>" + esc(p.models || "") +
        "</td><td>" + esc(p.enquiryNum != null ? p.enquiryNum : "") + " " + esc(p.unit || "") + "</td></tr>";
    }).join("");
    var pdfBtn = d.pdf_path
      ? '<a class="btn primary" href="' + esc(d.pdf_path) + '" target="_blank">⬇ 下载询价通知书 PDF</a>'
      : (d.pdf_url ? '<a class="btn primary" href="' + esc(d.pdf_url) + '" target="_blank">⬇ 下载 PDF（源站）</a>' : "");
    return '<div class="d-title">' + esc(d.title || d.enquiry_name) + "</div>" +
      '<div class="d-meta">' +
        metaIt("采购项目", esc(d.enquiry_name)) +
        metaIt("采购公司", esc(d.purchase_company || d.org_name)) +
        metaIt("预算金额", m ? m + " 元" : esc(d.budget_amount || "—")) +
        metaIt("询价编号", esc(d.enquiry_no || "—")) +
        metaIt("发布日期", esc(d.pub_date || "—")) +
        metaIt("发标日期", esc(d.publish_date || "—")) +
        metaIt("投标截止", esc(d.end_time || "—")) +
        metaIt("品类", esc(d.category || "—")) +
        metaIt("状态", '<span class="badge ' + (on ? "on" : "off") + '">' + (on ? "进行中" : "已截止") + "</span>") +
      "</div>" +
      ((d.products && d.products.length)
        ? '<div class="d-sec">品目需求明细</div><div style="overflow-x:auto"><table class="items">' +
          "<thead><tr><th>#</th><th>品名</th><th>规格/需求</th><th>品牌</th><th>型号</th><th>数量</th></tr></thead>" +
          "<tbody>" + rows + "</tbody></table></div>"
        : "") +
      (d.brands ? '<div class="d-sec">涉及品牌</div><div>' +
        d.brands.split(",").map(function (b) {
          return '<span class="tag" style="margin:0 6px 6px 0">' + esc(b) + "</span>";
        }).join("") + "</div>" : "") +
      '<div class="d-actions">' + pdfBtn +
        '<a class="btn ghost" href="http://mkt.zycg.gov.cn/mall-view/information/detail?noticeId=' + d.id + '" target="_blank" rel="noopener noreferrer">打开央采原页</a>' +
      "</div>";
  }

  function detailPoly(d) {
    var on = d.is_end === 0;
    var m = money(d.budget_num);
    var atts = (d.attachments || []).map(function (a) {
      if (a.local) {
        return '<li><a href="pdf/poly/' + esc(a.local) + '" target="_blank">' + esc(a.name) + "</a>" +
          (a.size ? ' <span class="muted">(' + Math.round(a.size / 1024) + " KB)</span>" : "") + "</li>";
      }
      return "<li>" + esc(a.name || "附件") + ' <span class="muted">（源站签名链接已过期，请到原页下载）</span></li>';
    }).join("");
    return '<div class="d-title">' + esc(d.title) + "</div>" +
      '<div class="d-meta">' +
        metaIt("招标人", esc(d.org_name || "—")) +
        metaIt("项目编号", esc(d.enquiry_no || "—")) +
        metaIt("预算/概算", m ? m + " 元" : "未公示") +
        metaIt("公告类型", esc(d.notice_type_name || "—")) +
        metaIt("采购类型", esc(d.project_type || "—")) +
        metaIt("采购方式", esc((d.pattern || "") + (d.organize_form ? " / " + d.organize_form : ""))) +
        metaIt("发布日期", esc(d.publish_date || "—")) +
        metaIt("投标截止", esc((d.end_time || "—").slice(0, 16))) +
        metaIt("品类", esc(d.category || "未分类")) +
        metaIt("状态", '<span class="badge ' + (on ? "on" : "off") + '">' + (on ? "进行中" : "已截止") + "</span>") +
      "</div>" +
      (d.scope ? '<div class="d-sec">采购范围 / 技术参数</div><div class="scope-box">' + esc(d.scope) + "</div>" : "") +
      ((d.contact_person || d.contact_phone)
        ? '<div class="d-sec">联系人</div><div class="scope-box">' + esc(d.contact_person || "") +
          (d.contact_phone ? "　" + esc(d.contact_phone) : "") + "</div>" : "") +
      (atts ? '<div class="d-sec">公告附件</div><ul class="att-list">' + atts + "</ul>" : "") +
      '<div class="d-actions"><a class="btn primary" href="' + esc(d.source_url) + '" target="_blank">打开保利原页</a></div>';
  }

  function fmtSize(n) {
    if (n == null) return "";
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
    return n + " B";
  }
  function railAttachHtml(d) {
    var atts = d.attachments || [];
    if (!atts.length) {
      return '<div class="d-sec">附件</div><div class="scope-box muted">' + esc(d.attachment_status || "该公告无附件") + "</div>";
    }
    var rows = atts.map(function (a) {
      var isPdf = /\.pdf$/i.test(a.name || "");
      var isOffice = /\.(docx?|xlsx?|pptx?)$/i.test(a.name || "");
      var viewHref = isPdf ? esc(a.path)
        : (isOffice ? "https://view.officeapps.live.com/op/view.aspx?src=" + encodeURIComponent(location.protocol + "//" + location.host + "/" + a.path) : "");
      var viewBtn = viewHref
        ? '<a class="btn ghost att-view" href="' + viewHref + '" target="_blank" rel="noopener">在线浏览</a>'
        : "";
      return '<li class="att-item"><span class="att-name" title="' + esc(a.name) + '">' + esc(a.name) + "</span>" +
        '<span class="att-size">' + fmtSize(a.size) + "</span>" +
        '<span class="att-ops">' + viewBtn +
        '<a class="btn ghost att-dl" href="' + esc(a.path) + '" download="' + esc(a.name) + '">下载</a></span></li>';
    }).join("");
    return '<div class="d-sec">附件（站内缓存 · ' + atts.length + ' 个）</div><ul class="att-list">' + rows + "</ul>";
  }
  function detailRail(d) {
    var on = d.is_end === 0;
    var brand = d.brand_scope || d.brands || "附件需登录核验品牌要求";
    return '<div class="d-title">' + esc(d.title) + "</div>" +
      '<div class="d-meta">' +
        metaIt("采购单位", esc(d.purchase_company || d.org_name || "未从正文识别")) +
        metaIt("项目编号", esc(d.enquiry_no || "—")) +
        metaIt("公告类型", esc(d.notice_type_name || "—")) +
        metaIt("采购方式", esc(d.bid_type_name || "—")) +
        metaIt("发布日期", esc(d.publish_date || "—")) +
        metaIt("投标截止", esc((d.end_time && d.end_time !== "null" ? d.end_time : "未公示").slice(0, 16))) +
        metaIt("品类", esc(d.category || "未分类")) +
        metaIt("状态", '<span class="badge ' + (on ? "on" : "off") + '">' + (on ? "进行中" : "已截止") + "</span>") +
      "</div>" +
      '<div class="d-sec">项目来源</div><div class="scope-box">' +
        (String(d.id || "").indexOf("mall_") === 0 ? "国铁商城批量采购专区" : "国铁采购平台公开招投标") + "</div>" +
      '<div class="d-sec">品牌适配判断</div><div class="scope-box">' + esc(brand) + "</div>" +
       '<div class="d-sec">公告正文</div><div class="scope-box rail-detail">' + esc(d.detail_text || d.digest || "正文待补采") + "</div>" +
       railAttachHtml(d) +
      '<div class="d-actions"><a class="btn primary" href="' + esc(d.source_url) + '" target="_blank" rel="noopener noreferrer">打开国铁原公告</a>' +
      '<a class="btn ghost" href="https://mall.95306.cn/mall-view/negotiationArea/home" target="_blank" rel="noopener noreferrer">登录国铁商城批量采购专区</a></div>';
  }

  function closeDetail() {
    $("overlay").classList.remove("show");
    document.body.style.overflow = "";
  }

  // ---------- 批量选择 / 打包下载 ----------
  function syncPickUI() {
    document.querySelectorAll(".card").forEach(function (el) {
      var on = !!state.picked[el.dataset.id];
      el.classList.toggle("picked", on);
      var cb = el.querySelector(".pick");
      if (cb) cb.checked = on;
    });
    updateSel();
  }
  function updateSel() {
    var n = Object.keys(state.picked).length;
    $("sel-info").textContent = "已选 " + n + " 项";
    $("btn-zip").disabled = n === 0;
  }
  function crc32(u8) {
    if (!crc32.t) {
      var t = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
      }
      crc32.t = t;
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) crc = (crc >>> 8) ^ crc32.t[(crc ^ u8[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function dosTime() {
    var d = new Date();
    return (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  }
  function dosDate() {
    var d = new Date();
    return ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  }
  function buildZip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var nb = enc.encode(f.name), crc = crc32(f.data), len = f.data.length;
      var lh = new Uint8Array(30 + nb.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, 0, true); dv.setUint16(10, dosTime(), true); dv.setUint16(12, dosDate(), true);
      dv.setUint32(14, crc, true); dv.setUint32(18, len, true); dv.setUint32(22, len, true);
      dv.setUint16(26, nb.length, true); dv.setUint16(28, 0, true);
      lh.set(nb, 30);
      parts.push(lh, f.data);
      var cd = new Uint8Array(46 + nb.length), cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime(), true); cv.setUint16(14, dosDate(), true);
      cv.setUint32(16, crc, true); cv.setUint32(20, len, true); cv.setUint32(24, len, true);
      cv.setUint16(28, nb.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(nb, 46);
      central.push(cd);
      offset += lh.length + len;
    });
    var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true); ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [eocd]), { type: "application/zip" });
  }
  function safeName(s) { return String(s || "").replace(/[\\/:*?"<>|\r\n]/g, "_").trim().slice(0, 90); }

  // 与归档目录一致：按品类分文件夹，文件名=采购项目_采购公司
  function catFolder(it) { return safeName(it.category) || "其他"; }
  function pdfFileName(it) {
    var proj = it.enquiry_name || it.title || "未命名项目";
    var org = it.purchase_company || it.org_name || "未知采购人";
    var ext = ".pdf";
    if (it.pdf_path) {
      var m = String(it.pdf_path).match(/(\.[A-Za-z0-9]{1,8})$/);
      if (m) ext = m[1].toLowerCase();
    }
    return safeName(proj) + "_" + safeName(org) + ext;
  }
  function buildManifestTxt(list) {
    var today = new Date().toISOString().slice(0, 10);
    var byCat = {};
    list.forEach(function (it) {
      var c = catFolder(it);
      (byCat[c] = byCat[c] || []).push(it);
    });
    var cats = Object.keys(byCat).sort();
    var lines = [];
    lines.push((plat === "poly" ? "中国保利集团招标采购平台 · 项目附件" : "中央政府采购网 · 电子询价 · 需求公告 · 询价通知书PDF") + "（" + today + "）分类归档");
    lines.push("");
    lines.push("共 " + list.length + " 个项目，按项目类型分文件夹；文件名=采购项目_采购公司。");
    lines.push("导出时间：" + new Date().toLocaleString("zh-CN"));
    lines.push("");
    cats.forEach(function (c) {
      var arr = byCat[c].slice().sort(function (a, b) {
        return String(b.publish_date || "").localeCompare(String(a.publish_date || ""));
      });
      lines.push("=== " + c + "（" + arr.length + " 个）===");
      arr.forEach(function (it) {
        var budget = money(it.budget_num);
        var tags = [];
        if (budget) tags.push("预算" + budget + "元");
        if (it.end_time) tags.push("截止" + it.end_time);
        lines.push("  " + pdfFileName(it).replace(/\.pdf$/, "") +
          "   [" + (tags.join(" ") || "—") + "]");
      });
      lines.push("");
    });
    return lines.join("\r\n");
  }

  function polyProjectHtml(d) {
    var rows = [
      ["项目名称", d.title || d.enquiry_name || ""], ["招标人", d.org_name || ""],
      ["项目编号", d.enquiry_no || ""], ["预算/概算", money(d.budget_num) || d.budget_amount || "未公示"],
      ["公告类型", d.notice_type_name || ""], ["采购类型", d.project_type || ""],
      ["采购方式", [d.pattern, d.organize_form].filter(Boolean).join(" / ")],
      ["发布日期", d.publish_date || ""], ["投标截止", d.end_time || ""],
      ["品类", d.category || ""], ["联系人", [d.contact_person, d.contact_phone].filter(Boolean).join("　")]
    ];
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + esc(d.title || "保利项目资料") + '</title>' +
      '<style>body{font-family:宋体,serif;max-width:980px;margin:36px auto;padding:0 24px;color:#222}h1{font-size:24px;text-align:center}table{width:100%;border-collapse:collapse;margin:22px 0}th,td{border:1px solid #777;padding:10px;vertical-align:top}th{width:130px;background:#f3f5f4}pre{white-space:pre-wrap;line-height:1.7;border:1px solid #aaa;padding:15px}a{color:#126db3}@media print{body{margin:0}}</style></head><body>' +
      '<h1>' + esc(d.title || "保利项目资料") + '</h1><table>' + rows.map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join("") + '</table>' +
      (d.scope ? '<h2>采购范围 / 技术参数</h2><pre>' + esc(d.scope) + '</pre>' : "") +
      '<p><b>原始公告：</b><a href="' + esc(d.source_url || "") + '">' + esc(d.source_url || "") + '</a></p>' +
      '<p>导出时间：' + esc(new Date().toLocaleString("zh-CN")) + '</p></body></html>';
  }

  function fetchPdfFetch(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
      fetch(url, { cache: "no-store", signal: ctrl.signal }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.arrayBuffer();
      }).then(function (buf) {
        clearTimeout(timer); resolve(buf);
      }).catch(function (e) {
        clearTimeout(timer); reject(e);
      });
    });
  }
  // XHR 通道：部分浏览器扩展（如 Smart Nexus/生意助手）会 patch window.fetch 挂起响应正文，
  // XMLHttpRequest 是独立 API 通道，可绕开该类干扰
  function fetchPdfXhr(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "arraybuffer";
      xhr.timeout = timeoutMs;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
        else reject(new Error("HTTP " + xhr.status));
      };
      xhr.onerror = function () { reject(new Error("xhr network error")); };
      xhr.ontimeout = function () { reject(new Error("xhr timeout")); };
      xhr.send();
    });
  }
  function fetchPdf(url, timeoutMs) {
    return fetchPdfFetch(url, timeoutMs).catch(function () { return fetchPdfXhr(url, timeoutMs); });
  }
  function fetchWithRetry(url, tries) {
    return fetchPdf(url, 25000).catch(function (e) {
      if (tries > 1) return fetchWithRetry(url, tries - 1);
      throw e;
    });
  }

  function downloadZip() {
    var ids = Object.keys(state.picked);
    if (!ids.length) return;
    var picked = state.items.filter(function (it) { return state.picked[it.id] && (plat === "poly" || it.has_pdf); });
    var noPdf = plat === "poly" ? 0 : ids.length - picked.length;
    if (!picked.length) {
      $("zip-progress").textContent = plat === "poly" ? "没有可打包的项目" : "选中项都没有 PDF 附件";
      return;
    }
    var btn = $("btn-zip");
    btn.disabled = true;
    var out = [], okItems = [], i = 0, failed = 0, direct = 0;
    function finish() {
      if (!out.length) {
        $("zip-progress").textContent = "打包失败：0 份成功" +
          (direct ? "（已为 " + direct + " 份触发浏览器直接下载，请查看下载面板）" : (failed ? "（" + failed + " 份下载失败，请重试）" : ""));
        btn.disabled = false;
        return;
      }
      $("zip-progress").textContent = "正在生成压缩包…";
      out.push({ name: "清单.txt", data: new TextEncoder().encode(buildManifestTxt(okItems)) });
      var blob = buildZip(out);
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (plat === "poly" ? "保利集团招标_" : "中央政采网_电子询价_") + new Date().toISOString().slice(0, 10) +
        (plat === "poly" ? "_项目附件.zip" : "_询价通知书PDF.zip");
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      $("zip-progress").textContent = "完成：" + okItems.length + " 个项目" +
        (direct ? "（" + direct + " 份已改直接下载，见下载面板）" : "") +
        (failed ? "（" + failed + " 份失败已跳过）" : "") + (noPdf ? "（另有 " + noPdf + " 项无 PDF）" : "");
      btn.disabled = false;
    }
    function next() {
      if (i >= picked.length) { finish(); return; }
      var it = picked[i];
      $("zip-progress").textContent = "打包中 " + (i + 1) + "/" + picked.length +
        "：" + (it.title || "").slice(0, 16) + (failed ? "（已失败 " + failed + "）" : "");
      if (plat === "poly") {
        getJSON("data/poly/detail/" + it.id + ".json").then(function (d) {
          var html = polyProjectHtml(d);
          out.push({ name: catFolder(it) + "/" + safeName(it.title || "保利项目") + ".html", data: new TextEncoder().encode(html) });
          okItems.push(it); i++; next();
        }).catch(function () { failed++; i++; next(); });
        return;
      }
      var pdfUrl = it.pdf_path || "pdf/zycg/" + it.id + ".pdf";
      var tip = "打包中 " + (i + 1) + "/" + picked.length + "：" + (it.title || "").slice(0, 16);
      // 三通道兜底 fetch→XHR→fetch重试（扩展 patch fetch 挂起正文时可切换通道），
      // 全失败则触发浏览器原生直接下载（独立于页面 JS 的下载通道），不阻塞其余条目打包
      fetchPdfFetch(pdfUrl, 15000)
        .catch(function () {
          $("zip-progress").textContent = tip + "（fetch 受阻，切换 XHR 通道…）";
          return fetchPdfXhr(pdfUrl, 15000);
        })
        .catch(function () {
          $("zip-progress").textContent = tip + "（XHR 受阻，重试中…）";
          return fetchPdfFetch(pdfUrl, 15000);
        })
        .then(function (buf) {
          out.push({
            name: catFolder(it) + "/" + pdfFileName(it),
            data: new Uint8Array(buf)
          });
          okItems.push(it);
          i++; next();
        })
        .catch(function () {
          $("zip-progress").textContent = tip + "（改浏览器直接下载…）";
          try {
            var a2 = document.createElement("a");
            a2.href = pdfUrl; a2.download = pdfFileName(it);
            document.body.appendChild(a2); a2.click(); a2.remove();
            direct++;
          } catch (e2) { failed++; }
          i++; next();
        });
    }
    next();
  }

  // ---------- 选型助手 ----------
  var PICK_IT_CATS = ["台式机", "笔记本", "服务器", "存储", "网络", "网络安全", "打印机", "视频会议"];
  var PICK_CPU = [
    { fam: "海光", re: /海光|Hygon|C86/i },
    { fam: "兆芯", re: /兆芯|KX-?U?-?\d{3,5}|ZX-E/i },
    { fam: "飞腾", re: /飞腾|Phytium|S2500|D3000|D2000|3A6000|E2000/i },
    { fam: "鲲鹏", re: /鲲鹏|Kunpeng|KP9[23]0/i },
    { fam: "龙芯", re: /龙芯|Loongson|3A5000|3C5000|3B5000/i }
  ];
  var PICK_CPU_MODELS = [/C86-?\d{1,2}[A-Z]?/i, /KX-?U?-?\d{3,5}A?/i, /\bD[23]000\b/, /\b3A\d{4}\b/, /\bS2500\b/, /\bE2000\b/, /KP9[23]0/];
  // 顺序敏感：先具体后宽泛（视频会议终端→视频会议，不能被 终端→台式机 抢走）
  var PICK_CAT_RULES = [
    ["商显", /触控一体机|会议平板|商显|广告机|数字标牌|会议一体机|教学一体机|会议电视/],
    ["视频会议", /视频会议|会控|MCU|视频终端|视频矩阵/],
    ["笔记本", /笔记本|便携式计算机|便携机|移动工作站|笔电/],
    ["打印机", /打印|复印|扫描|传真|墨盒|硒鼓/],
    ["存储", /存储|磁盘阵列|硬盘阵列|NAS|备份/],
    ["服务器", /服务器|小型机|GPU|超融合/],
    ["网络安全", /防火墙|网闸|入侵|态势感知|漏洞|审计|堡垒机|等保|WAF|安全运营|安全管理/],
    ["网络", /交换机|路由器|网关|无线|光模块/],
    ["台式机", /台式|微型计算机|一体机|工作站|终端|开天|擎云|桌面/]
  ];
  var PICK_BRANDS = ["华为", "联想", "清华同方", "同方", "软通华方", "紫光", "UNIS", "新华三", "H3C",
    "浪潮", "inspur", "戴尔", "DELL", "惠普", "HP", "中兴", "ZTE", "长城", "曙光", "天融信",
    "奇安信", "网神", "山石", "绿盟", "深信服", "锐捷", "迈普", "华鲲振宇", "神舟", "宏碁", "启明星辰"];
  var PICK_KEYWORDS = ["交换机", "防火墙", "路由器", "磁盘阵列", "分布式", "机架式", "塔式", "瘦客户机",
    "无线", "光模块", "备份", "NAS", "云桌面", "桌面云", "等保", "堡垒机", "态势感知", "负载均衡",
    "入侵", "审计", "网关", "视频会议", "终端", "独显", "集显", "固态", "机械硬盘"];

  function ensureProducts() {
    if (picker.products) return Promise.resolve();
    return getJSON("data/products.json").then(function (d) {
      picker.products = d.products || [];
      picker.meta = d;
    });
  }
  function ensureModelSpecs() {
    if (picker.modelSpecs) return Promise.resolve();
    return getJSON("data/model_specs.json").then(function (d) {
      picker.modelSpecs = d.models || {};
    }).catch(function () { picker.modelSpecs = {}; });
  }

  function parseReq(text) {
    var t = String(text || "");
    var tl = t.toLowerCase();
    var req = { cats: [], brands: [], cpuFams: [], cpuModels: [], mem: "", disks: [],
                qty: null, budget: null, xinchuang: false, keywords: [], raw: t };
    for (var i = 0; i < PICK_CAT_RULES.length && req.cats.length < 3; i++) {
      if (PICK_CAT_RULES[i][1].test(t)) req.cats.push(PICK_CAT_RULES[i][0]);
    }
    PICK_BRANDS.forEach(function (b) {
      if (tl.indexOf(b.toLowerCase()) >= 0) req.brands.push(b);
    });
    PICK_CPU.forEach(function (c) {
      if (c.re.test(t)) req.cpuFams.push(c.fam);
    });
    PICK_CPU_MODELS.forEach(function (re) {
      var m = t.match(re);
      if (m && req.cpuModels.indexOf(m[0]) < 0) req.cpuModels.push(m[0]);
    });
    var mem = t.match(/(\d{1,3})\s*G(?:B)?\s*内存/) || t.match(/内存\s*[:：]?\s*(\d{1,3})\s*G/);
    if (mem) req.mem = mem[1];
    var dm;
    var reTok = /(\d{1,4})\s*(TB|GB|G|T)\b/g;
    while ((dm = reTok.exec(t)) !== null) {
      var tok = dm[1] + dm[2];
      if (req.mem && tok === req.mem + "G") continue;
      // 4G/8G 之类通常是独显/无线带宽，不是磁盘
      if (dm[2] !== "T" && dm[2] !== "TB" && parseInt(dm[1], 10) < 16) continue;
      if (req.disks.indexOf(tok) < 0) req.disks.push(tok);
    }
    var q = t.match(/数量\s*[:：]?\s*(\d{1,5})/) || t.match(/(\d{1,5})\s*(?:台|套|个|条|块)/);
    if (q) req.qty = parseInt(q[1], 10);
    var bs = t.split(/预算|限价|控制价|最高限价/);
    if (bs.length > 1) {
      var seg = bs.slice(1).join(" ");
      var wm = seg.match(/([\d.]+)\s*万/);
      var ym = seg.match(/([\d][\d,]*)\s*元/);
      if (wm) req.budget = Math.round(parseFloat(wm[1]) * 10000);
      else if (ym) req.budget = parseInt(ym[1].replace(/,/g, ""), 10);
    }
    if (/信创|国产化|自主可控|国产处理器|国产CPU|国产芯片/.test(t)) req.xinchuang = true;
    PICK_KEYWORDS.forEach(function (k) {
      if (tl.indexOf(k.toLowerCase()) >= 0 && req.keywords.indexOf(k) < 0) req.keywords.push(k);
    });
    return req;
  }

  function normModel(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function canonicalBrand(s) {
    s = String(s || "").toLowerCase();
    if (/h3c|华三|新华三/.test(s)) return "H3C";
    if (/华为|huawei/.test(s)) return "华为";
    if (/锐捷|ruijie/.test(s)) return "锐捷";
    if (/中兴|zte/.test(s)) return "中兴";
    if (/迈普|maipu/.test(s)) return "迈普";
    return String(s || "").trim();
  }
  function brandOfModel(model, fallback) {
    var m = String(model || "").toUpperCase();
    if (/^S57|^CE|^AR\d|^USG/.test(m)) return "华为";
    if (/^S51|^S55|^MSR|^LS-/.test(m)) return "H3C";
    if (/^RG-/.test(m)) return "锐捷";
    return canonicalBrand(fallback || "");
  }
  function splitModels(s) {
    var out = [];
    String(s || "").split(/[,，;；、\n]+/).forEach(function (x) {
      x = x.trim().replace(/^型号[:：]?\s*/, "");
      if (x && out.indexOf(x) < 0) out.push(x);
    });
    return out;
  }
  function techProfile(text) {
    var t = String(text || ""), out = [];
    function add(key, label, hard) { if (!out.some(function (x) { return x.key === key; })) out.push({ key: key, label: label, hard: !!hard }); }
    var m;
    m = t.match(/(?:背板带宽|交换容量)[^\d]{0,8}(?:≥|不低于)?\s*([\d.]+)\s*(Tbps|Gbps)/i); if (m) add("backplane", "背板带宽≥" + m[1] + m[2], true);
    m = t.match(/包转发率[^\d]{0,8}(?:≥|不低于)?\s*(?:最高)?\s*([\d.]+)\s*Mpps/i); if (m) add("forward", "包转发率≥" + m[1] + "Mpps", true);
    m = t.match(/MAC地址表[^\d]{0,8}(?:≥|不低于)?\s*([\d.]+)\s*K/i); if (m) add("mac", "MAC表≥" + m[1] + "K", true);
    m = t.match(/(?:≥|不少于|至少)?\s*(\d{1,3})\s*个?\s*(?:10\/100\/1000M|千兆|GE)[^，。；]{0,12}(?:电口|以太网)/i);
    if (!m) m = t.match(/(?:≥|不少于|至少)?\s*(\d{1,3})\s*个?[^，。；]{0,8}(?:千兆电口|GE电口)/i);
    if (m) add("ge", "千兆电口≥" + m[1], true);
    m = t.match(/(?:≥|不少于|至少)?\s*(\d{1,2})\s*个?\s*(?:1G\/10G|10G|万兆)[^，。；]{0,15}(?:SFP\+?|光口)/i);
    if (!m) m = t.match(/(?:1G\/10G|10G|万兆)[^，。；]{0,12}(?:SFP\+?|光口)\s*(?:≥|不少于|不低于|至少)\s*(\d{1,2})\s*个?/i);
    if (m) add("uplink", "万兆光口≥" + m[1], true);
    m = t.match(/实配\s*(\d{1,2})\s*个?\s*10G[^，。；]{0,16}(?:光模块|光接口模块)/i);
    if (m) add("optics", "实配10G光模块×" + m[1], true);
    if (/1U|高度\s*1U/i.test(t)) add("1u", "1U机架式", true);
    if (/冗余供电|双电源/.test(t)) add("power_redundancy", "冗余供电", true);
    if (/实配\s*(?:≥|不少于|至少)?\s*2\s*个[^，。；]*电源|(?:配置)?\s*2\s*个(?:模块化)?电源(?:模块)?|双电源/.test(t)) add("power_modules", "模块化电源≥2个", true);
    if (/冗余风扇/.test(t)) add("fan", "冗余风扇", true);
    if (/堆叠/.test(t)) { m = t.match(/堆叠[^\d]{0,8}(?:≥|不低于)?\s*(\d+)\s*台/); add("stack", "堆叠" + (m ? "≥" + m[1] + "台" : "支持"), true); }
    if (/IPv6/i.test(t)) add("ipv6", "IPv6", false);
    if (/4K\s*(?:个)?\s*VLAN|4096\s*(?:个)?\s*VLAN/i.test(t)) add("vlan", "4K VLAN", false);
    if (/9216\s*(?:B|字节)/i.test(t)) add("jumbo", "9216B巨帧", false);
    if (/STP|RSTP|MSTP/i.test(t)) add("stp", "STP/RSTP/MSTP", false);
    if (/LACP/i.test(t)) add("lacp", "LACP", false);
    if (/802\.1X/i.test(t)) add("dot1x", "802.1X", false);
    if (/SNMP\s*v?2c|SNMP\s*v?3/i.test(t)) add("snmp", "SNMP v2c/v3", false);
    if (/SSH/i.test(t)) add("ssh", "SSH管理", false);
    return out;
  }

  // 商品属性统一字典：公告原文中的同义表达归一为固定属性编码/名称。
  // 规则无法识别的原文也必须进入 raw.* 待核验项，禁止静默跳过。
  var ATOMIC_ATTRIBUTE_RULES = [
    ["dual_controller", "双主控", /双主控|≥\s*2\s*个主控|不少于\s*2\s*个主控/i],
    ["hot_swap", "热插拔能力", /热插拔/i],
    ["managed_device", "网管功能", /(?:^|[^带外])网管(?:交换机|路由器|功能)?(?:$|[^理口])/i],
    ["ethernet_ports", "以太网电口数量", /电口\s*(?:≥|不少于|不低于|至少)\s*\d+\s*个?|(?:≥|不少于|不低于|至少)\s*\d+\s*个?[^，。；]*电口/i],
    ["optical_module_required", "万兆光模块实配", /(?:配|配置|实配|标配)[^，。；]*万兆(?:多模|单模)?(?:光)?模块|并配万兆模块/i],
    ["controller_count", "主控模块数量", /(?:配置|实配)?\s*\d+\s*个?主控(?:板|模块)?/i],
    ["fan_count", "风扇模块数量", /(?:配置|实配)?\s*\d+\s*个?(?:独立模块化)?风扇(?:框|模块)?/i],
    ["optical_modules", "光模块数量与规格", /(?:配置|实配|提供)[^，。；]*光模块/i],
    ["stack_cable", "堆叠线缆配置", /\d+\s*(?:条|根)[^，。；]*堆叠线缆/i],
    ["high_speed_ports", "高速光接口数量", /(?:10GE|25G|40\/100GE|40GE|100GE)[^，。；]*(?:端口|接口)\s*(?:≥|不少于|不低于|至少)\s*\d+/i],
    ["expansion_slots", "扩展插槽数量", /扩展插槽\s*(?:≥|不少于|不低于|至少)?\s*\d+/i],
    ["airflow", "设备散热风道", /端口侧进风|电源侧出风|散热流向/i],
    ["power_watt", "电源模块功率", /电源模块功率\s*(?:≤|不高于)\s*\d+W/i],
    ["arp_capacity", "ARP表容量", /ARP地址容量/i],
    ["ipv4_route_capacity", "IPv4路由表容量", /IPv4路由表容量/i],
    ["ipv6_route_capacity", "IPv6路由表容量", /IPv6路由表容量/i],
    ["wireless_ac", "融合AC功能", /融合AC/i],
    ["ap_capacity", "AP管理数量", /管理\s*(?:≥|不少于|不低于|至少)?\s*\d+\s*个?AP/i],
    ["firewall_card", "防火墙业务插卡", /防火墙(?:业务)?插卡/i],
    ["m_lag", "M-LAG二层转发", /M-?LAG/i],
    ["gui_management", "图形化统一管理", /图形化界面管理|图形化操作/i],
    ["config_delivery", "一键配置下发", /一键配置下发/i],
    ["version_upgrade", "版本升级", /版本升级/i],
    ["vxlan", "VXLAN隧道", /VXLAN\s*隧道/i],
    ["hardware_warranty", "硬件维保年限", /\d+\s*年硬件维保/i],
    ["fixed_interface", "固定接口形态", /固定接口交换机|固定端口交换机/i],
    ["ac220", "220V交流供电", /220V\s*交流/i],
    ["hot_swap", "接口模块热插拔", /接口模块热插拔|模块热插拔/i],
    ["mac_learning", "MAC地址自动学习", /MAC地址自动学习/i],
    ["mac_aging", "MAC地址老化", /MAC地址[^；。]*老化/i],
    ["source_mac_filter", "源MAC地址过滤", /源MAC地址过滤/i],
    ["acl", "访问控制列表ACL", /(?:支持|具备)?\s*ACL\b/i],
    ["port_mirror", "端口流量镜像", /端口(?:流量)?镜像/i],
    ["bpdu_protect", "BPDU保护", /BPDU保护/i],
    ["root_protect", "根保护", /根保护/i],
    ["loop_protect", "环路保护", /环路保护/i],
    ["tc_bpdu_protect", "TC-BPDU保护", /TC-?BPDU保护/i],
    ["multi_virtual_one", "多虚一虚拟化", /多虚一/i],
    ["hot_patch", "在线热补丁", /热补丁|在线进行补丁升级/i],
    ["user_levels", "用户分级管理", /用户分级管理/i],
    ["encrypted_password", "密文口令保护", /密文口令保护/i],
    ["arp_attack", "ARP攻击保护", /ARP协议?攻击保护/i],
    ["arp_isolation", "ARP攻击端口隔离处理", /未受ARP攻击的端口[^；。]*不受影响/i],
    ["port_security", "端口安全", /端口安全/i],
    ["sticky_mac", "Sticky MAC", /Sticky\s*MAC/i],
    ["mac_limit", "MAC地址学习数量限制", /MAC地址学习数(?:目|量)限制/i],
    ["snmp_source_acl", "SNMP源地址访问限制", /SNMP源地址访问限制/i],
    ["console", "Console管理", /Console口/i],
    ["telnet", "Telnet管理", /Telnet/i],
    ["oob_mgmt", "带外管理口", /带外管理口/i],
    ["mgmt_acl", "管理地址访问控制", /管理地址[^；。]*访问控制/i],
    ["ntp", "NTP时间同步", /NTP协议|\bNTP\b/i],
    ["system_log", "系统日志", /系统日志/i],
    ["operation_log", "用户操作日志", /用户操作日志/i],
    ["syslog", "Syslog日志输出", /syslog/i],
    ["hardware_alarm", "硬件异常告警", /硬件[^；。]*异常[^；。]*告警/i],
    ["temperature_alarm", "温度异常告警", /温度[^；。]*异常[^；。]*告警/i],
    ["power_alarm", "电源异常告警", /电源[^；。]*异常[^；。]*告警/i],
    ["miit_test", "工信部入网检测", /工业和信息化部入网检测|工信部入网检测/i],
    ["telecom_license", "电信设备进网许可", /电信设备进网许可/i],
    ["cybersecurity_law", "符合网络安全法", /网络安全法/i]
  ];
  var PRODUCT_ATTR_ALIASES = {
    "传输速率": "transmission_rate", "背板容量": "backplane", "交换容量": "backplane",
    "包转发速率": "forward", "转发性能": "forward", "功能类别": "function_category",
    "成像原理": "imaging_principle", "最大原稿尺寸": "max_original_size",
    "支持功能": "supported_functions", "单面或自动双面打印": "duplex_print",
    "打印速度": "print_speed", "打印分辨率": "print_resolution", "内存容量": "memory_capacity",
    "端口数量": "port_count", "接口数量": "port_count", "电源数量": "power_modules",
    "主控数量": "controller_count", "风扇数量": "fan_count", "扩展槽数量": "expansion_slots"
  };
  function parseProductAttributes(text) {
    var out = [];
    String(text || "").split(/[,，;；\n]+/).forEach(function (field, i) {
      field = field.trim(); if (!field) return;
      var m = field.match(/^([^:：]+)[:：](.*)$/);
      var name = m ? m[1].trim() : "商品属性";
      var value = m ? m[2].trim() : field;
      var key = PRODUCT_ATTR_ALIASES[name] || ("product_attr." + (i + 1));
      out.push({ key: key, label: name + "：" + value, hard: true, sectionNo: 0,
        section: "商品属性要求", source: field, productAttribute: true });
    });
    return out;
  }
  function fullRequirements(text) {
    var src = String(text || "").replace(/\u00a0/g, " ").replace(/\r/g, "");
    var productAttrText = "", otherText = src;
    var pa = src.indexOf("商品属性要求："), ot = src.indexOf("其他技术指标要求：");
    if (pa >= 0) {
      productAttrText = src.slice(pa + "商品属性要求：".length, ot > pa ? ot : src.length).trim();
      otherText = ot > pa ? src.slice(ot + "其他技术指标要求：".length).trim() : "";
    }
    var sections = [], current = null;
    otherText.split(/\n+/).forEach(function (line) {
      line = line.trim(); if (!line) return;
      var m = line.match(/^(\d+)[.、．]\s*([^：:]+?)要求[:：]\s*(.*)$/);
      if (m) {
        current = { no: Number(m[1]), name: m[2].trim() + "要求", body: m[3].trim() };
        sections.push(current);
      } else if (current) current.body += " " + line;
      else { current = { no: sections.length + 1, name: "其他要求", body: line }; sections.push(current); }
    });
    var out = parseProductAttributes(productAttrText), rawSeq = 0;
    var sourceFragments = out.length, coveredFragments = out.length;
    // 无编号、短文本通常是商品属性摘要，逗号/顿号即属性边界；
    // 编号式长公告中的逗号/顿号常用于协议或对象枚举，不能盲拆（如 SNMP V2C、V3；硬件、温度、电源告警）。
    var compactSummary = sections.length === 1 && otherText.length <= 180 && !/^\s*\d+[.、．]/m.test(otherText);
    sections.forEach(function (sec) {
      var parts = sec.body.split(compactSummary ? /[；;。，、]+/ : /[；;。]+/)
        .map(function (x) { return x.trim().replace(/^[,，、]+|[,，、]+$/g, ""); }).filter(Boolean);
      var atomic = [];
      parts.forEach(function (part) {
        // 仅在出现新的独立谓语时再拆，枚举值（STP、RSTP、MSTP）保持同一条。
        part.split(/，(?=(?:支持|实配|接口(?:不少于|不低于|≥)|高度|全局支持|可对|未受|供应商所投))/).forEach(function (x) {
          x = x.trim(); if (x) atomic.push(x);
        });
      });
      atomic.forEach(function (clause) {
        sourceFragments++;
        var matched = {}, hadMatch = false;
        techProfile(clause).forEach(function (x) {
          matched[x.key] = true; hadMatch = true;
          out.push({ key: x.key, label: x.label, hard: true, sectionNo: sec.no, section: sec.name, source: clause });
        });
        ATOMIC_ATTRIBUTE_RULES.forEach(function (r) {
          // 已识别千兆GE端口时，不再重复记录通用“以太网电口数量”；无速率信息时才用通用属性。
          if (r[0] === "ethernet_ports" && matched.ge) return;
          if (!matched[r[0]] && r[2].test(clause)) {
            matched[r[0]] = true; hadMatch = true;
            out.push({ key: r[0], label: r[1], hard: true, sectionNo: sec.no, section: sec.name, source: clause });
          }
        });
        if (!Object.keys(matched).length) {
          rawSeq++;
          out.push({ key: "raw." + rawSeq, label: "未归类原始条款", hard: true,
            sectionNo: sec.no, section: sec.name, source: clause });
        }
        if (hadMatch) coveredFragments++;
      });
    });
    // 同一统一属性在多处出现时合并原文证据，不重复计入符合性表。
    var unique = [], byKey = {};
    out.forEach(function (x) {
      if (!byKey[x.key]) { byKey[x.key] = x; unique.push(x); }
      else if (byKey[x.key].source.indexOf(x.source) < 0) byKey[x.key].source += "；" + x.source;
    });
    unique.audit = { fragments: sourceFragments, covered: coveredFragments,
      raw: unique.filter(function (x) { return x.key.indexOf("raw.") === 0; }).length,
      coverage: sourceFragments ? Math.round(coveredFragments * 10000 / sourceFragments) / 100 : 0 };
    return unique;
  }
  function modelTech(model) {
    var m = String(model || "").toUpperCase(), f = [];
    var p = m.match(/(?:^|[-])(?:S?)(\d{2})(?:GT|T|S).*?(\d{1,2})X/);
    if (!p) p = m.match(/(48)(?:GT|T).*?(4)(?:XS|X)/);
    if (p) { f.push({ key: "ge", label: p[1] + "GE电口（型号推断）" }); f.push({ key: "uplink", label: p[2] + "×10GE（型号推断）" }); }
    else if (/52S/.test(m)) { f.push({ key: "ge", label: "48GE电口（52S系列）" }); f.push({ key: "uplink", label: "4×10GE（52S系列）" }); }
    if (/PWR|POE/.test(m)) f.push({ key: "poe", label: "PoE型号" });
    return f;
  }
  function findProductByModel(model) {
    var n = normModel(model), exact = null;
    (picker.products || []).some(function (p) {
      var pn = normModel(p.model || p.name);
      if (pn === n) { exact = p; return true; }
      return false;
    });
    return exact;
  }
  function enrichReq(req, product) {
    req.explicitModels = splitModels(product && product.models);
    // 结构化解析使用 PDF 原文的版面换行归一副本；“规格/需求”展示始终使用 raw 原文。
    var requirementText = (product && (product.technical_requirements_normalized || product.technical_requirements_full || product.specification)) || "";
    req.tech = fullRequirements(requirementText);
    req.audit = req.tech.audit || { fragments: 0, covered: 0, raw: 0, coverage: 0 };
    if (!req.tech.length) {
      req.tech = techProfile([product && product.specification, product && product.productName].join(" "));
      req.audit = { fragments: req.tech.length, covered: req.tech.length, raw: 0, coverage: req.tech.length ? 100 : 0 };
    }
    req.explicitModels.forEach(function (m, i) {
      var b = brandOfModel(m, req.brands[i] || "");
      if (b && req.brands.indexOf(b) < 0) req.brands.push(b);
    });
    return req;
  }

  function scoreProduct(p, req) {
    var hay = ((p.brand || "") + " " + (p.model || "") + " " + (p.name || "")).toLowerCase();
    var hits = [];
    var score = 0;
    var pn = normModel(p.model || p.name);
    (req.explicitModels || []).forEach(function (m) {
      var rn = normModel(m);
      if (pn === rn) { score += 140; hits.push("采购附件指定型号"); }
      else if (rn && (pn.indexOf(rn) >= 0 || rn.indexOf(pn) >= 0)) { score += 90; hits.push("指定型号同系列"); }
    });
    req.brands.forEach(function (b) {
      if (canonicalBrand(hay) === canonicalBrand(b) || hay.indexOf(String(b).toLowerCase()) >= 0) {
        score += 30; hits.push("品牌倾向·" + canonicalBrand(b));
      }
    });
    PICK_CPU.forEach(function (c) {
      if (req.cpuFams.indexOf(c.fam) >= 0 && c.re.test(hay)) { score += 40; hits.push("CPU·" + c.fam); }
    });
    req.cpuModels.forEach(function (m) {
      if (hay.indexOf(m.toLowerCase()) >= 0) { score += 25; hits.push(m); }
    });
    if (req.mem && hay.indexOf(req.mem + "g") >= 0) { score += 10; hits.push(req.mem + "G内存"); }
    var hitD = req.disks.filter(function (d) { return hay.indexOf(d.toLowerCase()) >= 0; });
    if (hitD.length) { score += 5; hits.push(hitD.join("/")); }
    if (req.xinchuang && /海光|兆芯|飞腾|鲲鹏|龙芯|麒麟|统信|C86|KX-|D3000|3A6000|S2500/i.test(hay)) {
      score += 10; hits.push("信创国产");
    }
    var kwHit = 0;
    req.keywords.forEach(function (k) {
      if (kwHit < 3 && hay.indexOf(k.toLowerCase()) >= 0) { kwHit++; score += 6; hits.push(k); }
    });
    var mt = modelTech(p.model || p.name);
    (req.tech || []).forEach(function (need) {
      var got = mt.filter(function (x) { return x.key === need.key; })[0];
      if (got) { score += need.hard ? 18 : 8; hits.push(got.label); }
    });
    score += Math.min(p.deals || 0, 5) * 2;
    return { score: score, hits: hits };
  }

  function pickPool(req) {
    var pool = picker.products.filter(function (p) { return p.price_med != null; });
    if (req.cats.length) {
      pool = pool.filter(function (p) { return req.cats.indexOf(p.category) >= 0; });
    } else {
      pool = pool.filter(function (p) { return PICK_IT_CATS.indexOf(p.category) >= 0; });
    }
    return pool;
  }

  function reqChipsHtml(req) {
    var chips = [];
    req.cats.forEach(function (c) { chips.push('<span class="chip">' + esc(c) + "</span>"); });
    req.brands.forEach(function (b) { chips.push('<span class="chip">' + esc(b) + "</span>"); });
    req.cpuFams.forEach(function (c) { chips.push('<span class="chip">CPU·' + esc(c) + "</span>"); });
    req.cpuModels.forEach(function (m) { chips.push('<span class="chip soft">' + esc(m) + "</span>"); });
    if (req.mem) chips.push('<span class="chip soft">' + esc(req.mem) + "G内存</span>");
    req.disks.forEach(function (d) { chips.push('<span class="chip soft">' + esc(d) + "</span>"); });
    if (req.qty) chips.push('<span class="chip soft">数量 ' + req.qty + "</span>");
    if (req.budget) chips.push('<span class="chip soft">预算 ' + money(req.budget) + " 元</span>");
    if (req.xinchuang) chips.push('<span class="chip">信创</span>');
    req.keywords.forEach(function (k) { chips.push('<span class="chip soft">' + esc(k) + "</span>"); });
    if (!chips.length) chips.push('<span class="muted">未识别到结构化需求，仅按品类匹配</span>');
    return chips.join("");
  }

  function mallNoticeUrl(id) {
    return "https://mkt.zycg.gov.cn/mall-view/information/detail?noticeId=" + encodeURIComponent(id);
  }
  function originalNoticeLink(id, label) {
    return '<button type="button" class="original-notice-link" data-notice-id="' + esc(id) + '">' + esc(label) + "</button>";
  }
  // 央采 WAF 拦截带外部 Referer 的跨站访问（直接跳转官网会 403），
  // 所以成交公告正文在服务端缓存进 data/mall_notices.json，站内弹层展示；
  // 官网链接只作兜底，且用 rel=noreferrer 去掉 Referer 再打开。
  function ensureMallNotices() {
    if (picker.notices) return Promise.resolve();
    return getJSON("data/mall_notices.json").then(function (d) {
      picker.notices = d.notices || {};
    }).catch(function () {
      picker.notices = {};
    });
  }
  function openMallNotice(id) {
    ensureMallNotices().then(function () {
      var d = (picker.notices || {})[String(id)];
      if (!d) {
        openOfficialNoReferrer(mallNoticeUrl(id));
        return;
      }
      $("d-body").innerHTML = detailMallNotice(d);
      $("overlay").classList.add("show");
      document.body.style.overflow = "hidden";
    });
  }
  function openOfficialNoReferrer(url) {
    var a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.referrerPolicy = "no-referrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function detailMallNotice(d) {
    var body = (d.content || "").replace(/<script[\s\S]*?<\/script>/gi, "");
    // 原公告正文里带相对链接（如 /mall-view/...），统一补全到央采官网域名并加 noreferrer，
    // 避免在本站 404 或被 WAF 按外部 Referer 拦 403
    body = body.replace(/<a\s+([^>]*)>/gi, function (m, attrs) {
      var hm = attrs.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      if (!hm) return m;
      var href = hm[1] != null ? hm[1] : hm[2];
      if (/^(?:#|mailto:|javascript:)/i.test(href)) return m;
      var abs;
      if (/^https?:\/\//i.test(href)) abs = href;
      else if (/^\/\//.test(href)) abs = "https:" + href;
      else if (/^\//.test(href)) abs = "https://mkt.zycg.gov.cn" + href;
      else abs = "https://mkt.zycg.gov.cn/" + href;
      var newAttrs = attrs
        .replace(/href\s*=\s*(?:"[^"]*"|'[^']*')/i, 'href="' + abs + '"')
        .replace(/\s*target\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
        .replace(/\s*rel\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
      return '<a ' + newAttrs + ' target="_blank" rel="noopener noreferrer">';
    });
    if (!body) body = '<div class="empty">该公告正文暂缺（缓存里没有这条 id），请用下方按钮到官网查看</div>';
    return '<div class="d-title">' + esc(d.title || "成交公告") + "</div>" +
      '<div class="d-meta">' +
        metaIt("公告编号", esc(d.code || "—")) +
        metaIt("发布时间", esc(d.date || "—")) +
        metaIt("数据来源", "央采电子卖场 · 成交公告（站内缓存正文）") +
      "</div>" +
      '<div class="d-sec">公告正文</div>' +
      '<div class="notice-body">' + body + "</div>" +
      (d.official ? '<div class="d-actions">' +
        '<a class="btn ghost" href="' + esc(d.official) + '" target="_blank" rel="noopener noreferrer">在央采官网打开（若被网站拦截属对方风控）</a>' +
      "</div>" : "");
  }
  function bindOriginalNoticeLinks(root) {
    (root || document).querySelectorAll(".original-notice-link").forEach(function (b) {
      b.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      b.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        openMallNotice(b.dataset.noticeId);
      });
    });
  }

  function pickCardHtml(x, unitBudget, extraHtml) {
    var p = x.p;
    var cls = x.s.score >= 60 ? "hit-good" : (x.s.score >= 30 ? "hit-mid" : "hit-low");
    var price = p.price_med == null ? '<span class="muted">暂无历史成交价</span>' : ((p.price_min === p.price_max)
      ? '<b>' + money(p.price_min) + "</b> 元"
      : money(p.price_min) + " ~ " + money(p.price_max) + ' 元（中位 <b>' + money(p.price_med) + "</b>）");
    var budgetTag = "";
    if (unitBudget && p.price_med != null) {
      if (p.price_max <= unitBudget) budgetTag = ' <span class="budget-ok">✓ 预算内</span>';
      else if (p.price_min <= unitBudget) budgetTag = ' <span class="budget-warn">~ 部分档位在预算内</span>';
      else budgetTag = ' <span class="budget-bad">! 超预算（最低 ' + money(p.price_min) + " 元）</span>";
    }
    var src = (p.notice_ids && p.notice_ids.length)
      ? " · " + originalNoticeLink(p.notice_ids[0], "查看原始成交公告") : "";
    return '<div class="pick-card ' + cls + '">' +
      '<div class="pc-head"><span class="pc-name">' + esc(p.model || p.name) + "</span>" +
      (p.model && p.name && p.name !== p.model ? '<span class="model-origin">' + esc(p.name) + "</span>" : "") +
      '<span class="tag cat">' + esc(p.category) + "</span>" +
      (p.brand ? '<span class="tag">' + esc(p.brand) + "</span>" : "") +
      (p.deals ? '<span class="badge on">成交 ' + p.deals + " 次</span>" : '<span class="badge off">待核价</span>') + "</div>" +
      '<div class="pc-price">成交单价：' + price + budgetTag + "</div>" +
      (x.s.hits.length ? '<div class="pc-hits">' +
        x.s.hits.map(function (h) { return '<span class="chip">' + esc(h) + "</span>"; }).join("") + "</div>" : "") +
      '<div class="pc-meta">最近成交 ' + (p.last_date || "-") +
       (p.suppliers && p.suppliers.length
        ? " · 供应商：" + esc(p.suppliers[0]) + (p.suppliers.length > 1 ? " 等 " + p.suppliers.length + " 家" : "") : "") +
      src + "</div>" + (extraHtml || "") + "</div>";
  }

  // topN：降级推荐（覆盖率<100%）时限制在 5-10 款；withCompliance：每款附逐项符合性表（未归类条款标注待核验）
  function pickResultsHtml(req, pool, unitBudget, topN, withCompliance) {
    if (!pool.length) {
      return '<div class="pick-empty">机型库中没有对应品类的成交记录，试试放宽品类或关键词</div>';
    }
    var scored = pool.map(function (p) { return { p: p, s: scoreProduct(p, req) }; })
      .filter(function (x) { return x.s.score >= 20; })
      .sort(function (a, b) { return b.s.score - a.s.score || b.p.deals - a.p.deals; })
      .slice(0, topN || 20);
    var head;
    if (scored.length) {
      head = "命中 " + scored.length + " 个机型（候选池 " + pool.length + " 个，按匹配度排序）";
    } else {
      head = "无强匹配，列出该品类成交最多的 10 个机型供参考";
      scored = pool.slice().sort(function (a, b) {
        return (b.deals - a.deals) || ((b.price_med || 0) - (a.price_med || 0));
      }).slice(0, 10).map(function (p) {
        return { p: p, s: { score: 0, hits: ["无强匹配 · 品类热门"] } };
      });
    }
    return '<div class="pick-group">' + head + "</div>" +
      scored.map(function (x) {
        var extra = withCompliance
          ? complianceHtml(complianceOf(req, x.p.model || x.p.name, (picker.modelSpecs || {})[x.p.model] || {}))
          : "";
        return pickCardHtml(x, unitBudget, extra);
      }).join("");
  }

  function loadPickerStatus() {
    ensureProducts().then(function () {
      var m = picker.meta || {};
      var priced = picker.products.filter(function (p) { return p.price_med != null; }).length;
      $("st-total").textContent = picker.products.length;
      $("st-active").textContent = priced;
      $("st-latest").textContent = String(m.updated_at || "-").slice(5, 10);
      $("upd-time").textContent = "数据快照：" + (m.updated_at || "-");
      $("foot-note").textContent = "数据来源：中央政府采购网电子卖场 · 成交公告机型库（" +
        (m.deal_rows || 0) + " 条成交明细聚合）· 快照 " + (m.updated_at || "-");
      initBrowseFilters();
    }).catch(function () {
      $("foot-note").textContent = "机型库加载失败：data/products.json 不存在";
    });
  }

  // --- 模式 A：粘贴需求文本 ---
  function runPickText() {
    var text = $("pick-text").value.trim();
    var box = $("pick-results");
    if (!text) { box.innerHTML = '<div class="pick-empty">请先粘贴需求文本</div>'; return; }
    box.innerHTML = '<div class="loading">正在匹配机型库…</div>';
    ensureProducts().then(function () {
      var req = parseReq(text);
      var pool = pickPool(req);
      var unitBudget = req.budget ? (req.qty ? Math.round(req.budget / req.qty) : req.budget) : null;
      var html = '<div class="req-line">解析出的需求：' + reqChipsHtml(req) +
        (unitBudget ? " · 折合单价预算 ≈ <b>" + money(unitBudget) + "</b> 元" : "") + "</div>";
      html += pickResultsHtml(req, pool, unitBudget);
      $("pick-summary").textContent = "匹配完成 " + new Date().toLocaleTimeString("zh-CN");
      box.innerHTML = html;
      bindOriginalNoticeLinks(box);
    });
  }

  // --- 模式 B：选一条央采公告 ---
  function ensureZycgList() {
    if (picker.zycgList) return Promise.resolve();
    return getJSON("data/zycg/list.json").then(function (d) {
      // 选型助手「央采项目选择」只保留电子询价公告（2026-11-20 用户要求）：
      // 单独委托项目无电子询价品目与技术附件，不参与一键选型
      picker.zycgList = (d.items || []).filter(function (it) { return it.source !== "委托"; });
    });
  }
  // 央采公告品类 → 界面叫法（按数据里的 category 值映射）
  var NOTICE_CAT_LABELS = {
    "服务器": "服务器", "网络": "网络设备", "视频会议": "会议设备",
    "存储": "存储设备", "打印机": "打印机", "计算机": "台式计算机", "网络安全": "安全设备"
  };
  var NOTICE_CAT_ORDER = ["服务器", "网络", "视频会议", "存储", "打印机", "计算机", "网络安全"];

  function jumpToPickerNotice(id) {
    // 一次点击：切到选型助手→央采项目选择→定位公告→立即按技术参数出结果
    setPlatform("picker", true);
    document.querySelectorAll(".ptab").forEach(function (b) {
      var on = b.dataset.pane === "notice";
      b.classList.toggle("on", on);
    });
    ["text", "notice", "browse"].forEach(function (n) {
      $("ppane-" + n).classList.toggle("hide", n !== "notice");
    });
    $("pick-results").innerHTML = "";
    initPickerNoticeSelect().then(function () {
      var found = (picker.zycgList || []).filter(function (x) { return String(x.id) === String(id); })[0];
      if (found) {
        $("pick-notice-key").value = "";
        $("pick-notice-cat").value = found.category || "";
        fillNoticeSelect();
        $("pick-notice").value = String(id);
        renderNoticeList(picker.noticeFiltered || []);
        runPickNotice(String(id));
        setTimeout(function () { $("ppane-notice").scrollIntoView({ behavior: "smooth", block: "start" }); }, 0);
      } else {
        $("pick-notice-analysis").innerHTML = '<div class="pick-empty">未找到该公告，请刷新数据后重试</div>';
      }
    });
  }

  function renderNoticeList(items) {
    var list = $("pick-notice-list");
    if (!list) return;
    var selected = $("pick-notice").value;
    list.innerHTML = items.length ? items.map(function (it) {
      return '<button type="button" class="pnl-item' + (String(it.id) === String(selected) ? " on" : "") +
        '" data-notice-id="' + esc(it.id) + '">' +
        '<span class="pnl-title">' + esc(it.title || it.enquiry_name) + "</span>" +
        '<span class="pnl-meta">' + esc(it.org_name || it.purchase_company || "-") +
        (it.budget_num ? " · " + money(it.budget_num) + "元" : "") +
        " · " + (it.is_end === 0 ? "进行中" : "已截止") + "</span>" +
        '<span class="pnl-tags">' + esc(NOTICE_CAT_LABELS[it.category] || it.category || "") +
        (it.brands ? " · " + esc(it.brands) : "") +
        (it.source === "委托" ? " · 委托·无附件" : "") + "</span></button>";
    }).join("") : '<div class="pick-empty">没有匹配公告</div>';
    list.querySelectorAll(".pnl-item").forEach(function (b) {
      b.addEventListener("click", function () {
        $("pick-notice").value = b.dataset.noticeId;
        runPickNotice(b.dataset.noticeId);
      });
    });
  }

  function fillNoticeSelect() {
    var cat = $("pick-notice-cat").value;
    var kw = $("pick-notice-key") ? $("pick-notice-key").value.trim().toLowerCase() : "";
    var items = picker.zycgList.slice().filter(function (it) {
      if (cat && (it.category || "") !== cat) return false;
      if (kw) {
        var hay = [it.title, it.enquiry_name, it.org_name, it.purchase_company, it.brands, it.category, it.enquiry_no].join(" ").toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (a.is_end !== b.is_end) return a.is_end - b.is_end;
      return String(b.publish_date || "").localeCompare(String(a.publish_date || ""));
    });
    if ($("pick-notice-count")) $("pick-notice-count").textContent = "找到 " + items.length + " 条公告";
    var oldValue = $("pick-notice").value;
    $("pick-notice").innerHTML = items.length
      ? items.map(function (it) {
           return '<option value="' + it.id + '">' + (it.is_end === 0 ? "【进行中】" : "【已截止】") +
             esc(it.title || it.enquiry_name) + " · " + esc(it.org_name || it.purchase_company || "") +
             (it.source === "委托" ? "（委托·无附件）" : "") + "</option>";
        }).join("")
      : '<option value="">该类型下暂无公告</option>';
    if (oldValue && items.some(function (it) { return String(it.id) === String(oldValue); })) $("pick-notice").value = oldValue;
    picker.noticeFiltered = items;
    renderNoticeList(items);
  }

  function initPickerNoticeSelect() {
    if ($("pick-notice").dataset.ready) return Promise.resolve();
    if (picker.noticeInitPromise) return picker.noticeInitPromise;
    picker.noticeInitPromise = ensureZycgList().then(function () {
      var counts = {};
      picker.zycgList.forEach(function (it) {
        var c = it.category || "";
        counts[c] = (counts[c] || 0) + 1;
      });
      var cats = NOTICE_CAT_ORDER.filter(function (c) { return counts[c]; });
      Object.keys(counts).forEach(function (c) { if (cats.indexOf(c) < 0) cats.push(c); });
      $("pick-notice-cat").innerHTML =
        '<option value="">全部类型（' + picker.zycgList.length + "）</option>" +
        cats.map(function (c) {
          return '<option value="' + esc(c) + '">' + esc(NOTICE_CAT_LABELS[c] || c) + "（" + counts[c] + "）</option>";
        }).join("");
      $("pick-notice-cat").addEventListener("change", fillNoticeSelect);
      $("pick-notice").addEventListener("change", function () {
        renderNoticeList(picker.noticeFiltered || []);
      });
      if ($("pick-notice-key")) {
        $("pick-notice-key").addEventListener("input", fillNoticeSelect);
        $("pick-notice-key").addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); fillNoticeSelect(); if ($("pick-notice").value) runPickNotice(); }
        });
      }
      fillNoticeSelect();
      $("pick-notice").dataset.ready = "1";
    }).finally(function () { picker.noticeInitPromise = null; });
    return picker.noticeInitPromise;
  }
  function complianceOf(req, model, info) {
    var evidence = {}, inferred = modelTech(model), facts = info.facts || [];
    inferred.forEach(function (x) { evidence[x.key] = x.label; });
    techProfile(facts.join(" ")).forEach(function (x) { evidence[x.key] = x.label; });
    var rows = (req.tech || []).map(function (need) {
      var ev = evidence[need.key];
      return ev
        ? { need: need, status: "pass", note: "规格证据：" + ev }
        : { need: need, status: "verify", note: need.key.indexOf("raw.") === 0
          ? "原文未归类、未参与打分，属没把握项，必须人工对照采购附件核验"
          : "公开资料未覆盖此项，不能判定满足，须取得厂商彩页/检测报告核验" };
    });
    return {
      rows: rows,
      pass: rows.filter(function (x) { return x.status === "pass"; }).length,
      fail: rows.filter(function (x) { return x.status === "fail"; }).length,
      verify: rows.filter(function (x) { return x.status === "verify"; }).length,
      strict: rows.length > 0 && rows.every(function (x) { return x.status === "pass"; })
    };
  }
  function complianceHtml(c) {
    var summary = c.strict
      ? '<span class="strict-ok">严格满足全部技术要求</span>'
      : '<span class="strict-bad">未确认严格满足：满足 ' + c.pass + " 项，不满足 " + c.fail + " 项，待核验 " + c.verify + " 项</span>";
    var rows = c.rows.map(function (x) {
      var label = x.status === "pass" ? "满足" : (x.status === "fail" ? "不满足" : "待核验");
      return '<tr><td><b>' + esc((x.need.sectionNo ? x.need.sectionNo + ". " : "") + (x.need.section || "技术要求")) +
        '</b><br>' + esc(x.need.label) + '<br><span class="attr-code">' + esc(x.need.key) + '</span><br><span class="muted">原文：' +
        esc(x.need.source || x.need.label) + '</span></td><td><span class="comp-' + x.status + '">' + label +
        '</span></td><td>' + esc(x.note) + "</td></tr>";
    }).join("");
    var issues = c.rows.filter(function (x) { return x.status !== "pass"; });
    return '<div class="compliance"><div class="compliance-summary">' + summary + "</div>" +
      '<div class="compliance-table"><table><thead><tr><th>采购技术条款</th><th>结论</th><th>依据/备注</th></tr></thead><tbody>' +
      rows + "</tbody></table></div>" +
      (issues.length ? '<div class="nonmatch-note"><b>不满足/待核验备注：</b>' + issues.map(function (x) {
        return esc((x.need.sectionNo ? x.need.sectionNo + "." : "") + x.need.label + "（原文：" + (x.need.source || x.need.label) + "）：" + x.note);
      }).join("；") + "</div>" : "") + "</div>";
  }
  function explicitModelCard(model, req, unitBudget) {
    var history = findProductByModel(model);
    var info = (picker.modelSpecs || {})[model] || {};
    var brand = info.brand || brandOfModel(model, history && history.brand);
    var facts = info.facts || [];
    var compliance = complianceOf(req, model, info);
    var hit = compliance.rows.filter(function (x) { return x.status === "pass"; }).map(function (x) { return x.note.replace(/^规格证据：/, ""); });
    var gaps = compliance.rows.filter(function (x) { return x.status !== "pass"; }).map(function (x) { return x.need.label; });
    var price = history && history.price_med != null
      ? "历史成交中位价 <b>" + money(history.price_med) + "</b> 元" : "机型库暂无成交价，需询价";
    var budget = "";
    if (unitBudget && history && history.price_med != null) {
      budget = history.price_med <= unitBudget ? ' <span class="budget-ok">✓ 预算内</span>' : ' <span class="budget-bad">! 超预算</span>';
    }
    var source = info.source_url ? '<a href="' + esc(info.source_url) + '" target="_blank" rel="noopener noreferrer">' +
      esc(info.source_label || "查看公开规格来源") + "</a>" : '<span class="muted">暂无公开来源链接</span>';
    var historyLink = history && history.notice_ids && history.notice_ids.length
      ? " · " + originalNoticeLink(history.notice_ids[0], "查看历史成交公告") : "";
    return '<div class="pick-card hit-good model-rec"><div class="pc-head">' +
      '<span class="pc-name">' + esc(model) + '</span><span class="tag">' + esc(brand || "品牌待核") +
      '</span><span class="model-origin">采购附件指定型号</span>' +
      (history ? '<span class="badge on">成交 ' + history.deals + " 次</span>" : '<span class="badge off">待核价</span>') + "</div>" +
      '<div class="pc-price">' + price + budget + "</div>" +
      '<div class="pc-hits"><span class="chip">附件型号直接命中</span>' +
      hit.map(function (h) { return '<span class="chip">' + esc(h) + "</span>"; }).join("") + "</div>" +
      (facts.length ? '<div class="pc-meta">公开资料：' + esc(facts.join("；")) + "</div>" : "") +
      (gaps.length ? '<div class="model-gap">当前未确认满足：' + esc(gaps.join("、")) + "</div>" : "") +
      complianceHtml(compliance) +
      (info.source_note ? '<div class="model-gap">核验提示：' + esc(info.source_note) + "</div>" : "") +
      '<div class="pc-meta">规格来源：' + source + historyLink + "</div></div>";
  }
  function tendencyHtml(req) {
    var brands = {};
    (req.explicitModels || []).forEach(function (m, i) {
      var b = brandOfModel(m, req.brands[i] || "未知"); brands[b] = (brands[b] || 0) + 1;
    });
    var names = Object.keys(brands);
    if (!names.length) names = (req.brands || []).map(canonicalBrand);
    var text = names.length ? names.join("、") : "未发现明确品牌";
    return '<div class="brand-tendency"><b>客户参数倾向：</b>' + esc(text) +
      '。判断依据：采购附件中的品牌范围、指定型号及型号对应端口结构；附件明确型号的权重最高，历史成交仅作价格和落地证据。</div>';
  }
  function techHtml(req) {
    var tech = req.tech || [], sections = {};
    tech.forEach(function (x) { var k = x.sectionNo || 0; (sections[k] || (sections[k] = [])).push(x); });
    var body = Object.keys(sections).sort(function (a, b) { return +a - +b; }).map(function (k) {
      var xs = sections[k], title = (xs[0].sectionNo ? xs[0].sectionNo + ". " : "") + (xs[0].section || "技术要求");
      return '<div class="req-section"><div class="req-section-title">' + esc(title) + "（" + xs.length + "项）</div>" +
        xs.map(function (x) {
          return '<div class="req-atomic"><span class="attr-name">' + esc(x.label) + '</span><span class="attr-code">' + esc(x.key) +
            '</span><div class="attr-source">原文：' + esc(x.source || x.label) + "</div></div>";
        }).join("") + "</div>";
    }).join("");
    var audit = req.audit || { fragments: tech.length, covered: tech.length, raw: 0, coverage: tech.length ? 100 : 0 };
    var gate = audit.coverage === 100 && audit.raw === 0
      ? '<span class="coverage-ok">归类覆盖率 100% · 未归类 0 · 允许生成推荐</span>'
      : '<span class="coverage-bad">归类覆盖率 ' + audit.coverage + "% · 未归类保留 " + audit.raw +
        " · 已降级推荐：未归类条款未参与打分，逐款标注「待核验」（原文未删除，补充属性字典后自动恢复完整推荐）</span>";
    return '<div class="tech-box"><div class="tech-title">采购附件全量技术要求（' + tech.length +
      " 个统一属性；原文逐条保留，绝不删除）</div>" +
      '<div class="coverage-audit">原文分片 ' + audit.fragments + " 条（全部保留）· 已归类 " + audit.covered +
      " 条 · 未归类保留 " + audit.raw + " 条 · " + gate + "</div>" +
      (body || '<span class="muted">未提取到技术条款，请打开公告详情人工核对附件</span>') + "</div>";
  }
  function runPickNotice(idArg) {
    var id = (typeof idArg === "string" || typeof idArg === "number") ? String(idArg) : $("pick-notice").value;
    var box = $("pick-notice-analysis");
    if (!id) { box.innerHTML = '<div class="pick-empty">请先选择一条公告</div>'; return; }
    $("pick-notice").value = id;
    renderNoticeList(picker.noticeFiltered || []);
    // 单独委托公告没有电子询价品目与附件（导出时不生成详情 JSON），不做一键选型，避免 404 误报
    var entr = (picker.zycgList || []).filter(function (x) {
      return String(x.id) === String(id) && x.source === "委托";
    })[0];
    if (entr) {
      box.innerHTML = '<div class="analysis-head"><div class="title">' + esc(entr.title || "") + "</div>" +
        '<div class="pnl-meta">采购公司：' + esc(entr.buyer || "-") + " · 品类：" + esc(entr.category || "-") + "</div>" +
        '<div class="analysis-actions">' + (entr.url
          ? '<a class="btn ghost" href="' + esc(entr.url) + '" target="_blank" rel="noopener noreferrer">打开原招标公告</a>' +
            '<button type="button" class="btn ghost wt-copy-link" data-wt-url="' + esc(entr.url) + '">复制链接</button>'
          : "") + "</div></div>" +
        '<div class="pick-empty">该公告为「单独委托招标」公告，无电子询价品目明细与技术附件，不支持一键选型。' +
        "如已获取参数文本，可切到「粘贴需求文本」模式录入后获取选型推荐。</div>";
      bindZycgDetailLinks(box);
      return;
    }
    box.innerHTML = '<div class="loading">正在读取采购附件并分析技术参数…</div>';
    Promise.all([ensureProducts(), ensureModelSpecs(), getJSON("data/zycg/detail/" + id + ".json")]).then(function (all) {
      var d = all[2], prods = d.products || [];
      picker.currentNotice = d;
      var qtyTotal = prods.reduce(function (s, p) { return s + (Number(p.enquiryNum) || 0); }, 0);
      var unitBudget = (d.budget_num && qtyTotal > 0) ? Math.round(d.budget_num / qtyTotal) : null;
      var pdfUrl = d.pdf_path || d.pdf_url || "";
      var html = '<div class="analysis-head"><div class="title">' + esc(d.title || d.enquiry_name) + "</div>" +
        '<div class="pnl-meta">采购公司：' + esc(d.purchase_company || d.org_name || "-") +
        " · 品类：" + esc(d.category || "-") + (d.budget_num ? " · 总预算 " + money(d.budget_num) + " 元" : "") +
        (unitBudget ? " · 折合约 " + money(unitBudget) + " 元/台" : "") + "</div>" +
        '<div class="analysis-actions"><button type="button" class="notice-detail-link" data-notice-id="' + esc(id) +
        '">查看公告详情 / 技术要求</button>' + (pdfUrl ? '<a class="btn ghost" href="' + esc(pdfUrl) +
        '" target="_blank" rel="noopener noreferrer">打开采购需求附件 PDF</a>' : "") + "</div></div>";
      if (!prods.length) {
        box.innerHTML = html + '<div class="pick-empty">该公告没有结构化品目明细，请打开公告附件或切到「粘贴需求文本」</div>';
        bindZycgDetailLinks(box); return;
      }
      prods.forEach(function (p, idx) {
        var itemText = [p.productName, p.specification, p.brands, p.models].join(" ");
        var req = enrichReq(parseReq(itemText), p);
        if (!req.cats.length && d.category && PICK_IT_CATS.indexOf(d.category) >= 0) req.cats = [d.category];
        if (d.brands) d.brands.split(",").forEach(function (b) {
          b = canonicalBrand(b.trim()); if (b && b !== "不限" && req.brands.indexOf(b) < 0) req.brands.push(b);
        });
        var unitB = (Number(p.enquiryNum) && d.budget_num && prods.length === 1)
          ? Math.round(d.budget_num / Number(p.enquiryNum)) : unitBudget;
        html += '<div class="pick-group">品目 ' + (idx + 1) + "：" + esc(p.productName || "未命名") +
          (p.enquiryNum ? " × " + esc(p.enquiryNum) + " " + esc(p.unit || "") : "") + "</div>" +
          tendencyHtml(req) + techHtml(req);
         if (req.explicitModels.length) {
           html += '<div class="pick-group">优先推荐：采购附件明确型号（按参数吻合度与历史成交证据排序）</div>' +
             req.explicitModels.map(function (m) { return explicitModelCard(m, req, unitB); }).join("");
         }
         var pool = pickPool(req).filter(function (x) {
           return req.explicitModels.indexOf(x.model) < 0;
         });
         var audit = req.audit || {};
         if (audit.coverage === 100 && audit.raw === 0) {
           html += '<div class="pick-group">同品牌 / 同品类备选（需逐项核验技术条款）</div>' + pickResultsHtml(req, pool, unitB);
         } else {
           // 覆盖率不足 100%：不再停止推荐——按已归类属性降级推荐前 10 款，
           // 未归类条款未参与打分，逐款列入符合性表并标注「待核验·未参与打分」
           html += '<div class="pick-warn">原文归类覆盖率 ' + audit.coverage + "%（未归类保留 " + audit.raw +
             ' 条）：以下降级推荐仅按已归类属性打分，未归类条款未参与打分，已逐款列入符合性表标注「待核验」。投标前须人工对照采购附件逐条核验，避免漏项造成错误选型。</div>' +
             '<div class="pick-group">同品牌 / 同品类降级备选（覆盖率 ' + audit.coverage + "% · 最多 10 款 · 未归类项已标注）</div>" +
             pickResultsHtml(req, pool, unitB, 10, true);
         }
      });
      box.innerHTML = html;
      bindZycgDetailLinks(box);
      bindOriginalNoticeLinks(box);
    }).catch(function (e) {
      box.innerHTML = '<div class="pick-empty">公告详情加载失败：' + esc(e.message) + "</div>";
    });
  }

  // --- 模式 C：浏览机型库 ---
  function initBrowseFilters() {
    if (!picker.products || $("br-cat").dataset.ready) return;
    var cats = {}, brands = {};
    picker.products.forEach(function (p) {
      if (PICK_IT_CATS.indexOf(p.category) >= 0 || p.category === "商显") cats[p.category] = 1;
      if (p.brand) brands[p.brand] = 1;
    });
    var catOrder = PICK_IT_CATS.concat(["商显"]);
    $("br-cat").innerHTML = '<option value="">全部品类</option>' +
      catOrder.filter(function (c) { return cats[c]; })
        .map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("");
    $("br-brand").innerHTML = '<option value="">全部品牌</option>' +
      Object.keys(brands).sort().map(function (b) {
        return '<option value="' + esc(b) + '">' + esc(b) + "</option>";
      }).join("");
    $("br-cat").dataset.ready = "1";
    $("br-brand").dataset.ready = "1";
    picker.browsePage = 1;
    runBrowse();
  }
  function runBrowse() {
    if (!picker.products) return;
    var cat = $("br-cat").value, brand = $("br-brand").value, kw = $("br-key").value.trim().toLowerCase();
    var pool = picker.products.filter(function (p) {
      if (cat && p.category !== cat) return false;
      if (brand && p.brand !== brand) return false;
      if (kw) {
        var hay = (p.name + " " + (p.brand || "") + " " + (p.model || "") + " " + (p.suppliers || []).join(" ")).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      return (b.deals - a.deals) || ((b.price_med || 0) - (a.price_med || 0));
    });
    var pages = Math.max(1, Math.ceil(pool.length / picker.browseSize));
    if (picker.browsePage > pages) picker.browsePage = pages;
    var slice = pool.slice((picker.browsePage - 1) * picker.browseSize, picker.browsePage * picker.browseSize);
    $("br-info").textContent = "共 " + pool.length + " 个机型 · " + picker.browsePage + "/" + pages + " 页";
    var rows = slice.map(function (p) {
      var src = (p.notice_ids && p.notice_ids.length)
        ? " " + originalNoticeLink(p.notice_ids[0], "原公告") : "";
      var price = p.price_min == null ? "-" :
        (p.price_min === p.price_max ? money(p.price_min) : money(p.price_min) + " ~ " + money(p.price_max));
      return "<tr><td>" + esc(p.name) + src + "</td><td>" + esc(p.brand || "-") + "</td><td>" +
        esc(p.category) + "</td><td class=\"num\">" + price + "</td><td class=\"num\">" +
        (p.price_med != null ? money(p.price_med) : "-") + "</td><td class=\"num\">" +
        p.deals + "</td><td>" + (p.last_date || "-") + "</td></tr>";
    }).join("");
    var pager = '<div class="br-pager"><button class="btn ghost" id="br-prev"' +
      (picker.browsePage <= 1 ? " disabled" : "") + ">上一页</button>" +
      '<span class="muted">' + picker.browsePage + " / " + pages + '</span>' +
      '<button class="btn ghost" id="br-next"' + (picker.browsePage >= pages ? " disabled" : "") + ">下一页</button></div>";
    $("br-table").innerHTML =
      '<div style="overflow-x:auto"><table class="br-table"><thead><tr>' +
      "<th>机型 / 规格</th><th>品牌</th><th>品类</th><th>成交单价(元)</th><th>中位价(元)</th><th>成交次数</th><th>最近成交</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>" + pager;
    $("br-prev").addEventListener("click", function () { picker.browsePage--; runBrowse(); });
    $("br-next").addEventListener("click", function () { picker.browsePage++; runBrowse(); });
    bindOriginalNoticeLinks($("br-table"));
  }

  function bindPicker() {
    document.querySelectorAll(".ptab").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".ptab").forEach(function (x) { x.classList.toggle("on", x === b); });
        ["text", "notice", "browse"].forEach(function (n) {
          $("ppane-" + n).classList.toggle("hide", n !== b.dataset.pane);
        });
        $("pick-results").innerHTML = "";
        if (b.dataset.pane === "browse") initBrowseFilters();
        if (b.dataset.pane === "notice") renderNoticeList(picker.noticeFiltered || []);
      });
    });
    $("pick-run").addEventListener("click", runPickText);
    $("pick-text").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runPickText();
    });
    $("pick-notice-run").addEventListener("click", function () { runPickNotice(); });
    $("br-run").addEventListener("click", function () { picker.browsePage = 1; runBrowse(); });
    $("br-key").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { picker.browsePage = 1; runBrowse(); }
    });
  }
  bindPicker();

  // ---------- 全站中标喜讯（官方成交结果 + 当前浏览器手动中标） ----------
  var publicWins = [];
  function winText(w) {
    var amount = Number(w.amount) > 0 ? "，中标金额 " + money(Number(w.amount)) + " 元" : "";
    var products = (w.products || []).slice(0, 2).join("、");
    return "热烈祝贺 " + (w.company || "我司") + " 成功中标「" + (w.title || "采购项目") + "」" + amount + (products ? "，品牌型号：" + products : "");
  }
  // 正式逻辑：顶部滚动条只展示"中标日期 = 今天"的喜讯，当天滚动一天、次日自动隐藏；
  // 测试预览参数已关闭，任何 URL 都不能绕过当天日期过滤
  var HISTORICAL_WIN_IDS = [
    "北京佳业同创科技有限公司_818208",
    "北京佳业同创科技有限公司_813484",
    "北京智鑫盛通科技有限公司_808592",
    "北京智鑫盛通科技有限公司_806171",
    "北京佳业同创科技有限公司_804054",
    "北京智鑫盛通科技有限公司_800747",
    "北京佳业同创科技有限公司_800644"
  ];
  function renderWinTicker(over) {
    var box = $("win-ticker"), track = $("win-ticker-track");
    if (!box || !track) return;
    var pub = (over && over.length) ? over.slice() : publicWins;
    // 只滚动"中标日期 = 今天"的喜讯；当天无中标则整条隐藏
    function ymd(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
    var todayStr = ymd(new Date());
    var merged = pub.filter(function (w) {
      return HISTORICAL_WIN_IDS.indexOf(w.id) < 0 && String(w.date || "").slice(0, 10) === todayStr;
    });
    recState.items.forEach(function (r) {
      if (r.manualResult !== "win") return;
      var wStr = r.winMarkedAt ? ymd(new Date(r.winMarkedAt)) : "";
       if (wStr !== todayStr) return;
      merged.push({
        id: "manual_" + r.id, company: recState.ourCompany || "我司", title: r.title,
        amount: r.budget || 0, products: []
      });
    });
    var seen = {}, rows = [];
    merged.forEach(function (w) { var k = w.id || winText(w); if (!seen[k]) { seen[k] = true; rows.push(w); } });
    box.classList.toggle("hide", rows.length === 0);
    track.innerHTML = rows.map(function (w) { return '<span class="win-ticker-item">' + esc(winText(w)) + "</span>"; }).join("");
    track.style.setProperty("--win-count", Math.max(1, rows.length));
  }
  // ---------- 喜报标书雨：当天有中标则每次进站播放一次；当天无中标或只有历史喜报则不播放 ----------
  function gateStillOn() {
    try { return !sessionStorage.getItem("jiaye_auth_guest_v1"); } catch (e) { return false; }
  }
  // 登录门未通过时先等进入页面再放雨，避免被门（z-index 更高）遮住
  function playRainAfterGate(list) {
    if (gateStillOn()) {
      var t = setInterval(function () { if (!gateStillOn()) { clearInterval(t); playWinRain(list); } }, 400);
      setTimeout(function () { clearInterval(t); }, 60000);
    } else {
      playWinRain(list);
    }
  }
  // ---------- 喜报 FX v6：参考实拍烟花——长尾丝状大牡丹、慢速展开、多朵同开、闪裂星光 + 空压彩虹炮 ----------
  function startWinFx(host, endMs) {
    var cv = document.createElement("canvas");
    cv.className = "win-fx";
    var W = window.innerWidth, H = window.innerHeight;
    cv.width = W; cv.height = H;
    cv.style.width = W + "px"; cv.style.height = H + "px";
    host.insertBefore(cv, host.firstChild);
    var ctx = cv.getContext("2d");
    if (!ctx) return;
    var small = W < 640;
    var P = [], frame = 0, running = true, startT = 0, lastT = 0;
    var frameMs = 1000 / 60;
    // 排程仍以 60fps 虚拟帧表达，但播放进度由真实时间戳驱动，不受 60/120/144Hz 刷新率影响
    var endFrame = Math.round((endMs || 7000) / frameMs);
    var FW_COLORS = ["#ff5d8f", "#ff3df5", "#c46bff", "#ffd60a", "#ff2d55", "#ff7a00"];
    var RAINBOW = ["#ff2d2d", "#ff8a00", "#ffd60a", "#2ecc40", "#00b4ff", "#9b5bff", "#ff5d8f"];
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

    // 牡丹烟花：长尾丝状粒子，慢速展开；仅 3 朵主角大花留存至结束帧
    function peony(x, y, at, col, big, hero, lifeOv) {
      // hero 主角花：粒子尺寸×2；大烟花统一红色；小烟花整体放大 2 倍（数量/展开速度/粒径）
      var cnt = Math.floor((hero ? rnd(280, 420) : big ? rnd(230, 360) : rnd(120, 220)) * (small ? 0.5 : 1));
      var vMax = hero ? (small ? 2.3 : 2.8) : big ? (small ? 2.3 : 2.8) : (small ? 2.8 : 3.4);
      var base = (big || hero) ? "#ff2d55" : col;
      var maxLife = Math.max(50, endFrame - at);
      for (var i = 0; i < cnt; i++) {
        var a = Math.random() * 6.283, sp = vMax * (0.25 + Math.random() * 0.75) * (0.8 + Math.random() * 0.4);
        // 大花（3 朵主角）留存至结束帧、与"恭喜中标"字样同帧消失；小烟花短留存
        var life = lifeOv || (big ? maxLife : Math.min(maxLife, Math.floor(rnd(50, 85))));
        P.push({ t: "fw", x: x, y: y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          born: at, life: life, large: !!(big || hero), dirx: Math.cos(a), diry: Math.sin(a),
          drift: (big || hero) ? rnd(-0.22, 0.22) : 0, ph: rnd(0, 6.28),
          col: Math.random() < (hero ? 0.35 : 0.25) ? "#fff6d8" : base,
          r: hero ? rnd(4.8, 8.8) : big ? rnd(2.4, 4.4) : rnd(4.8, 6.8) });
      }
    }
    // 闪裂星光：细碎闪烁小点，慢速飘散
    function crackle(x, y, at) {
      var cnt = Math.floor(rnd(50, 84) * (small ? 0.5 : 1));
      for (var i = 0; i < cnt; i++) {
        var a = Math.random() * 6.283, sp = rnd(0.3, small ? 1.8 : 2.4);
        P.push({ t: "cr", x: x, y: y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          born: at, life: Math.min(Math.floor(rnd(60, 110)), Math.max(40, endFrame - at)), ph: rnd(0, 6.28), r: rnd(1.4, 2.4) });
      }
    }

    // 排程：前 3 秒（p2start=180 帧）小烟花开场；3 秒后仅 3 朵主角大红花登场（全部大烟花），
    // 大花熄灭帧 = 结束帧，与"恭喜中标"字样同刻消失
    var p2start = 180;
    // 大烟花整段提前约 1 秒：2 秒后依次发射；升空约 1.1-1.4 秒，再缓慢绽放
    var heroLaunch = [p2start - 60, p2start - 24, p2start + 12];
    var heroRise = [
      Math.floor(rnd(66, 82)),
      Math.floor(rnd(66, 82)),
      Math.floor(rnd(66, 82))
    ];
    var heroTimes = [
      heroLaunch[0] + heroRise[0],
      heroLaunch[1] + heroRise[1],
      heroLaunch[2] + heroRise[2]
    ];
    function nearHero(t, gap) {
      for (var h = 0; h < heroTimes.length; h++) if (Math.abs(t - heroTimes[h]) < gap) return true;
      return false;
    }
    // 主角花留存到特效结束帧，与标书/蒙版/字样同刻消失
    var heroLife = [
      Math.max(50, endFrame - heroTimes[0]),
      Math.max(50, endFrame - heroTimes[1]),
      Math.max(50, endFrame - heroTimes[2])
    ];
    for (var hh = 0; hh < 3; hh++) {
      var hx = rnd(0.15, 0.85) * W, hy = rnd(0.08, 0.42) * H;
      var hrise = heroRise[hh];
      var hsx = hx + rnd(-50, 50);
      P.push({ t: "rock", x: hsx, y: H + 12, px: hsx, py: H + 12, x0: hsx, y0: H + 12, tx: hx, ty: hy,
        born: heroLaunch[hh], life: hrise, col: "#ffd60a" });
      peony(hx, hy, heroTimes[hh], "#ff2d55", true, true, heroLife[hh]);
      crackle(hx + rnd(-60, 60), hy + rnd(-40, 40), heroTimes[hh] + 20);
    }
    var smalls = small ? 12 : 24;
    for (var b = 0; b < smalls; b++) {
      var bx = rnd(0.05, 0.95) * W, by = rnd(0.06, 0.5) * H;
      var at = Math.floor(rnd(0, p2start));
      var rise = Math.floor(rnd(24, 40));
      var sx = bx + rnd(-40, 40);
      var col = pick(FW_COLORS);
      P.push({ t: "rock", x: sx, y: H + 12, px: sx, py: H + 12, x0: sx, y0: H + 12, tx: bx, ty: by,
        born: Math.max(0, at - rise), life: rise, col: "#ffe9a8" });
      peony(bx, by, at, col, false, false);
    }
    var crs = small ? 14 : 30;
    var ctMax = Math.floor(endFrame * 0.85);
    for (var c3 = 0; c3 < crs; c3++) {
      var ct = Math.floor(rnd(40, ctMax)), ctries = 0;
      while (nearHero(ct, 35) && ctries < 30) { ct = Math.floor(rnd(40, ctMax)); ctries++; }
      crackle(rnd(0.05, 0.95) * W, rnd(0.08, 0.6) * H, ct);
    }

    // 彩带：底部空压彩虹炮——左右 2 门炮各 4 轮齐射，碎纸片锥形喷出后缓慢翻转飘落
    var CANNONS = [0.12, 0.88], VOLLEYS = [0, Math.floor(endFrame * 0.14), Math.floor(endFrame * 0.32), Math.floor(endFrame * 0.52)];
    for (var vi = 0; vi < VOLLEYS.length; vi++) {
      for (var ci = 0; ci < CANNONS.length; ci++) {
        var cx2 = CANNONS[ci] * W + rnd(-30, 30), v0 = VOLLEYS[vi] + vi * 10;
        var per = small ? 30 : 60;
        for (var k2 = 0; k2 < per; k2++) {
          var ca = -1.5708 + rnd(-0.62, 0.62), cs = rnd(small ? 8 : 10, small ? 14 : 17);
          P.push({ t: "cf", x: cx2, y: H + 12, px: cx2, py: H + 12,
            vx: Math.cos(ca) * cs * (0.55 + Math.random() * 0.5), vy: Math.sin(ca) * cs,
            born: v0 + Math.floor(rnd(0, 26)), life: Math.floor(rnd(240, 320)),
            rot: rnd(0, 360), vr: rnd(-14, 14), wob: rnd(0.6, 2), ph: rnd(0, 6.28),
            col: pick(RAINBOW), s: rnd(4.5, 8.5), ratio: rnd(0.5, 0.85), al: 0 });
        }
      }
    }

    function drawCf(p) {
      // 碎纸片：宽度随翻转收缩，模拟纸片在空气中翻转飘落
      var w = p.s * Math.max(0.25, Math.abs(Math.cos(frame * 0.12 * p.wob + p.ph)));
      var h = p.s * p.ratio;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * 0.01745);
      ctx.globalAlpha = p.al;
      ctx.fillStyle = p.col;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }

    function tick(ts) {
      if (!running) return;
      if (!startT) { startT = ts; lastT = ts; }
      var elapsed = ts - startT;
      var dt = Math.min(3, Math.max(0.1, (ts - lastT) / frameMs));
      lastT = ts;
      frame = elapsed / frameMs;
      if (elapsed >= (endMs || 7000)) {
        running = false;
        ctx.clearRect(0, 0, W, H);
        return;
      }
      ctx.clearRect(0, 0, W, H);
      var i, p, age;
      for (i = 0; i < P.length; i++) {
        p = P[i];
        if (p.t !== "cf" || frame < p.born) continue;
        age = frame - p.born;
        if (age > p.life || p.y > H + 60) { P.splice(i--, 1); continue; }
        p.vy += 0.12 * dt; p.vx *= Math.pow(0.995, dt); p.vy *= Math.pow(0.98, dt);
        p.x += (p.vx + Math.sin(frame * 0.06 * p.wob + p.ph) * 2.2) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.al = age < 8 ? age / 8 : (age > p.life - 60 ? Math.max(0, (p.life - age) / 60) : 1);
        drawCf(p);
      }
      ctx.globalCompositeOperation = "lighter";
      for (i = 0; i < P.length; i++) {
        var q = P[i];
        if (q.t === "cf" || frame < q.born) continue;
        var a3 = frame - q.born;
        if (q.t === "rock") {
          if (a3 > q.life) { P.splice(i--, 1); continue; }
          var rt = a3 / q.life, rp = 1 - Math.pow(1 - rt, 1.9);
          q.px = q.x; q.py = q.y;
          q.x = q.x0 + (q.tx - q.x0) * rp;
          q.y = q.y0 + (q.ty - q.y0) * rp;
          ctx.globalAlpha = 0.95;
          ctx.strokeStyle = q.col; ctx.lineWidth = 2.2;
          ctx.beginPath(); ctx.moveTo(q.px, q.py); ctx.lineTo(q.x, q.y); ctx.stroke();
          var emitFrame = Math.floor(frame / 2);
          if (q.emitFrame !== emitFrame) {
            q.emitFrame = emitFrame;
            P.push({ t: "em", x: q.x + rnd(-2, 2), y: q.y + rnd(0, 6), px: 0, py: 0,
              vx: rnd(-0.4, 0.4), vy: rnd(0, 0.6), born: frame, life: 16, r: rnd(1, 1.8) });
          }
        } else if (q.t === "fw") {
          if (a3 > q.life) { P.splice(i--, 1); continue; }
          q.px = q.x; q.py = q.y;
          var moveX, moveY;
          if (q.large) {
            // 大烟花：慢速绽放且不定格。基础速度渐减，径向外扩 + 缓降组成实际位移。
            var lp = Math.min(1, a3 / q.life);
            var spread = 0.55 - lp * 0.25;
            var fall = 0.18 + lp * 1.05;
            q.vx *= Math.pow(0.982, dt);
            q.vy *= Math.pow(0.982, dt);
            moveX = (q.vx + q.dirx * spread + q.drift + Math.sin(frame * 0.025 + q.ph) * 0.12) * dt;
            moveY = (q.vy + q.diry * spread + fall) * dt;
            // 任意方向的分量可能互相抵消；对实际位移设可见下限，从算法上消除尾段静止点。
            var moveSpd = Math.sqrt(moveX * moveX + moveY * moveY);
            var minMove = 0.9 * dt;
            if (moveSpd < minMove) {
              if (moveSpd < 0.01) { moveX = q.dirx * 0.3 * dt; moveY = 0.85 * dt; moveSpd = Math.sqrt(moveX * moveX + moveY * moveY); }
              moveX = moveX / moveSpd * minMove;
              moveY = moveY / moveSpd * minMove;
            }
          } else {
            // 小烟花：保留扩散感但整体降速，避免高速粒子铺满画面
            q.vx *= Math.pow(0.99, dt);
            q.vy = q.vy * Math.pow(0.99, dt) + 0.012 * dt;
            moveX = q.vx * dt; moveY = q.vy * dt;
          }
          q.x += moveX; q.y += moveY;
          var spd = Math.sqrt(moveX * moveX + moveY * moveY);
          var ln = Math.min(46, Math.max(8, spd * 6));
          var ux = spd > 0.01 ? moveX / spd : 0, uy = spd > 0.01 ? moveY / spd : 0;
          // 整体无渐隐：全亮度保持到寿命结束帧，同刻熄灭
          ctx.globalAlpha = 1;
          ctx.strokeStyle = q.col; ctx.lineWidth = q.r; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - ux * ln, q.y - uy * ln); ctx.stroke();
        } else if (q.t === "cr") {
          if (a3 > q.life) { P.splice(i--, 1); continue; }
          q.vx *= Math.pow(0.98, dt); q.vy += 0.012 * dt;
          q.x += q.vx * dt; q.y += q.vy * dt;
          ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(frame * 0.45 + q.ph));
          ctx.fillStyle = "#fff6d8";
          ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.29); ctx.fill();
        } else if (q.t === "em") {
          if (a3 > q.life) { P.splice(i--, 1); continue; }
          q.vy += 0.05 * dt;
          q.x += q.vx * dt; q.y += q.vy * dt;
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = "#ffd60a";
          ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.29); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function playWinRain(list) {
    if (!list || !list.length) return;
    var host = document.createElement("div");
    host.className = "win-rain";
    var small = window.innerWidth < 640;
    // 标书卡片保底 7 张：新中标不足 7 条时复制同款补齐，避免孤零零一张
    var n = Math.min(list.length, 8);
    var want = Math.max(n, 7), cards = [];
    for (var c2 = 0; c2 < want; c2++) cards.push(list[c2 % n]);
    var lastEnd = 0;
    for (var i = 0; i < cards.length; i++) {
      var w = cards[i];
      var card = document.createElement("div");
      card.className = "win-rain-card";
      card.style.left = (8 + Math.random() * 60).toFixed(1) + "%";
      card.style.animationDelay = (i * 0.28 + Math.random() * 0.2).toFixed(2) + "s";
      lastEnd = Math.max(lastEnd, parseFloat(card.style.animationDelay) + 5.2);
      var amount = Number(w.amount) > 0 ? "，中标金额 " + money(Number(w.amount)) + " 元" : "";
      var products = (w.products || []).slice(0, 2).join("、");
      card.innerHTML = '<span class="r-tag">喜　报</span>' +
        '<div class="r-title">热烈祝贺 ' + esc(w.company || "我司") + ' 中标「' + esc(w.title || "采购项目") + "」</div>" +
        '<div class="r-meta">' + esc(amount + (products ? "　品牌型号：" + products : "")) + "</div>";
      host.appendChild(card);
    }
    // canvas 特效层：大烟花 + 彩带喷泉（卡片已先生成，压在特效之上）
    startWinFx(host, Math.ceil(lastEnd * 1000));
    // "恭喜中标"红色大字：文字直接渲染，自动弹出 → 定格 → 淡出
    var cg = document.createElement("div");
    cg.className = "win-congrats";
    cg.textContent = "恭喜中标";
    host.appendChild(cg);
    document.body.appendChild(host);
    // 标书最后一张落出屏幕的瞬间：红色蒙版与"恭喜中标"同步撤除，烟花继续
    setTimeout(function () {
      host.classList.add("bg-off");
      if (cg.parentNode) cg.parentNode.removeChild(cg);
    }, Math.ceil(lastEnd * 1000) + 40);
    setTimeout(function () { if (host.parentNode) host.parentNode.removeChild(host); }, Math.ceil(lastEnd * 1000) + 250);
  }
  function checkWinRain(d) {
    var wins = (d && d.wins) || [];
    if (!wins.length) return;
    function ymd(d2) { return d2.getFullYear() + "-" + ("0" + (d2.getMonth() + 1)).slice(-2) + "-" + ("0" + d2.getDate()).slice(-2); }
    var todayStr = ymd(new Date());
    var todayWins = wins.filter(function (w) {
      return HISTORICAL_WIN_IDS.indexOf(w.id) < 0 && String(w.date || "").slice(0, 10) === todayStr;
    });
    recState.items.forEach(function (r) {
      if (r.manualResult !== "win" || !r.winMarkedAt || ymd(new Date(r.winMarkedAt)) !== todayStr) return;
      todayWins.push({ id: "manual_" + r.id, company: recState.ourCompany || "我司", title: r.title, amount: r.budget || 0, products: [] });
    });
    if (!todayWins.length) return;
    // 每次重新进站/刷新页面播放一次；SPA 内部切换不会重复调用 loadWinTicker
    playRainAfterGate(todayWins.slice(0, 8));
  }
  function loadWinTicker() {
    getJSON("data/wins.json").then(function (d) {
      publicWins = (d && d.wins) || [];
      checkWinRain(d);
      renderWinTicker();
      return;
    }).catch(function () { publicWins = []; renderWinTicker(); });
  }

  // ---------- 参与投标记录 ----------
  var REC_KEY = "jiaye_bid_records_v1";
  var OUR_COMPANY_NAMES = ["北京佳业同创科技有限公司", "北京智鑫盛通科技有限公司"];
  var recState = { ourCompany: OUR_COMPANY_NAMES.join("、"), items: [], deals: null, dealsMap: null };
  var recKwTimer = null;

  function recLoad() {
    try {
      var raw = JSON.parse(localStorage.getItem(REC_KEY) || "{}");
      recState.ourCompany = raw.ourCompany || OUR_COMPANY_NAMES.join("、");
      recState.items = Array.isArray(raw.items) ? raw.items : [];
    } catch (e) { recState.ourCompany = OUR_COMPANY_NAMES.join("、"); recState.items = []; }
  }
  function recSave() {
    try { localStorage.setItem(REC_KEY, JSON.stringify({ ourCompany: recState.ourCompany, items: recState.items })); } catch (e) {}
    renderWinTicker();
  }
  function recKey(platform, id) { return platform + "_" + id; }
  function recFind(platform, id) {
    var k = recKey(platform, id);
    for (var i = 0; i < recState.items.length; i++) if (recState.items[i].id === k) return recState.items[i];
    return null;
  }
  function recJoined(platform, id) { return !!recFind(platform, id); }

  function normTitle(t) {
    t = String(t || "").replace(/[（(][^）)]*[）)]/g, "");
    ["采购项目需求公告", "采购需求公告", "需求公告", "采购项目成交公告", "成交公告",
     "反拍采购成交公告", "询价采购成交公告", "框采采购成交公告", "反拍成交公告",
     "反拍", "询价", "框采", "竞价", "采购项目", "采购", "公告", "成交"].forEach(function (m) {
      t = t.split(m).join("");
    });
    return t.replace(/[\s·：:，。、\-—\/（）()"“”]/g, "");
  }

  function recEnsureDeals() {
    if (recState.deals) return Promise.resolve(recState.deals);
    return getJSON("data/deals.json").then(function (d) {
      recState.deals = (d && d.deals) ? d.deals : [];
      recState.dealsMap = {};
      recState.deals.forEach(function (x) {
        var k = x.norm_key || normTitle(x.title);
        (recState.dealsMap[k] = recState.dealsMap[k] || []).push(x);
      });
      return recState.deals;
    }).catch(function () { recState.deals = []; recState.dealsMap = {}; return recState.deals; });
  }

  function recToggle(it) {
    var k = recKey(it.platform, it.id);
    if (recJoined(it.platform, it.id)) {
      recState.items = recState.items.filter(function (r) { return r.id !== k; });
    } else {
      recState.items.unshift({
        id: k,
        platform: it.platform,
        noticeId: String(it.id),
        title: it.title || it.enquiry_name || "",
        buyer: it.purchase_company || it.org_name || "",
        category: it.category || "",
        publish_date: String(it.pub_date || it.publish_date || "").slice(0, 10),
        end_time: it.end_time || "",
        budget_num: it.budget_num != null ? it.budget_num : null,
        joinedAt: Date.now(),
        manualResult: null
      });
    }
    recSave();
    loadList();
    recUpdateBadge();
  }
  function recCancel(id) {
    recState.items = recState.items.filter(function (r) { return r.id !== id; });
    recSave();
    recUpdateBadge();
    renderRecords();
  }

  function recMatches(rec) {
    if (rec.platform !== "zycg") return [];
    if (!recState.dealsMap) return [];
    return recState.dealsMap[normTitle(rec.title)] || [];
  }
  function recCompanyWon(supplier) {
    var s = String(supplier || "").trim();
    return OUR_COMPANY_NAMES.indexOf(s) >= 0;
  }
  function recResultOf(rec) {
    if (rec.manualResult === "win") return "win";
    if (rec.manualResult === "lose") return "lose";
    if (rec.manualResult === "pending") return "pending";
    var ds = recMatches(rec);
    if (!ds.length) return "pending";
    return ds.some(function (x) { return recCompanyWon(x.supplier); }) ? "win" : "lose";
  }

  function recUpdateBadge() {
    var n = recState.items.length;
    if ($("n-records")) $("n-records").textContent = n > 0 ? n : "-";
  }

  function renderRecords() {
    recUpdateBadge();
    var box = $("recordsbox");
    if (!box) return;
    recEnsureDeals().then(function () {
      var total = recState.items.length;
      var withResult = 0, wins = 0;
      recState.items.forEach(function (r) {
        var res = recResultOf(r);
        if (res === "win" || res === "lose") { withResult++; if (res === "win") wins++; }
      });
      var rate = withResult ? Math.round(wins / withResult * 100) : 0;
      if ($("st-total")) $("st-total").textContent = total;
      if ($("st-active")) $("st-active").textContent = wins;
      if ($("st-latest")) $("st-latest").textContent = rate + "%";

      // 筛选值
      var fCat = ($("rec-cat") && $("rec-cat").value) || "";
      var fMon = ($("rec-mon") && $("rec-mon").value) || "";
      var fKw = (($("rec-kw") && $("rec-kw").value) || "").trim();

      var cats = {}, months = {};
      recState.items.forEach(function (r) {
        if (r.category) cats[r.category] = 1;
        var m = String(r.publish_date || "").slice(0, 7);
        if (m) months[m] = 1;
      });
      var catOpts = '<option value="">全部品类</option>' + Object.keys(cats).sort().map(function (c) {
        return '<option value="' + esc(c) + '"' + (fCat === c ? " selected" : "") + ">" + esc(c) + "</option>";
      }).join("");
      var monOpts = '<option value="">全部月份</option>' + Object.keys(months).sort().reverse().map(function (m) {
        return '<option value="' + esc(m) + '"' + (fMon === m ? " selected" : "") + ">" + esc(m) + "</option>";
      }).join("");

      var list = recState.items.filter(function (r) {
        if (fCat && r.category !== fCat) return false;
        if (fMon && String(r.publish_date || "").slice(0, 7) !== fMon) return false;
        if (fKw && (r.title + " " + r.buyer + " " + r.category).toLowerCase().indexOf(fKw.toLowerCase()) < 0) return false;
        return true;
      });

      var html = "";
      html += '<div class="rec-head">' +
        '<div class="rec-note"><b>我方中标识别主体：</b>' + esc(OUR_COMPANY_NAMES.join("、")) + '。系统按工商全称精确匹配官方成交结果；匹配成功自动标记「我方中标」并发布全站滚动喜报。</div>' +
        "</div>";

      html += '<div class="rec-stats">' +
        '<div class="rec-stat"><b>' + total + '</b><span>参与项目</span></div>' +
        '<div class="rec-stat"><b>' + withResult + '</b><span>已出结果</span></div>' +
        '<div class="rec-stat"><b>' + wins + '</b><span>我方中标</span></div>' +
        '<div class="rec-stat"><b>' + rate + '%</b><span>中标率</span></div>' +
        "</div>";

      html += '<div class="rec-filters">' +
        '<select id="rec-cat">' + catOpts + "</select>" +
        '<select id="rec-mon">' + monOpts + "</select>" +
        '<input id="rec-kw" type="text" placeholder="搜索项目 / 采购方 / 品类" value="' + esc(fKw) + '">' +
        "</div>";

      if (!list.length) {
        html += '<div class="rec-empty">暂无参与记录。回到「央采询价招投标」或「保利集团招标」，点卡片上的「＋ 参与投标」即可归档到此处。</div>';
      } else {
        list.forEach(function (r) {
          var res = recResultOf(r);
          var ds = recMatches(r);
          var resBadge = res === "win" ? '<span class="rec-badge win">我方中标</span>'
            : res === "lose" ? '<span class="rec-badge lose">未中标</span>'
            : '<span class="rec-badge pending">待出结果</span>';
          var platName = r.platform === "zycg" ? "央采" : (r.platform === "rail" ? "国铁" : "保利");
          var moneyTxt = r.budget_num != null ? "预算 " + money(r.budget_num) + " 元" : "";

          html += '<div class="rec-card" data-id="' + esc(r.id) + '">' +
            '<div class="rec-card-top">' +
              '<span class="tag plat">' + platName + "</span>" +
              (r.category ? '<span class="tag cat">' + esc(r.category) + "</span>" : "") +
              '<span class="rec-date">发布 ' + esc(r.publish_date || "—") + "</span>" +
              (r.budget_num != null ? '<span class="rec-budget">' + moneyTxt + "</span>" : "") +
              resBadge +
            "</div>" +
            '<div class="rec-title">' + esc(r.title) + "</div>" +
            '<div class="rec-meta">采购方 ' + esc(r.buyer || "—") + " · 参与于 " + esc(new Date(r.joinedAt).toLocaleString("zh-CN")) + "</div>";

          // 中标详情（查漏补缺）
          if (ds.length) {
            var uniq = {};
            ds.forEach(function (x) {
              var sk = (x.supplier || "未知") + "|" + (x.brand || "") + "|" + (x.model || "");
              (uniq[sk] = uniq[sk] || []).push(x);
            });
            html += '<div class="rec-deals">';
            Object.keys(uniq).forEach(function (sk) {
              var arr = uniq[sk];
              var first = arr[0];
              var totalAmt = arr.reduce(function (s, x) {
                var amt = Number(x.amount);
                if (!(amt > 0)) amt = (Number(x.unit_price) || 0) * (Number(x.qty) || 0);
                return s + amt;
              }, 0);
              var items = arr.map(function (x) {
                return esc(x.product || "") + " " + esc((x.brand || "") + " " + (x.model || "")).trim() +
                  " ×" + (x.qty != null ? x.qty : "—") + " @ " + (x.unit_price != null ? money(x.unit_price) : "—") + " 元";
              }).join("；");
              html += '<div class="rec-deal">' +
                '<div class="rec-deal-line"><b>中标公司：</b>' + esc(first.supplier || "—") +
                (recCompanyWon(first.supplier) ? '<span class="rec-badge win">我方</span>' : "") + "</div>" +
                '<div class="rec-deal-line"><b>成交明细：</b>' + items + "</div>" +
                '<div class="rec-deal-line"><b>成交合计：</b>' + money(totalAmt) + " 元" +
                (first.date ? "（" + esc(first.date) + "）" : "") + "</div>" +
                (first.notice_id ? '<button type="button" class="rec-view" data-notice="' + esc(first.notice_id) + '">查看成交公告原文</button>' : "") +
                "</div>";
            });
            html += "</div>";
          }

          html += '<div class="rec-actions">' +
            '<label class="rec-manual">手动标注结果：<select class="rec-result-sel" data-id="' + esc(r.id) + '">' +
              '<option value="auto"' + (r.manualResult == null ? " selected" : "") + ">自动判定</option>" +
              '<option value="win"' + (r.manualResult === "win" ? " selected" : "") + ">我方中标</option>" +
              '<option value="lose"' + (r.manualResult === "lose" ? " selected" : "") + ">未中标</option>" +
              '<option value="pending"' + (r.manualResult === "pending" ? " selected" : "") + ">待出结果</option>" +
              "</select></label>" +
            '<button type="button" class="rec-cancel" data-id="' + esc(r.id) + '">取消参与</button>' +
            "</div>" +
            "</div>";
        });
      }

      box.innerHTML = html;
      // 绑定
      if ($("rec-cat")) $("rec-cat").addEventListener("change", renderRecords);
      if ($("rec-mon")) $("rec-mon").addEventListener("change", renderRecords);
      if ($("rec-kw")) $("rec-kw").addEventListener("input", function (e) {
        var el = e.target;
        clearTimeout(recKwTimer);
        recKwTimer = setTimeout(function () {
          renderRecords();
          var ni = $("rec-kw");
          if (ni && el.value) { ni.focus(); try { ni.setSelectionRange(el.value.length, el.value.length); } catch (err) {} }
        }, 350);
      });
      Array.prototype.forEach.call(box.querySelectorAll(".rec-result-sel"), function (s) {
        s.addEventListener("change", function () {
          var rec = null;
          for (var i = 0; i < recState.items.length; i++) if (recState.items[i].id === s.dataset.id) { rec = recState.items[i]; break; }
          if (!rec) return;
          rec.manualResult = s.value === "auto" ? null : s.value;
          if (rec.manualResult === "win") rec.winMarkedAt = rec.winMarkedAt || Date.now();
          else delete rec.winMarkedAt;
          recSave();
          renderRecords();
          renderWinTicker();
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll(".rec-view"), function (b) {
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          openMallNotice(b.dataset.notice);
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll(".rec-cancel"), function (b) {
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          recCancel(b.dataset.id);
        });
      });
    });
  }

  // ---------- 事件 ----------
  document.querySelectorAll(".plat").forEach(function (b) {
    b.addEventListener("click", function () { setPlatform(b.dataset.plat, true); });
  });
  window.addEventListener("hashchange", function () {
    var p = platFromHash();
    if (p !== plat) setPlatform(p, false);
  });
  Array.prototype.forEach.call(document.querySelectorAll(".rail-source-btn"), function (b) {
    b.addEventListener("click", function () {
      if (b.classList.contains("zycg-source-btn")) return;  // 央采子来源单独处理
      state.railSource = b.dataset.source || "";
      state.page = 1;
      document.querySelectorAll(".rail-source-btn").forEach(function (x) { if (!x.classList.contains("zycg-source-btn")) x.classList.toggle("on", x === b); });
      loadList();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll(".zycg-source-btn"), function (b) {
    b.addEventListener("click", function () {
      state.zycgSource = b.dataset.source || "";
      state.page = 1;
      document.querySelectorAll(".zycg-source-btn").forEach(function (x) { x.classList.toggle("on", x === b); });
      loadList();
    });
  });
  $("f-search").addEventListener("click", function () {
    state.filters = currentFilters(); state.page = 1; loadList();
  });
  ["f-keyword"].forEach(function (id) {
    if ($(id)) $(id).addEventListener("keydown", function (e) {
      if (e.key === "Enter") { state.filters = currentFilters(); state.page = 1; loadList(); }
    });
  });
  // 央采 / 保利 / 国铁：切换品类后立即筛选并跳到结果第 1 页，无需再点「查询」
  $("f-category").addEventListener("change", function () {
    if (plat !== "zycg" && plat !== "poly" && plat !== "rail") return;
    state.filters = currentFilters(); state.page = 1; loadList();
  });
  $("f-it").addEventListener("change", function () {
    state.filters = currentFilters(); state.page = 1; loadList();
  });
  // 自定义公告日期日历：只允许点击有公告的日期
  $("f-date-btn").addEventListener("click", function (e) {
    e.stopPropagation();
    $("date-pop").classList.toggle("hide");
    renderDateCalendar();
  });
  $("date-pop").addEventListener("click", function (e) { e.stopPropagation(); });
  $("date-prev").addEventListener("click", function () { shiftDateMonth(-1); });
  $("date-next").addEventListener("click", function () { shiftDateMonth(1); });
  $("date-clear").addEventListener("click", function () {
    $("f-date").value = ""; $("f-date-btn").textContent = "选择公告日期";
    $("date-pop").classList.add("hide"); state.filters = currentFilters(); state.page = 1; loadList();
  });
  document.addEventListener("click", function () { $("date-pop").classList.add("hide"); });
  $("f-reset").addEventListener("click", function () {
    ["f-keyword", "f-date"].forEach(function (i) { if ($(i)) $(i).value = ""; });
    if ($("f-date-btn")) $("f-date-btn").textContent = "选择公告日期";
    if ($("date-pop")) $("date-pop").classList.add("hide");
    $("f-category").value = ""; $("f-status").value = ""; $("f-it").checked = false;
    state.filters = {}; state.page = 1; state.picked = {}; loadList();
  });
  $("pg-prev").addEventListener("click", function () {
    if (state.page > 1) { state.page--; loadList(); window.scrollTo(0, 0); }
  });
  $("pg-next").addEventListener("click", function () {
    state.page++; loadList(); window.scrollTo(0, 0);
  });
  $("sel-all").addEventListener("change", function () {
    var on = $("sel-all").checked;
    document.querySelectorAll(".card").forEach(function (el) {
      if (on) state.picked[el.dataset.id] = true; else delete state.picked[el.dataset.id];
    });
    syncPickUI();
  });
  $("btn-zip").addEventListener("click", downloadZip);
  $("d-close").addEventListener("click", closeDetail);
  $("overlay").addEventListener("click", function (e) { if (e.target === $("overlay")) closeDetail(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDetail(); });

  recLoad();
  recUpdateBadge();
  loadWinTicker();
  setPlatform(plat, false);
  loadCategoryBadges();
})();
