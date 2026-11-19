/* docs_v3.js (part 3, v4) —— 4 子模块 UI：报价单 / 货物签收单 / PDF 导出 / 一键成表 */
(function () {
  "use strict";
  var D = window.Docs || {};
  var X = window.DocsV3.xlsx, DX = window.DocsV3.docx, PV = window.DocsV3.preview;
  function $(id) { return document.getElementById(id); }

  var PREVIEW_CSS =
    ".doc-paper{background:#fff;color:#000;font-family:宋体,SimSun,serif;font-size:12px;line-height:1.6;box-sizing:border-box}" +
    ".dq-paper{padding:28px 30px;min-width:900px}" +
    ".dq-top{display:flex;align-items:flex-start;gap:16px;margin-bottom:8px}" +
    ".dq-logo{height:64px;width:auto}" +
    ".dq-logo-ph{font-size:14px;color:#356;font-weight:700;padding-top:20px}" +
    ".dq-co{flex:1}" +
    ".dq-t1{text-align:center;font-size:26px;font-weight:700;letter-spacing:12px}" +
    ".dq-t2{text-align:center;font-size:16px;margin:2px 0 8px}" +
    ".dq-c1{font-size:14px;font-weight:700;letter-spacing:2px}" +
    ".dq-c2,.dq-c3{font-size:11px}" +
    ".dq-to{width:340px;text-align:right;font-size:13px}" +
    ".dq-date{margin-top:14px}" +
    ".dq-table{width:100%;border-collapse:collapse;table-layout:fixed}" +
    ".dq-table th,.dq-table td{border:1px solid #000;padding:4px 6px;font-size:12px;word-wrap:break-word;vertical-align:middle}" +
    ".dq-table thead th{font-weight:700;text-align:center}" +
    ".dq-table .c{text-align:center}.dq-table .r{text-align:right}" +
    ".dq-table .spec{text-align:left;font-size:11px}" +
    ".dq-table .w-no{width:44px}.dq-table .w-name{width:110px}.dq-table .w-model{width:90px}" +
    ".dq-table .w-qty{width:64px}.dq-table .w-unit{width:48px}.dq-table .w-price{width:90px}.dq-table .w-total{width:96px}" +
    ".dq-table .tb{font-weight:700}" +
    ".dq-table tbody tr:not(.dq-total):not(.dq-remark) td{height:40px}" +
    ".dq-total td{height:30px}" +
    ".dq-remark td{height:74px;vertical-align:top;font-size:11px}" +
    ".dq-contact{margin-top:10px;text-align:right;font-size:12px}" +
    ".dr-paper{padding:34px 44px;max-width:760px}" +
    ".dr-title{text-align:center;font-size:22px;font-weight:700;letter-spacing:8px;margin-bottom:18px}" +
    ".dr-meta{font-size:12px;margin-bottom:22px}" +
    ".dr-sub{text-align:center;margin-bottom:8px}" +
    ".dr-table{width:100%;border-collapse:collapse;table-layout:fixed}" +
    ".dr-table th,.dr-table td{border:1px solid #000;padding:6px;font-size:12px;word-wrap:break-word;vertical-align:middle}" +
    ".dr-table thead th{text-align:center;font-weight:700}" +
    ".dr-table .c{text-align:center}.dr-table .spec{font-size:11px}" +
    ".dr-table .w1{width:24%}.dr-table .w2{width:46%}.dr-table .w3{width:12%}.dr-table .w4{width:18%}" +
    ".dr-line{font-size:12px;margin-top:10px}" +
    ".dr-addr{line-height:1.8}" +
    ".dr-sign{margin-top:26px;border-top:1px dashed #000;padding-top:0;font-size:13px}" +
    ".dr-sign-bar{display:inline-block;background:#000;color:#fff;padding:4px 24px;font-weight:700;letter-spacing:6px;transform:translateY(-50%)}" +
    ".dr-signline{display:block;font-weight:400;letter-spacing:0;margin:18px 0 48px;font-size:12px;line-height:5}" +
    ".dr-declare{border-top:1px solid #000;padding-top:10px;font-size:11px;line-height:2}" +
    ".dt-paper{padding:34px 40px;max-width:860px}" +
    ".dt-title{text-align:center;font-size:20px;font-weight:700;letter-spacing:6px;margin-bottom:16px}" +
    ".dt-meta{font-size:12px;margin-bottom:12px}" +
    ".dt-table{width:100%;border-collapse:collapse;table-layout:fixed}" +
    ".dt-table th,.dt-table td{border:1px solid #000;padding:6px;font-size:12px;word-wrap:break-word;vertical-align:middle}" +
    ".dt-table thead th{text-align:center;font-weight:700;background:#f2f2f2}" +
    ".dt-table .c{text-align:center}.dt-table .r{text-align:right}.dt-table .spec{font-size:11px}" +
    ".dt-table .w1{width:20%}.dt-table .w2{width:13%}.dt-table .w3{width:37%}.dt-table .w4{width:9%}.dt-table .w5{width:7%}.dt-table .w6{width:9%}.dt-table .w7{width:15%}" +
    ".dt-total td{font-weight:700}";

  var PRINT_CSS = "@page{margin:10mm}html,body{margin:0;padding:0}.dr-paper,.dt-paper{max-width:none;width:auto}" + PREVIEW_CSS;

  function printPdf(bodyHtml, landscape, title) {
    var html = "<!doctype html><html><head><meta charset='utf-8'><title>" + (title || "打印") +
      "</title><style>" + PRINT_CSS + "</style></head><body>" + bodyHtml + "</body></html>";
    var ifr = document.createElement("iframe");
    ifr.style.cssText = "position:fixed;right:100%;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(ifr);
    var d = ifr.contentWindow.document;
    d.open(); d.write(html); d.close();
    setTimeout(function () {
      try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) { }
      setTimeout(function () { if (ifr.parentNode) ifr.parentNode.removeChild(ifr); }, 120000);
    }, 400);
  }

  // 通用表格预览（一键成表 / 无模板 PDF 兜底）
  function previewTableHtml(p) {
    var trs = p.items.map(function (it, i) {
      var spec = it.spec || it.model || "";
      if (it.model && it.spec) spec = it.model + " " + it.spec;
      return "<tr>" +
        '<td class="c">' + (i + 1) + "</td>" +
        "<td>" + escH(it.name) + "</td>" +
        '<td class="spec">' + escH(spec) + "</td>" +
        '<td class="c">' + escH(it.qty) + "</td>" +
        '<td class="c">' + escH(it.unit) + "</td>" +
        '<td class="r">' + (it.price != null ? X.fmtMoney(it.price) : "") + "</td>" +
        '<td class="r">' + (it.price != null ? X.fmtMoney((it.qty || 0) * it.price) : "") + "</td></tr>";
    }).join("");
    var total = 0;
    p.items.forEach(function (it) { total += (it.qty || 0) * (it.price || 0); });
    return '<div class="doc-paper dt-paper"><div class="dt-title">产品清单</div>' +
      '<div class="dt-meta">日期：' + escH(p.fields.date || "") + (p.fields.customer ? "　客户：" + escH(p.fields.customer) : "") + "</div>" +
      '<table class="dt-table"><thead><tr><th class="w1">序号</th><th class="w2">产品名称</th><th class="w3">配置及参数</th>' +
      "<th class='w4'>数量</th><th class='w5'>单位</th><th class='w6'>单价(元)</th><th class='w7'>合计(元)</th></tr></thead><tbody>" + trs +
      '<tr class="dt-total"><td colspan="6" class="r">合计金额</td><td class="r">' + X.fmtMoney(total) + "</td></tr></tbody></table></div>";
  }
  function escH(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  }

  /* ---------- 状态 ---------- */
  var state = {
    kind: "quote",
    custom: { xlsx: null, docx: null },
    customName: { xlsx: "", docx: "" },
    last: null,
    tplCache: {}, logoUrl: ""
  };
  function msg(t, err) {
    var el = $("docs-msg");
    if (el) { el.textContent = t || ""; el.style.color = err ? "#c0392b" : ""; }
  }
  function assetVer() {
    var s = document.querySelector('script[src*="docs_v3.js"]');
    var m = s && s.src.match(/[?&]v=([\w]+)/);
    return m ? m[1] : String(Date.now());
  }
  function loadTplBuf(file, force) {
    // 仅「一键成表」内置模板支持自定义模板替换
    var customKey = file === "generic_table.xlsx" ? "xlsx" : (file === "generic_table.docx" ? "docx" : null);
    if (customKey && !force && state.custom[customKey]) return Promise.resolve(state.custom[customKey]);
    var url = "/templates/" + file + "?v=" + assetVer() + (force ? "&t=" + Date.now() : "");
    if (!force && state.tplCache[url]) return state.tplCache[url];
    var pr = fetch(url, force ? { cache: "no-store" } : undefined).then(function (r) {
      if (!r.ok) throw new Error("模板加载失败：" + url);
      return r.arrayBuffer();
    }).catch(function (e) {
      // 网络瞬断不能永久缓存 rejected Promise；清理后允许 no-store 重试。
      delete state.tplCache[url];
      throw e;
    });
    if (!force) state.tplCache[url] = pr;
    return pr;
  }
  function logoDataUrl() {
    if (state.logoUrl) return Promise.resolve(state.logoUrl);
    return loadTplBuf("quote_template.xlsx").then(function (buf) {
      return JSZip.loadAsync(buf).then(function (zip) {
        var f = zip.file("xl/media/image1.png");
        if (!f) { state.logoUrl = ""; return ""; }
        return f.async("base64").then(function (b64) { state.logoUrl = "data:image/png;base64," + b64; return state.logoUrl; });
      });
    }).catch(function () { state.logoUrl = ""; return ""; });
  }
  function download(buf, name) {
    var blob = new Blob([buf], { type: "application/octet-stream" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  function clearLastFile() {
    if (state.last && state.last.url) {
      try { URL.revokeObjectURL(state.last.url); } catch (e) { }
    }
    state.last = null;
  }
  function mimeOf(kind) {
    return kind === "quote"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  function hexOf(buf) {
    if (!window.crypto || !window.crypto.subtle) return Promise.resolve("");
    return window.crypto.subtle.digest("SHA-256", buf).then(function (hash) {
      return Array.from(new Uint8Array(hash)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    }).catch(function () { return ""; });
  }
  async function commitFormalFile(buf, name, kind) {
    clearLastFile();
    var blob = new Blob([buf], { type: mimeOf(kind) });
    var hash = await hexOf(buf);
    var url = URL.createObjectURL(blob);
    state.last = { buf: buf, blob: blob, url: url, name: name, kind: kind, hash: hash };
    return state.last;
  }
  function formalFilePanel(file) {
    var shortHash = file.hash ? file.hash.slice(0, 16) + "…" : "当前浏览器不支持计算";
    return '<div class="formal-file-panel" data-file-hash="' + escH(file.hash || "") + '">' +
      '<div class="formal-file-title">正式文件已生成</div>' +
      '<div class="formal-file-note">此处不再使用 HTML 模拟 Office 排版。请点下方「打开正式文件预览」，您查看的就是稍后下载的同一份文件。</div>' +
      '<div class="formal-file-meta"><b>文件：</b>' + escH(file.name) +
      '　<b>大小：</b>' + (file.blob.size / 1024).toFixed(1) + ' KB' +
      '　<b>SHA-256：</b><code>' + escH(shortHash) + '</code></div>' +
      '<div class="formal-file-rule">打开预览与正式下载共用同一 Blob、同一对象地址，不会二次生成。</div>' +
      '</div>';
  }

  /* ---------- 读取 zip 三段 ---------- */
  function readParts(zip, xlsx) {
    if (xlsx) {
      var sx = zip.file("xl/worksheets/sheet1.xml");
      if (!sx) throw new Error("模板缺少工作表");
      return Promise.all([
        sx.async("string"),
        zip.file("xl/sharedStrings.xml") ? zip.file("xl/sharedStrings.xml").async("string") : Promise.resolve(null),
        zip.file("xl/styles.xml") ? zip.file("xl/styles.xml").async("string") : Promise.resolve("")
      ]).then(function (a) { return { sheet: a[0], ss: a[1], styles: a[2] }; });
    }
    var dx = zip.file("word/document.xml");
    if (!dx) throw new Error("模板缺少文档");
    return dx.async("string").then(function (x) { return { doc: x }; });
  }

  /* ---------- 生成 ---------- */
  async function buildQuote(p, force) {
    var zip = await JSZip.loadAsync(await loadTplBuf("quote_template.xlsx", force));
    var a = await readParts(zip, true);
    var res = X.buildXlsxXml(a.sheet, a.ss, a.styles, p, "quote");
    zip.file("xl/worksheets/sheet1.xml", res.sheetXml);
    if (res.ssXml && a.ss) zip.file("xl/sharedStrings.xml", res.ssXml);
    if (res.stylesXml && a.styles) zip.file("xl/styles.xml", res.stylesXml);
    return zip.generateAsync({ type: "arraybuffer" });
  }
  async function buildReceipt(p, force) {
    var zip = await JSZip.loadAsync(await loadTplBuf("receipt_template.docx", force));
    var a = await readParts(zip, false);
    var res = DX.buildDocxXml(a.doc, p);
    if (res.leftTokens.length) msg("提示：模板残留未识别占位符 " + res.leftTokens.join(" "));
    zip.file("word/document.xml", res.xml);
    return zip.generateAsync({ type: "arraybuffer" });
  }
  async function buildTable(p, type, force) {
    // type: xlsx | docx
    var file = type === "xlsx" ? "generic_table.xlsx" : "generic_table.docx";
    var zip = await JSZip.loadAsync(await loadTplBuf(file, force));
    var a = await readParts(zip, type === "xlsx");
    if (type === "xlsx") {
      var res = X.buildXlsxXml(a.sheet, a.ss, a.styles, p, "quote");
      zip.file("xl/worksheets/sheet1.xml", res.sheetXml);
      if (res.ssXml && a.ss) zip.file("xl/sharedStrings.xml", res.ssXml);
      if (res.stylesXml && a.styles) zip.file("xl/styles.xml", res.stylesXml);
    } else {
      var res2 = DX.buildDocxXml(a.doc, p);
      zip.file("word/document.xml", res2.xml);
    }
    return zip.generateAsync({ type: "arraybuffer" });
  }

  function detectKind(p) {
    if (p.fields.delivery || p.fields.freight || p.fields.courier || p.fields.addr) return "receipt";
    return "quote";
  }
  function previewOf(kind, p) {
    if (kind === "quote") {
      var total = 0;
      p.items.forEach(function (it) { total += (it.qty || 0) * (it.price || 0); });
      return { html: PV.previewQuoteHtml(p, total, state.logoUrl || ""), landscape: true };
    }
    if (kind === "receipt") return { html: PV.previewReceiptHtml(p), landscape: false };
    return { html: previewTableHtml(p), landscape: false };
  }

  function parseInput() {
    var text = ($("docs-input") || { value: "" }).value.trim();
    if (!text) { msg("请先粘贴信息（或点「图片识别」）", true); return null; }
    var p = D.parseFree(text);
    if (!p.items.length) { msg("未识别到产品行。每行一件产品即可，无需符号，例如：联想开天X5h G1d-A007 LK-X5h 海光C86-4G/16G内存 10台 8300", true); return null; }
    return p;
  }

  // 报价单 / 签收单：生成预览
  async function doPreview() {
    msg("");
    var pv = $("docs-preview");
    if (pv) pv.innerHTML = "";
    var p = parseInput();
    if (!p) return;
    var kind = state.kind; // quote | receipt
    var attempt = 0;
    for (;;) {
      try {
        var buf = kind === "quote" ? await buildQuote(p, attempt > 0) : await buildReceipt(p, attempt > 0);
        var name = kind === "quote"
          ? "报价单_" + (p.fields.customer || "客户") + "_" + (p.fields.date || "") + ".xlsx"
          : "签收单_" + (p.fields.contract || p.fields.customer || "客户") + ".docx";
        var file = await commitFormalFile(buf, name, kind);
        if (pv) { pv.innerHTML = formalFilePanel(file); pv.classList.remove("hide"); }
        var act = $("docs-actions");
        if (act) act.classList.remove("hide");
        showMainAction();
        msg("正式文件已生成；打开预览与下载使用同一份文件（指纹 " + (file.hash ? file.hash.slice(0, 12) : "不可用") + "…）");
        break;
      } catch (e) {
        if (attempt === 0 && /模板/.test(e.message) && /产品行|占位符|表格/.test(e.message)) { attempt = 1; continue; }
        msg("生成失败：" + e.message, true);
        break;
      }
    }
  }
  // PDF 导出模块：一键
  async function doPdf() {
    msg("");
    var p = parseInput();
    if (!p) return;
    var kind = detectKind(p);
    var pr = previewOf(kind, p);
    var title = (kind === "receipt" ? "签收单" : "报价单") + "_" + (p.fields.customer || "客户") + "_" + (p.fields.date || "") + ".pdf";
    state.last = { html: pr.html, landscape: pr.landscape, kind: kind };
    printPdf(pr.html, pr.landscape, title);
    msg("已打开打印对话框（" + (kind === "receipt" ? "识别为签收单" : "识别为报价单") + "）：目标打印机选「另存为 PDF」即可");
  }
  // 一键成表：三个通道
  async function doTable(type) { // xlsx | docx | pdf
    msg("");
    var p = parseInput();
    if (!p) return;
    var attempt = 0;
    for (;;) {
      try {
        if (type === "pdf") {
          printPdf(previewTableHtml(p), false, "表格_" + (p.fields.customer || "") + ".pdf");
          msg("已打开打印对话框：目标打印机选「另存为 PDF」");
        } else {
          var buf = await buildTable(p, type, attempt > 0);
          var name = "表格_" + (p.fields.customer || p.fields.date || "") + (type === "xlsx" ? ".xlsx" : ".docx");
          download(buf, name);
          msg("已生成并下载 " + name + (state.custom[type] ? "（使用您上传的模板）" : ""));
        }
        break;
      } catch (e) {
        if (attempt === 0 && /模板/.test(e.message) && /产品行|占位符|表格/.test(e.message)) { attempt = 1; continue; }
        msg("生成失败：" + e.message, true);
        break;
      }
    }
  }

  /* ---------- 自定义模板（仅一键成表模块） ---------- */
  async function loadCustomTpl(file) {
    var isX = /\.xlsx?$/i.test(file.name);
    var type = isX ? "xlsx" : "docx";
    try {
      var buf = await file.arrayBuffer();
      var zip = await JSZip.loadAsync(buf);
      if (type === "xlsx") {
        var a = await readParts(zip, true);
        X.detectXlsx(a.sheet, X.parseSharedStrings(a.ss));
      } else {
        var a2 = await readParts(zip, false);
        DX.detectDocx(a2.doc);
      }
      state.custom[type] = buf;
      state.customName[type] = file.name;
      tplChip();
      msg("模板已启用（" + (type === "xlsx" ? "Excel" : "Word") + "）：" + file.name);
    } catch (e) {
      msg("模板无效：" + e.message + "（产品行需包含 {名称}{数量} 占位符）", true);
    }
  }
  function resetTpl() {
    state.custom.xlsx = null; state.custom.docx = null;
    state.customName.xlsx = ""; state.customName.docx = "";
    tplChip();
    msg("已恢复内置空白模板");
  }
  function tplChip() {
    var chip = $("docs-tpl-chip");
    if (!chip) return;
    var ex = state.custom.xlsx ? "Excel·" + state.customName.xlsx : "Excel·内置";
    var wd = state.custom.docx ? "Word·" + state.customName.docx : "Word·内置";
    chip.textContent = "当前模板：" + ex + " / " + wd;
  }
  async function dlBlank(type) {
    var buf = await loadTplBuf(type === "xlsx" ? "generic_table.xlsx" : "generic_table.docx");
    download(buf, type === "xlsx" ? "空白表格模板.xlsx" : "空白表格模板.docx");
  }

  /* ---------- 标签切换 ---------- */
  var HINTS = {
    quote: "整块粘贴即可（客户信息 + 产品行混排，产品行无需符号）。点「生成正式文件」后，可打开正式 Excel 预览或下载；两者使用同一份文件，不再使用 HTML 模拟排版。",
    receipt: "整块粘贴即可（发货日期/联系人/合同编号/送货方式/收货地址 + 产品行）。点「生成正式文件」后，可打开正式 Word 预览或下载；两者使用同一份文件。", 
    pdf: "整块粘贴信息，自动识别是报价单还是签收单，一键打印导出 PDF（打印对话框里选「另存为 PDF」）。",
    table: "快速制表工具：整块粘贴信息，一键生成 Word / Excel / PDF 表格。支持上传自己的模板：先「下载空白模板」改好版式再上传（产品行需含 {名称}{数量} 占位符）。"
  };
  function setTab(kind) {
    state.kind = kind;
    clearLastFile();
    var pv = $("docs-preview"); if (pv) { pv.innerHTML = ""; pv.classList.add("hide"); }
    var act = $("docs-actions"); if (act) act.classList.add("hide");
    var tb = $("docs-tplbar"); if (tb) tb.classList.toggle("hide", kind !== "table");
    var hint = $("docs-hint"); if (hint) hint.textContent = HINTS[kind];
    var gen = $("docs-gen");
    if (gen) gen.textContent = kind === "pdf" ? "🖨 一键导出 PDF" : (kind === "table" ? "👀 预览内容" : "📄 生成正式文件");
    if (kind === "table") tplChip();
    msg("");
  }

  /* ---------- 导出按钮 ---------- */
  function setActionBtn(id, label, visible, fn) {
    var b = $(id);
    if (!b) return;
    b.textContent = label || "";
    b.classList.toggle("hide", !visible);
    b.onclick = fn || null;
  }
  function showTableActions() {
    setActionBtn("docs-dl-1", "⬇ 一键 Word", true, function () { doTable("docx"); });
    setActionBtn("docs-dl-2", "⬇ 一键 Excel", true, function () { doTable("xlsx"); });
    setActionBtn("docs-dl-3", "🖨 一键 PDF", true, function () { doTable("pdf"); });
  }
  function showMainAction() {
    var kind = state.kind;
    if (kind === "quote" || kind === "receipt") {
      setActionBtn("docs-dl-1", "↗ 用 WPS/Office 打开正式文件", true, openFormalFile);
      setActionBtn("docs-dl-2", kind === "quote" ? "⬇ 下载正式 Excel" : "⬇ 下载正式 Word", true, dlNative);
      setActionBtn("docs-dl-3", "", false, null);
    }
  }
  function openFormalFile() {
    if (!state.last || !state.last.url) return msg("请先生成正式文件", true);
    // Office 文件在不同浏览器中的直接打开能力不同；使用同一对象地址导航，
    // 若浏览器不支持内嵌预览，会直接下载，用户用 WPS/Office 打开即为正式版式。
    var win = window.open(state.last.url, "_blank", "noopener");
    if (!win) msg("浏览器阻止了新窗口，请允许弹窗；如果浏览器直接下载，请用 WPS/Office 打开该文件预览", true);
    else msg("已打开同一份正式文件；浏览器若不支持 Office 内嵌预览，会自动下载，请用 WPS/Office 打开", false);
  }
  function dlNative() {
    if (!state.last || !state.last.url) return msg("请先生成正式文件", true);
    var a = document.createElement("a");
    a.href = state.last.url;
    a.download = state.last.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ---------- 装配 ---------- */
  function init() {
    if (!document.getElementById("docs-v3-css")) {
      var st = document.createElement("style");
      st.id = "docs-v3-css";
      st.textContent = PREVIEW_CSS +
        "#docs-preview{margin-top:14px;border:1px solid var(--line);border-radius:10px;overflow:auto;background:#e8eaed;padding:18px;max-height:70vh}" +
        "#docs-preview .doc-paper{margin:0 auto;box-shadow:0 2px 10px rgba(0,0,0,.18)}" +
        "#docs-actions{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}" +
        "#docs-actions .btn{padding:8px 16px;border-radius:999px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:13px}" +
        "#docs-actions .btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}" +
        "#docs-actions .btn.primary:hover{background:var(--brand2);border-color:var(--brand2);color:#fff}" +
        "#docs-actions .btn:hover{border-color:#0f7b5f;color:#0f7b5f}" +
        ".docs-tplbar{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap;font-size:12px}" +
        ".docs-tplbar button{padding:5px 12px;border-radius:999px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:12px}" +
        ".docs-tplbar button:hover{border-color:#0f7b5f;color:#0f7b5f}" +
        ".formal-file-panel{background:#fff;border:2px solid #0f7b5f;border-radius:10px;padding:20px;max-width:760px;margin:0 auto;font-family:宋体,SimSun,serif}" +
        ".formal-file-title{font-size:20px;font-weight:700;color:#0f7b5f;margin-bottom:10px}" +
        ".formal-file-note{font-size:14px;line-height:1.8;margin-bottom:12px}" +
        ".formal-file-meta{font-size:12px;background:#f4f7f6;padding:10px;border-radius:6px;word-break:break-all}" +
        ".formal-file-meta code{font-family:Consolas,monospace}" +
        ".formal-file-rule{margin-top:10px;font-size:12px;color:#566}";
      document.head.appendChild(st);
    }
    document.querySelectorAll(".docs-tab").forEach(function (b) {
      b.addEventListener("click", function () { setTab(b.dataset.doc || "quote"); });
    });
    var input = $("docs-input");
    if (input) input.addEventListener("input", function () {
      if (!state.last) return;
      clearLastFile();
      var pv0 = $("docs-preview"); if (pv0) { pv0.innerHTML = ""; pv0.classList.add("hide"); }
      var act0 = $("docs-actions"); if (act0) act0.classList.add("hide");
      msg("内容已修改，请重新生成正式文件");
    });
    var gen = $("docs-gen");
    if (gen) gen.addEventListener("click", function () {
      if (state.kind === "pdf") doPdf();
      else if (state.kind === "table") {
        var p = parseInput();
        if (!p) return;
        msg("");
        var pv = $("docs-preview");
        if (pv) { pv.innerHTML = previewTableHtml(p); pv.classList.remove("hide"); }
        var act = $("docs-actions"); if (act) act.classList.remove("hide");
        showTableActions();
        msg("预览如下，用下方按钮一键导出");
      }
      else doPreview();
    });
    var up = $("docs-tpl-upload"); if (up) up.addEventListener("click", function () { var f = $("docs-tpl-file"); if (f) f.click(); });
    var fi = $("docs-tpl-file"); if (fi) fi.addEventListener("change", function () { if (fi.files && fi.files[0]) loadCustomTpl(fi.files[0]); fi.value = ""; });
    var rs = $("docs-tpl-reset"); if (rs) rs.addEventListener("click", resetTpl);
    var bkx = $("docs-tpl-blank-x"); if (bkx) bkx.addEventListener("click", function () { dlBlank("xlsx"); });
    var bkd = $("docs-tpl-blank-d"); if (bkd) bkd.addEventListener("click", function () { dlBlank("docx"); });
    setTab(state.kind);
  }
  if (typeof document !== "undefined" && document.getElementById("docsbox")) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  var api = {
    buildXlsxXml: X.buildXlsxXml, detectXlsx: X.detectXlsx,
    parseSharedStrings: X.parseSharedStrings,
    whiteXfs: X.whiteXfs, whiteFontIds: X.whiteFontIds,
    buildDocxXml: DX.buildDocxXml, detectDocx: DX.detectDocx,
    previewQuoteHtml: PV.previewQuoteHtml, previewReceiptHtml: PV.previewReceiptHtml,
    previewTableHtml: previewTableHtml, printPdf: printPdf, fmtMoney: X.fmtMoney
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
