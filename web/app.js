(function () {
  "use strict";
  var state = { page: 1, pageSize: 20, total: 0, filters: {} };

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
    var m = money(it.budget_num != null ? it.budget_num : it.budget_amount);
    return m ? m + " 元" : (it.budget_amount ? esc(it.budget_amount) + " 元" : "—");
  }

  async function api(path) {
    var r = await fetch(path);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  async function loadStatus() {
    try {
      var s = await api("/api/status");
      $("st-total").textContent = s.total;
      $("st-active").textContent = s.active;
      $("st-latest").textContent = (s.latest_date || "-").slice(5);
      $("upd-time").textContent = (s.last_fetch ? "数据更新：" + s.last_fetch : "") +
        (s.fetching ? " · 正在抓取…" : "");
      $("f-refresh").disabled = !!s.fetching;
      $("foot-note").textContent = "数据来源：中央政府采购网电子询价接口 · 每 " +
        Math.round(s.refresh_seconds / 60) + " 分钟自动更新" +
        (s.last_error ? " · 最近错误：" + s.last_error : "");
      return s;
    } catch (e) { return null; }
  }

  async function loadCategories() {
    try {
      var d = await api("/api/categories");
      var sel = $("f-category");
      var cur = sel.value;
      sel.innerHTML = '<option value="">全部品类</option>' +
        (d.categories || []).map(function (c) {
          return '<option value="' + esc(c) + '">' + esc(c) + "</option>";
        }).join("");
      sel.value = cur;
    } catch (e) { }
  }

  function currentFilters() {
    return {
      keyword: $("f-keyword").value.trim(),
      category: $("f-category").value,
      brand: $("f-brand").value.trim(),
      status: $("f-status").value,
      date_from: $("f-from").value,
      date_to: $("f-to").value,
    };
  }

  function buildQuery() {
    var f = state.filters;
    var p = new URLSearchParams();
    p.set("page", state.page);
    p.set("page_size", state.pageSize);
    ["keyword", "category", "brand", "status", "date_from", "date_to"].forEach(function (k) {
      if (f[k]) p.set(k, f[k]);
    });
    return "/api/announcements?" + p.toString();
  }

  async function loadList() {
    var list = $("list");
    list.innerHTML = '<div class="loading">加载中…</div>';
    try {
      var d = await api(buildQuery());
      state.total = d.total;
      var pages = Math.max(1, Math.ceil(d.total / state.pageSize));
      if (state.page > pages) { state.page = pages; return loadList(); }
      if (!d.items || !d.items.length) {
        list.innerHTML = '<div class="empty">没有符合条件的公告</div>';
      } else {
        list.innerHTML = d.items.map(cardHtml).join("");
      }
      $("result-count").textContent = "共 " + d.total + " 条";
      $("pg-info").textContent = state.page + " / " + pages;
      $("pg-prev").disabled = state.page <= 1;
      $("pg-next").disabled = state.page >= pages;
      Array.prototype.forEach.call(list.querySelectorAll(".card"), function (el) {
        el.addEventListener("click", function () { showDetail(el.dataset.id); });
      });
    } catch (e) {
      list.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + "</div>";
    }
  }

  function cardHtml(it) {
    var on = it.is_end === 0;
    return '<div class="card" data-id="' + it.id + '">' +
      '<div class="row1">' +
        '<div class="title">' + esc(it.title || it.enquiry_name) + "</div>" +
        '<div class="budget">' + budgetText(it) + "</div>" +
      "</div>" +
      '<div class="row2">' +
        '<span><b>采购方</b> ' + esc(it.org_name || it.purchase_company || "—") + "</span>" +
        '<span><b>发布</b> ' + esc(it.publish_date || "—") + "</span>" +
        '<span><b>截止</b> ' + esc((it.end_time || "—").slice(0, 16)) + "</span>" +
        (it.category ? '<span class="tag cat">' + esc(it.category) + "</span>" : "") +
        '<span class="badge ' + (on ? "on" : "off") + '">' + (on ? "进行中" : "已截止") + "</span>" +
      "</div>" +
    "</div>";
  }

  async function showDetail(id) {
    $("overlay").classList.add("show");
    $("d-body").innerHTML = '<div class="loading">加载中…</div>';
    document.body.style.overflow = "hidden";
    try {
      var d = await api("/api/announcement/" + id);
      var on = d.is_end === 0;
      var m = money(d.budget_num != null ? d.budget_num : d.budget_amount);
      var prodRows = (d.products || []).map(function (p, i) {
        return "<tr><td>" + (i + 1) + '</td><td>' + esc(p.productName || "—") +
          '</td><td class="spec">' + esc(p.specification || "—") +
          "</td><td>" + esc(p.brands || "不限") + "</td><td>" + esc(p.models || "") +
          "</td><td>" + esc(p.enquiryNum != null ? p.enquiryNum : "") + " " + esc(p.unit || "") + "</td></tr>";
      }).join("");
      var pdfBtn = (d.pdf_path)
        ? '<a class="btn primary" href="' + esc(d.pdf_path) + '" target="_blank">⬇ 下载询价通知书 PDF</a>'
        : (d.pdf_url ? '<a class="btn primary" href="' + esc(d.pdf_url) + '" target="_blank">⬇ 下载 PDF（源站）</a>' : "");
      $("d-body").innerHTML =
        '<div class="d-title">' + esc(d.title || d.enquiry_name) + "</div>" +
        '<div class="d-meta">' +
          metaIt("采购项目", d.enquiry_name) +
          metaIt("采购公司", d.purchase_company || d.org_name) +
          metaIt("预算金额", m ? m + " 元" : (d.budget_amount || "—")) +
          metaIt("询价编号", d.enquiry_no || "—") +
          metaIt("发布日期", d.publish_date || "—") +
          metaIt("响应截止", (d.end_time || "—")) +
          metaIt("品类", d.category || "—") +
          metaIt("状态", '<span class="badge ' + (on ? "on" : "off") + '">' + (on ? "进行中" : "已截止") + "</span>") +
        "</div>" +
        ((d.products && d.products.length)
          ? '<div class="d-sec">品目需求明细</div><div style="overflow-x:auto"><table class="items">' +
            "<thead><tr><th>#</th><th>品名</th><th>规格/需求</th><th>品牌</th><th>型号</th><th>数量</th></tr></thead>" +
            "<tbody>" + prodRows + "</tbody></table></div>"
          : "") +
        ((d.brands) ? '<div class="d-sec">涉及品牌</div><div>' +
          d.brands.split(",").map(function (b) { return '<span class="tag" style="margin:0 6px 6px 0">' + esc(b) + "</span>"; }).join("") + "</div>" : "") +
        '<div class="d-actions">' + pdfBtn +
          '<a class="btn ghost" href="http://mkt.zycg.gov.cn/mall-view/information/detail?noticeId=' + d.id + '" target="_blank">打开央采原页</a>' +
        "</div>";
    } catch (e) {
      $("d-body").innerHTML = '<div class="empty">详情加载失败：' + esc(e.message) + "</div>";
    }
  }
  function metaIt(k, v) { return '<div class="it"><div class="k">' + k + '</div><div class="v">' + v + "</div></div>"; }

  function closeDetail() {
    $("overlay").classList.remove("show");
    document.body.style.overflow = "";
  }

  async function doRefresh() {
    try {
      await fetch("/api/refresh", { method: "POST" });
    } catch (e) { }
    var s = await loadStatus();
    if (s && s.fetching) {
      $("f-refresh").disabled = true;
      $("upd-time").textContent = "正在抓取最新公告…";
      await new Promise(function (res) {
        (function poll() {
          setTimeout(async function () {
            var st = await loadStatus();
            if (st && st.fetching) poll(); else { res(); loadList(); }
          }, 4000);
        })();
      });
    } else {
      loadList();
    }
  }

  // ---- bind ----
  $("f-search").addEventListener("click", function () {
    state.filters = currentFilters(); state.page = 1; loadList();
  });
  $("f-keyword").addEventListener("keydown", function (e) { if (e.key === "Enter") { state.filters = currentFilters(); state.page = 1; loadList(); } });
  $("f-reset").addEventListener("click", function () {
    ["f-keyword", "f-brand", "f-from", "f-to"].forEach(function (i) { $(i).value = ""; });
    $("f-category").value = ""; $("f-status").value = "";
    state.filters = {}; state.page = 1; loadList();
  });
  $("f-refresh").addEventListener("click", doRefresh);
  $("pg-prev").addEventListener("click", function () { if (state.page > 1) { state.page--; loadList(); window.scrollTo(0, 0); } });
  $("pg-next").addEventListener("click", function () { state.page++; loadList(); window.scrollTo(0, 0); });
  $("d-close").addEventListener("click", closeDetail);
  $("overlay").addEventListener("click", function (e) { if (e.target === $("overlay")) closeDetail(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDetail(); });

  // ---- init ----
  loadStatus();
  loadCategories();
  loadList();
  setInterval(loadStatus, 30000);
})();
