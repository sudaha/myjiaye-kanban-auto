(function () {
  "use strict";
  // 双平台静态看板：数据来自 data/<platform>/*.json，筛选与分页在浏览器完成。
  var PLAT_META = {
    zycg: { name: "央采电子询价", sub: "中央政府采购网 · 电子询价「需求公告」", hint: "可勾选多份公告，一键打包下载询价通知书 PDF" },
    poly: { name: "保利集团招标", sub: "中国保利集团招标采购供应链平台 · 全量项目", hint: "保利以工程/服务类为主，勾选「只看 IT 相关」筛硬件项目" },
    bid: { name: "招标公告·新源", sub: "央采主站（招标/征求/更正）+ 中国政府采购网（中央/地方）· 已筛 IT 硬件", hint: "点开卡片跳转原公告页查看采购人与预算；关键词/日期筛选可用" },
    picker: { name: "选型助手", sub: "基于央采卖场真实成交记录建库 · 需求一键选型 + 成交价参考", hint: "粘贴需求文本或挑一条公告，按品类/CPU/品牌匹配机型库（含真实成交价带）" }
  };
  function platFromHash() {
    var h = (location.hash || "").replace("#", "");
    // bid（招标公告·新源）2026-11-17 应用户要求暂时下线，#bid 回退到央采
    return h === "poly" || h === "picker" ? h : "zycg";
  }
  var plat = platFromHash();
  var state = { page: 1, pageSize: 20, total: 0, filters: {}, items: [], loaded: false, picked: {} };
  var picker = {
    products: null,          // data/products.json 的 products 数组
    meta: null,              // 库元信息（updated_at / product_count）
    zycgList: null,          // 央采公告列表（供「选一条公告」用）
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
  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
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
    $("filterbar").classList.toggle("hide", isPicker);
    if ($("f-brand")) $("f-brand").style.display = p === "poly" ? "none" : "";
    $("f-it-wrap").classList.toggle("hide", p !== "poly");
    $("batchbar").classList.toggle("hide", p !== "zycg");
    $("pickerbox").classList.toggle("hide", !isPicker);
    $("list").classList.toggle("hide", isPicker);
    $("pager").classList.toggle("hide", isPicker);
    document.querySelector(".brand h1").textContent = isPicker
      ? "选型助手 · 成交机型库" : m.name + " · 佳业采购雷达";
    document.querySelector(".brand .sub").textContent = m.sub;
    document.title = isPicker ? "选型助手 · 成交机型库" : m.name + " · 佳业采购雷达";
    if (isPicker) {
      $("st-total-lab").textContent = "机型总数";
      $("st-active-lab").textContent = "有成交价";
      $("st-latest-lab").textContent = "最后更新";
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
    ["f-keyword", "f-brand", "f-date"].forEach(function (i) { if ($(i)) $(i).value = ""; });
    $("f-category").value = ""; $("f-status").value = ""; $("f-it").checked = false;
    updateSel();
    if (isPicker) {
      $("result-count").textContent = "";
      $("upd-time").textContent = "";
      loadPickerStatus();
      initPickerNoticeSelect();
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
      $("foot-note").textContent = "数据来源：" + PLAT_META[plat].sub + " · 快照 " + snap;
    }).catch(function () { });
  }
  function loadCategoryBadges() {
      ["zycg", "poly"].forEach(function (p) {
      getJSON("data/" + p + "/status.json").then(function (s) {
        $("n-" + p).textContent = s.total;
      }).catch(function () { });
    });
    getJSON("data/products.json").then(function (d) {
      $("n-picker").textContent = d.product_count;
    }).catch(function () { });
  }
  function loadCategories() {
    return getJSON(pdata("categories.json")).then(function (d) {
      var sel = $("f-category");
      sel.innerHTML = '<option value="">全部品类</option>' +
        (d.categories || []).map(function (c) {
          return '<option value="' + esc(c) + '">' + esc(c) + "</option>";
        }).join("");
    }).catch(function () { });
  }

  // ---------- 筛选 ----------
  function currentFilters() {
    return {
      keyword: $("f-keyword").value.trim(),
      category: $("f-category").value,
      brand: $("f-brand") ? $("f-brand").value.trim() : "",
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
    if (f.brand && String(it.brands || "").toLowerCase().indexOf(f.brand.toLowerCase()) < 0) return false;
    // 按发布日期（平台上架日）精确选某一天；无上架日的旧数据退回标书落款日
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
          if (e.target && e.target.classList.contains("pick")) return;
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
      syncPickUI();
    }).catch(function (e) {
      list.innerHTML = '<div class="empty">数据加载失败：' + esc(e.message) + "</div>";
    });
  }

  function cardHtml(it) {
    var on = it.is_end === 0;
    var pickable = plat === "zycg";
    var checked = pickable && state.picked[it.id];
    var isBid = plat === "bid";
    return '<div class="card' + (pickable ? " pickable" : "") + (checked ? " picked" : "") + '" data-id="' + it.id + '">' +
      (pickable ? '<input type="checkbox" class="pick" data-id="' + it.id + '"' + (checked ? " checked" : "") + ">" : "") +
      '<div class="row1">' +
         '<div class="title">' + esc(it.title || it.enquiry_name) +
           ((plat === "zycg" || plat === "poly") && it.is_new ? '<span class="newtag">新</span>' : "") + "</div>" +
        (isBid ? "" : '<div class="budget">' + budgetText(it) + "</div>") +
      "</div>" +
      '<div class="row2">' +
        '<span><b>' + (isBid ? "采购人" : "采购方") + '</b> ' + esc(it.org_name || it.purchase_company || "—") + "</span>" +
         '<span><b>' + (plat === "zycg" ? "发布" : "发布") + '</b> ' + esc(((it.pub_date || it.publish_date) || "—").slice(0, 16)) + "</span>" +
        (isBid
          ? '<span class="tag cat">' + esc(it.source || "") + "</span>" +
            (it.notice_type ? '<span class="tag">' + esc(it.notice_type) + "</span>" : "") +
            (it.region ? '<span class="tag">' + esc(it.region) + "</span>" : "")
          : '<span><b>' + (plat === "zycg" ? "投标截止" : "截止") + '</b> ' + esc((it.end_time || "—").slice(0, 16)) + "</span>" +
            (it.category ? '<span class="tag cat">' + esc(it.category) + "</span>" : "") +
            (plat === "poly" && it.notice_type_name ? '<span class="tag">' + esc(it.notice_type_name) + "</span>" : "") +
            '<span class="badge ' + (on ? "on" : "off") + '">' + (on ? "进行中" : "已截止") + "</span>") +
      "</div>" +
    "</div>";
  }

  // ---------- 详情 ----------
  function showDetail(id) {
    $("overlay").classList.add("show");
    document.body.style.overflow = "hidden";
    if (plat === "bid") {
      var it = null;
      for (var i = 0; i < state.items.length; i++) {
        if (state.items[i].id === id) { it = state.items[i]; break; }
      }
      $("d-body").innerHTML = it ? detailBid(it) : '<div class="empty">项目未找到</div>';
      return;
    }
    $("d-body").innerHTML = '<div class="loading">加载中…</div>';
    getJSON(pdata("detail/" + id + ".json")).then(function (d) {
      $("d-body").innerHTML = plat === "zycg" ? detailZycg(d) : detailPoly(d);
    }).catch(function (e) {
      $("d-body").innerHTML = '<div class="empty">详情加载失败：' + esc(e.message) + "</div>";
    });
  }
  function metaIt(k, v) { return '<div class="it"><div class="k">' + k + '</div><div class="v">' + v + "</div></div>"; }

  function detailBid(d) {
    return '<div class="d-title">' + esc(d.title) + "</div>" +
      '<div class="d-meta">' +
        metaIt("采购人", esc(d.org_name || "—")) +
        metaIt("代理机构", esc(d.agent || "—")) +
        metaIt("公告类型", esc(d.notice_type || "—")) +
        metaIt("地区", esc(d.region || "—")) +
        metaIt("发布时间", esc(d.publish_date || "—")) +
        metaIt("数据来源", esc(d.source || "—")) +
      "</div>" +
      '<div class="d-actions">' +
        '<a class="btn primary" href="' + esc(d.url) + '" target="_blank">打开原公告（查看预算 / 品目 / 联系方式）</a>' +
      "</div>";
  }

  function detailZycg(d) {
    var on = d.is_end === 0;
    var m = money(d.budget_num);
    var rows = (d.products || []).map(function (p, i) {
      return "<tr><td>" + (i + 1) + "</td><td>" + esc(p.productName || "—") +
        '</td><td class="spec">' + esc(p.specification || "—") +
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
        '<a class="btn ghost" href="http://mkt.zycg.gov.cn/mall-view/information/detail?noticeId=' + d.id + '" target="_blank">打开央采原页</a>' +
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
    return safeName(proj) + "_" + safeName(org) + ".pdf";
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
    lines.push("中央政府采购网 · 电子询价 · 需求公告（" + today + "）· 询价通知书PDF 分类归档");
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

  function fetchPdf(url, timeoutMs) {
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
  function fetchWithRetry(url, tries) {
    return fetchPdf(url, 25000).catch(function (e) {
      if (tries > 1) return fetchWithRetry(url, tries - 1);
      throw e;
    });
  }

  function downloadZip() {
    var ids = Object.keys(state.picked);
    if (!ids.length) return;
    var picked = state.items.filter(function (it) { return state.picked[it.id] && it.has_pdf; });
    var noPdf = ids.length - picked.length;
    if (!picked.length) {
      $("zip-progress").textContent = "选中项都没有 PDF 附件";
      return;
    }
    var btn = $("btn-zip");
    btn.disabled = true;
    var out = [], okItems = [], i = 0, failed = 0;
    function finish() {
      if (!out.length) {
        $("zip-progress").textContent = "打包失败：0 份成功" + (failed ? "（" + failed + " 份下载失败，请重试）" : "");
        btn.disabled = false;
        return;
      }
      $("zip-progress").textContent = "正在生成压缩包…";
      out.push({ name: "清单.txt", data: new TextEncoder().encode(buildManifestTxt(okItems)) });
      var blob = buildZip(out);
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "中央政采网_电子询价_" + new Date().toISOString().slice(0, 10) + "_询价通知书PDF.zip";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      $("zip-progress").textContent = "完成：" + out.length + " 份" +
        (failed ? "（" + failed + " 份失败已跳过）" : "") + (noPdf ? "（另有 " + noPdf + " 项无 PDF）" : "");
      btn.disabled = false;
    }
    function next() {
      if (i >= picked.length) { finish(); return; }
      var it = picked[i];
      $("zip-progress").textContent = "打包中 " + (i + 1) + "/" + picked.length +
        "：" + (it.title || "").slice(0, 16) + (failed ? "（已失败 " + failed + "）" : "");
      fetchWithRetry("pdf/zycg/" + it.id + ".pdf", 2).then(function (buf) {
        out.push({
          name: catFolder(it) + "/" + pdfFileName(it),
          data: new Uint8Array(buf)
        });
        okItems.push(it);
        i++; next();
      }).catch(function () {
        failed++; i++; next();
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

  function scoreProduct(p, req) {
    var hay = ((p.brand || "") + " " + (p.name || "")).toLowerCase();
    var hits = [];
    var score = 0;
    req.brands.forEach(function (b) {
      if (hay.indexOf(b.toLowerCase()) >= 0) { score += 30; hits.push("品牌·" + b); }
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

  function pickCardHtml(x, unitBudget) {
    var p = x.p;
    var cls = x.s.score >= 60 ? "hit-good" : (x.s.score >= 30 ? "hit-mid" : "hit-low");
    var price = (p.price_min === p.price_max)
      ? '<b>' + money(p.price_min) + "</b> 元"
      : money(p.price_min) + " ~ " + money(p.price_max) + ' 元（中位 <b>' + money(p.price_med) + "</b>）";
    var budgetTag = "";
    if (unitBudget && p.price_med != null) {
      if (p.price_max <= unitBudget) budgetTag = ' <span class="budget-ok">✓ 预算内</span>';
      else if (p.price_min <= unitBudget) budgetTag = ' <span class="budget-warn">~ 部分档位在预算内</span>';
      else budgetTag = ' <span class="budget-bad">! 超预算（最低 ' + money(p.price_min) + " 元）</span>";
    }
    var src = (p.notice_ids && p.notice_ids.length)
      ? ' <a target="_blank" href="https://mkt.zycg.gov.cn/mall-view/information/detail?noticeId=' + p.notice_ids[0] + '">查看原始成交公告</a>' : "";
    return '<div class="pick-card ' + cls + '">' +
      '<div class="pc-head"><span class="pc-name">' + esc(p.name) + "</span>" +
      '<span class="tag cat">' + esc(p.category) + "</span>" +
      (p.brand ? '<span class="tag">' + esc(p.brand) + "</span>" : "") +
      '<span class="badge on">成交 ' + p.deals + " 次</span></div>" +
      '<div class="pc-price">成交单价：' + price + budgetTag + "</div>" +
      (x.s.hits.length ? '<div class="pc-hits">' +
        x.s.hits.map(function (h) { return '<span class="chip">' + esc(h) + "</span>"; }).join("") + "</div>" : "") +
      '<div class="pc-meta">最近成交 ' + (p.last_date || "-") +
      (p.suppliers && p.suppliers.length
        ? " · 供应商：" + esc(p.suppliers[0]) + (p.suppliers.length > 1 ? " 等 " + p.suppliers.length + " 家" : "") : "") +
      src + "</div></div>";
  }

  function pickResultsHtml(req, pool, unitBudget) {
    if (!pool.length) {
      return '<div class="pick-empty">机型库中没有对应品类的成交记录，试试放宽品类或关键词</div>';
    }
    var scored = pool.map(function (p) { return { p: p, s: scoreProduct(p, req) }; })
      .filter(function (x) { return x.s.score >= 20; })
      .sort(function (a, b) { return b.s.score - a.s.score || b.p.deals - a.p.deals; })
      .slice(0, 20);
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
      scored.map(function (x) { return pickCardHtml(x, unitBudget); }).join("");
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
    });
  }

  // --- 模式 B：选一条央采公告 ---
  function ensureZycgList() {
    if (picker.zycgList) return Promise.resolve();
    return getJSON("data/zycg/list.json").then(function (d) {
      picker.zycgList = d.items || [];
    });
  }
  // 央采公告品类 → 界面叫法（按数据里的 category 值映射）
  var NOTICE_CAT_LABELS = {
    "服务器": "服务器", "网络": "网络设备", "视频会议": "会议设备",
    "存储": "存储设备", "打印机": "打印机", "计算机": "台式计算机", "网络安全": "安全设备"
  };
  var NOTICE_CAT_ORDER = ["服务器", "网络", "视频会议", "存储", "打印机", "计算机", "网络安全"];

  function fillNoticeSelect() {
    var cat = $("pick-notice-cat").value;
    var items = picker.zycgList.slice().filter(function (it) {
      return !cat || (it.category || "") === cat;
    }).sort(function (a, b) {
      if (a.is_end !== b.is_end) return a.is_end - b.is_end;
      return String(b.publish_date || "").localeCompare(String(a.publish_date || ""));
    });
    $("pick-notice").innerHTML = items.length
      ? items.map(function (it) {
          return '<option value="' + it.id + '">' + (it.is_end === 0 ? "【进行中】" : "【已截止】") +
            esc(it.title || it.enquiry_name) + " · " + esc(it.org_name || it.purchase_company || "") + "</option>";
        }).join("")
      : '<option value="">该类型下暂无公告</option>';
  }

  function initPickerNoticeSelect() {
    if ($("pick-notice").dataset.ready) return;
    ensureZycgList().then(function () {
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
      fillNoticeSelect();
      $("pick-notice").dataset.ready = "1";
    });
  }
  function runPickNotice() {
    var id = $("pick-notice").value;
    var box = $("pick-results");
    if (!id) { box.innerHTML = '<div class="pick-empty">请先选择一条公告</div>'; return; }
    box.innerHTML = '<div class="loading">加载公告品目…</div>';
    ensureProducts().then(function () {
      return getJSON("data/zycg/detail/" + id + ".json");
    }).then(function (d) {
      var prods = d.products || [];
      var qtyTotal = prods.reduce(function (s, p) { return s + (Number(p.enquiryNum) || 0); }, 0);
      var unitBudget = (d.budget_num && qtyTotal > 0) ? Math.round(d.budget_num / qtyTotal) : null;
      var html = '<div class="req-line">公告：<b>' + esc(d.title || d.enquiry_name) + "</b><br>" +
        "采购公司：" + esc(d.purchase_company || d.org_name || "-") + " · 品类：" + esc(d.category || "-") +
        (d.budget_num ? " · 总预算 " + money(d.budget_num) + " 元" : "") +
        (unitBudget ? "（折合约 " + money(unitBudget) + " 元/台）" : "") +
        (d.brands ? "<br>指定品牌：" + esc(d.brands) : "") + "</div>";
      if (!prods.length) {
        html += '<div class="pick-empty">该公告没有结构化品目明细，请切到「粘贴需求文本」直接贴参数</div>';
        box.innerHTML = html;
        return;
      }
      prods.forEach(function (p, idx) {
        var itemText = [p.productName, p.specification, p.brands, p.models].join(" ");
        var req = parseReq(itemText);
        if (!req.cats.length && d.category && PICK_IT_CATS.indexOf(d.category) >= 0) req.cats = [d.category];
        if (!req.brands.length && d.brands) {
          d.brands.split(",").forEach(function (b) {
            b = b.trim();
            if (b && b !== "不限" && PICK_BRANDS.indexOf(b) >= 0 && req.brands.indexOf(b) < 0) req.brands.push(b);
          });
        }
        var unitB = (Number(p.enquiryNum) && d.budget_num && prods.length === 1)
          ? Math.round(d.budget_num / Number(p.enquiryNum)) : unitBudget;
        html += '<div class="pick-group">品目 ' + (idx + 1) + "：" + esc(p.productName || "未命名") +
          (p.enquiryNum ? " × " + esc(p.enquiryNum) + " " + esc(p.unit || "") : "") + "</div>";
        html += '<div class="req-line">' + reqChipsHtml(req) +
          (unitB ? " · 折合单价预算 ≈ " + money(unitB) + " 元" : "") + "</div>";
        html += pickResultsHtml(req, pickPool(req), unitB);
      });
      box.innerHTML = html;
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
        ? ' <a target="_blank" href="https://mkt.zycg.gov.cn/mall-view/information/detail?noticeId=' + p.notice_ids[0] + '">源</a>' : "";
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
      });
    });
    $("pick-run").addEventListener("click", runPickText);
    $("pick-text").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runPickText();
    });
    $("pick-notice-run").addEventListener("click", runPickNotice);
    $("br-run").addEventListener("click", function () { picker.browsePage = 1; runBrowse(); });
    $("br-key").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { picker.browsePage = 1; runBrowse(); }
    });
  }
  bindPicker();

  // ---------- 事件 ----------
  document.querySelectorAll(".plat").forEach(function (b) {
    b.addEventListener("click", function () { setPlatform(b.dataset.plat, true); });
  });
  window.addEventListener("hashchange", function () {
    var p = platFromHash();
    if (p !== plat) setPlatform(p, false);
  });
  $("f-search").addEventListener("click", function () {
    state.filters = currentFilters(); state.page = 1; loadList();
  });
  ["f-keyword", "f-brand"].forEach(function (id) {
    if ($(id)) $(id).addEventListener("keydown", function (e) {
      if (e.key === "Enter") { state.filters = currentFilters(); state.page = 1; loadList(); }
    });
  });
  $("f-it").addEventListener("change", function () {
    state.filters = currentFilters(); state.page = 1; loadList();
  });
  // 选中日期即筛选（不用再点"查询"）；清空日期则恢复全部
  $("f-date").addEventListener("change", function () {
    state.filters = currentFilters(); state.page = 1; loadList();
  });
  $("f-reset").addEventListener("click", function () {
    ["f-keyword", "f-brand", "f-date"].forEach(function (i) { if ($(i)) $(i).value = ""; });
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

  setPlatform(plat, false);
  loadCategoryBadges();
})();
