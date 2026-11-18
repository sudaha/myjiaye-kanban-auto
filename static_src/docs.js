(function () {
  "use strict";
  // 商务单证 v2：整块自由粘贴 / 图片 OCR 识别 → 本地生成报价单(xlsx)、签收单(docx)
  // 纯浏览器 JSZip 模板注入，数据不出本机
  var TPL = {
    quote: "/templates/quote_template.xlsx",
    receipt: "/templates/receipt_template.docx",
    quoteMeta: "/templates/quote_meta.json"
  };
  var cache = {};
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function num(v) { var n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? null : n; }
  function repl(xml, map) { Object.keys(map).forEach(function (k) { xml = xml.split(k).join(map[k]); }); return xml; }
  function safeName(s) { return String(s || "").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 30) || "文件"; }
  function download(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  function dispW(s) { // 显示宽度：CJK=2，其他=1
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if ((c >= 0x2e80 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef)) w += 2; else w += 1;
    }
    return w;
  }
  function wrapLines(text, colWidth) { // 估算换行后的行数（列宽单位≈半角字符数）
    if (!text) return 1;
    var cap = Math.floor(colWidth * 0.92);
    var lines = 1, cur = 0;
    for (var i = 0; i < text.length; i++) {
      var w = dispW(text[i]) > 1 ? 2 : 1;
      if (cur + w > cap) { lines++; cur = w; } else cur += w;
    }
    return lines;
  }

  // ---------- 自由格式解析：整块粘贴，KV + 产品行混排 ----------
  var FIELD_ALIASES = {
    "客户名称": "customer", "客户": "customer", "公司名称": "customer", "公司": "customer", "致": "customer", "customer": "customer",
    "日期": "date", "报价日期": "date", "发货日期": "date", "date": "date",
    "联系人": "contact", "收货人": "contact", "contact": "contact",
    "电话": "phone", "手机号": "phone", "手机": "phone", "phone": "phone", "tel": "phone",
    "邮箱": "email", "email": "email", "e-mail": "email",
    "备注": "remarks", "remarks": "remarks",
    "合同编号": "contract", "关联合同编号": "contract", "合同号": "contract", "contract": "contract",
    "送货方式": "delivery", "送货费用": "freight",
    "送货公司": "courier", "物流公司": "courier", "运输公司": "courier",
    "收货地址": "addr", "地址": "addr", "收货方地址": "addr", "收货方地址及联系人": "addr", "addr": "addr"
  };
  var UNIT_CHARS = "台套件个箱片只项根张米副把块pcs";
  function isNum(s) { return /^[\d,]+(\.\d+)?$/.test(String(s).trim()); }
  function normDate(s) {
    var m = String(s).match(/(\d{4})\s*[年.\-\/]\s*(\d{1,2})\s*[月.\-\/]\s*(\d{1,2})/);
    if (!m) return "";
    return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  }
  function todayBJ() {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function parseItemParts(parts) {
    // 数量定位优先级：
    // 1) 「数字+单位字」对（报价单 6 段）  2) 末两位均数字 = 数量+单价（5 段）
    // 3) 倒数第二位数字、末位非数字 = 数量+备注（签收单 4 段）  4) 末位数字 = 数量（3 段）
    var i = -1, k, L = parts.length, remark = "";
    for (k = L - 2; k >= 1; k--) {
      if (isNum(parts[k]) && UNIT_CHARS.indexOf((parts[k + 1] || "").charAt(0)) >= 0) { i = k; break; }
    }
    if (i < 0 && L >= 3 && isNum(parts[L - 1]) && isNum(parts[L - 2])) i = L - 2;
    else if (i < 0 && L >= 3 && isNum(parts[L - 2]) && !isNum(parts[L - 1])) { i = L - 2; remark = parts[L - 1]; }
    else if (i < 0 && L >= 2 && isNum(parts[L - 1]) && !isNum(parts[L - 2])) i = L - 1;
    if (i < 0) return null;
    var qty = num(parts[i]);
    var up = parts[i + 1];
    var unit = (i + 1 < L && up && !isNum(up) && UNIT_CHARS.indexOf(up.charAt(0)) >= 0 && up.length <= 3) ? up : "";
    var price = (i + 2 < L && isNum(parts[i + 2])) ? num(parts[i + 2]) : null;
    var name = parts[0];
    var model = i > 1 ? parts[1] : "";
    var spec = parts.slice(2, i).join("/");
    if (!name || !qty) return null;
    return { name: name, model: model, spec: spec, qty: qty, unit: unit, price: price, remark: remark };
  }
  // 免符号产品行：尾部启发式识别 数量/单位/单价/备注，头部按 CJK/ASCII 切 名称/型号/规格
  function freeItem(l) {
    var isNumT = function (t) { return /^[\d,]+(\.\d+)?$/.test(t); };
    var isUnitT = function (t) { return !!t && t.length <= 3 && UNIT_CHARS.indexOf(t.charAt(0)) >= 0 && !isNumT(t); };
    var fusedRe = /^([\d,]+(?:\.\d+)?)([台套件个条根把张块对双片只箱盒瓶罐支辆])$/;
    var toks = l.split(/\s+/);
    if (toks.length < 2) return null;
    var price = null, qty = null, unit = "", remark = "", headLen = toks.length;
    if (isNumT(toks[toks.length - 1])) {
      price = num(toks[toks.length - 1]);
      var i = toks.length - 2;
      var fF = i >= 0 ? toks[i].match(fusedRe) : null; // 「10台」紧贴单价
      if (fF) { qty = num(fF[1]); unit = fF[2]; headLen = i; }
      else {
        if (i >= 0 && isUnitT(toks[i])) { unit = toks[i]; i--; }
        if (i >= 0) {
          var f = toks[i].match(fusedRe);
          if (f) { qty = num(f[1]); unit = unit || f[2]; headLen = i; }
          else if (isNumT(toks[i])) { qty = num(toks[i]); headLen = i; }
        }
      }
      if (qty == null) return null;
    } else {
      var qi = -1;
      for (var k = toks.length - 1; k >= 0; k--) {
        if (isNumT(toks[k]) || toks[k].match(fusedRe)) { qi = k; break; }
      }
      if (qi < 1) return null;
      var f2 = toks[qi].match(fusedRe);
      if (f2) { qty = num(f2[1]); unit = f2[2]; } else { qty = num(toks[qi]); }
      var tail = toks.slice(qi + 1);
      if (tail.length && isUnitT(tail[0])) { unit = unit || tail[0]; tail = tail.slice(1); }
      remark = tail.join(" ");
      headLen = qi;
    }
    var head = toks.slice(0, headLen);
    if (!head.length) return null;
    if (head.length < 2 && head[0].length < 4) return null; // 防误判普通句子
    var isAsciiTok = function (t) { return /^[A-Za-z0-9][A-Za-z0-9\-\./]*$/.test(t) && /[A-Za-z]/.test(t) && t.length >= 2 && t.length <= 16; };
    var hasCJK = function (t) { return /[\u4e00-\u9fa5]/.test(t); };
    var mIdx = -1;
    for (var m = 0; m < head.length; m++) {
      if (!isAsciiTok(head[m])) continue;
      if (m > 0 && hasCJK(head[m - 1])) continue; // 紧跟中文的 ASCII = 名称一部分
      if (m === 0 && head.length > 1 && isAsciiTok(head[1]) && !hasCJK(head[0])) continue;
      mIdx = m; break;
    }
    var name, model, spec;
    if (mIdx > 0) { name = head.slice(0, mIdx).join(" "); model = head[mIdx]; spec = head.slice(mIdx + 1).join(" "); }
    else { name = head[0]; model = ""; spec = head.slice(1).join(" "); }
    if (!name) return null;
    var parts = [name, model, spec];
    if (!spec) parts.length = 2;
    parts.push(String(qty));
    if (unit) parts.push(unit);
    if (price != null) parts.push(String(price));
    if (remark) parts.push(remark);
    return parts;
  }
  function parseFree(text) {
    var fields = {}, items = [];
    String(text).split(/\r?\n/).forEach(function (raw) {
      var l = raw.replace(/\u00a0/g, " ").trim();
      if (!l) return;
      if (/^\s*(产品名称|品名|序号|NO\.?)/.test(l) && /数量/.test(l)) return; // 表头行
      var m = l.match(/^([^\s|:：,，]{1,12})\s*[:：]\s*(.+)$/);
      if (m) {
        var key = FIELD_ALIASES[m[1]] || FIELD_ALIASES[m[1].toLowerCase()];
        if (key) {
          fields[key] = m[2].replace(/^\s*\([^)]*\)\s*[:：]\s*/, "").trim();
          return;
        }
      }
      var parts = null;
      if (l.indexOf("|") >= 0) parts = l.split("|").map(function (s) { return s.trim(); });
      else if (l.indexOf("\t") >= 0) parts = l.split("\t").map(function (s) { return s.trim(); });
      else {
        var t = l.split(/\s{2,}/).map(function (s) { return s.trim(); });
        if (t.length >= 4) parts = t;
      }
      if (parts) {
        while (parts.length && !parts[parts.length - 1]) parts.pop();
        if (parts.length >= 3) {
          var it = parseItemParts(parts);
          if (it) { items.push(it); return; }
        }
      }
      // 兜底：无任何分隔符的纯空格产品行（尾部启发式自动识别数量/单位/单价/备注）
      var freeParts = freeItem(l);
      if (freeParts) {
        var it2 = parseItemParts(freeParts);
        if (it2) { items.push(it2); return; }
      }
    });
    fields.date = (fields.date && normDate(fields.date)) || todayBJ();
    return { fields: fields, items: items };
  }
  function normalizeBlock(raw) {
    var p = parseFree(raw);
    var L = [];
    if (p.fields.customer) L.push("客户名称：" + p.fields.customer);
    L.push("日期：" + p.fields.date);
    if (p.fields.contact) L.push("联系人：" + p.fields.contact);
    if (p.fields.phone) L.push("电话：" + p.fields.phone);
    if (p.fields.email) L.push("邮箱：" + p.fields.email);
    if (p.fields.remarks) L.push("备注：" + p.fields.remarks);
    if (p.fields.contract) L.push("合同编号：" + p.fields.contract);
    if (p.fields.delivery) L.push("送货方式：" + p.fields.delivery);
    if (p.fields.courier) L.push("送货公司：" + p.fields.courier);
    if (p.fields.addr) L.push("收货地址：" + p.fields.addr);
    if (L.length) L.push("");
    L.push("产品名称|产品型号|配置及参数|数量|单位|单价(元)");
    p.items.forEach(function (it) {
      L.push([it.name, it.model, it.spec, it.qty, it.unit, it.price == null ? "" : it.price].join("|"));
    });
    return L.join("\n");
  }

  // ---------- 报价单：产品行重建（删空行/加行/行高自适应/统一样式） ----------
  function strC(ref, s, text) {
    return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t>' + esc(text) + '</t></is></c>';
  }
  function emptyC(ref, s) { return '<c r="' + ref + '" s="' + s + '"/>'; }
  function calcTotal(items) {
    var total = 0;
    items.forEach(function (it) { total += Math.round(it.qty * it.price * 100) / 100; });
    return Math.round(total * 100) / 100;
  }
  function buildQuoteSheet(sheetXml, meta, items, fields) {
    var n = items.length;
    var rowRe = /<row\b[^>]*?\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
    var rows = [], m;
    while ((m = rowRe.exec(sheetXml))) {
      var tagEnd = m[0].indexOf(">") + 1;
      rows.push({ r: +m[1], attrs: m[0].slice(0, tagEnd), body: m[2] || "", full: m[0] });
    }
    var delta = (9 + n) - 19; // 底部行（19 起）的新行号偏移（可正可负）
    var top = "", bottom = "";
    rows.forEach(function (rw) {
      if (rw.r < 9) { top += rw.full; return; }
      if (rw.r <= 18) return; // 产品区 9-18 整体由数据重建
      var nr = rw.r + delta;
      var attrs = rw.attrs.replace(/r="(\d+)"/, 'r="' + nr + '"');
      var body = (rw.body || "").replace(/\br="([A-J])(\d+)"/g,
        function (mm, col, rr) { return 'r="' + col + (+rr + delta) + '"'; });
      bottom += attrs + body + "</row>";
    });
    var prod = "";
    for (var i = 0; i < n; i++) {
      var it = items[i];
      var line = Math.max(wrapLines(it.name, meta.widths.B), wrapLines(it.model, meta.widths.C),
                          wrapLines(it.spec, meta.widths.DF));
      var ht = line <= 1 ? 21 : line * 16 + 5;
      var r = 9 + i;
      var amt = Math.round(it.qty * it.price * 100) / 100;
      prod += '<row r="' + r + '" ht="' + ht + '" customHeight="1">'
        + '<c r="A' + r + '" s="' + meta.styles.A + '"><v>' + (i + 1) + '</v></c>'
        + (it.name ? strC("B" + r, meta.styles.B, it.name) : emptyC("B" + r, meta.styles.B))
        + (it.model ? strC("C" + r, meta.styles.C, it.model) : emptyC("C" + r, meta.styles.C))
        + (it.spec ? strC("D" + r, meta.styles.D, it.spec) : emptyC("D" + r, meta.styles.D))
        + emptyC("E" + r, meta.styles.E) + emptyC("F" + r, meta.styles.F)
        + '<c r="G' + r + '" s="' + meta.styles.G + '"><v>' + it.qty + '</v></c>'
        + (it.unit ? strC("H" + r, meta.styles.H, it.unit) : emptyC("H" + r, meta.styles.H))
        + '<c r="I' + r + '" s="' + meta.styles.I + '"><v>' + it.price + '</v></c>'
        + '<c r="J' + r + '" s="' + meta.styles.J + '"><v>' + amt + '</v></c>'
        + '</row>';
    }
    var sd = top + prod + bottom;
    var xml = sheetXml;
    var start = xml.indexOf("<sheetData>") + "<sheetData>".length;
    var end = xml.indexOf("</sheetData>");
    xml = xml.slice(0, start) + sd + xml.slice(end);
    // 合并单元格：产品区保留实际行，底部随行号平移
    function shift(rr) { return rr >= 19 ? rr + delta : rr; }
    var merges = [];
    meta.merges.forEach(function (ref) {
      var mm = ref.match(/^([A-J])(\d+):([A-J])(\d+)$/);
      if (!mm) return;
      var r1 = +mm[2];
      if (r1 >= 9 && r1 <= 18) { if (r1 <= 8 + n) merges.push(mm[1] + r1 + ":" + mm[3] + +mm[4]); }
      else merges.push(mm[1] + shift(r1) + ":" + mm[3] + shift(+mm[4]));
    });
    // 超过模板 10 行产品区时，为新增行补 D:F 合并（模板只有 D9:F9..D18:F18）
    for (var r = 19; r <= 8 + n; r++) merges.push("D" + r + ":F" + r);
    xml = xml.replace(/<mergeCells count="\d+">[\s\S]*?<\/mergeCells>/,
      '<mergeCells count="' + merges.length + '">' +
      merges.map(function (x) { return '<mergeCell ref="' + x + '"/>'; }).join("") + "</mergeCells>");
    xml = xml.replace(/<dimension ref="A1:J\d+"/, '<dimension ref="A1:J' + (13 + n) + '"/>');
    var rep = {
      "{CUSTOMER}": esc(fields.customer || ""),
      "{DATE}": esc(fields.date || ""),
      "{CONTACT}": esc(fields.contact || ""),
      "{PHONE}": esc(fields.phone || ""),
      "{EMAIL}": esc(fields.email || ""),
      "{REMARKS}": fields.remarks ? esc(fields.remarks) + "\n" : "",
      "{TOTAL}": String(calcTotal(items))
    };
    return repl(xml, rep);
  }
  function genQuote(text) {
    var p = parseFree(text);
    if (!p.items.length) throw new Error("未识别到产品行。每行一条产品，例如：联想开天X5h G1d-A007|LK-X5h|海光C86-4G/16G内存/512G固态|10|台|8300（竖线/Tab/空格分隔均可）");
    p.items.forEach(function (it, i) {
      if (it.price == null) throw new Error("第 " + (i + 1) + " 件产品缺少单价：" + it.name);
    });
    return {
      items: p.items, fields: p.fields, total: calcTotal(p.items),
      name: "报价单_" + safeName(p.fields.customer) + "_" + (p.fields.date || "") + ".xlsx"
    };
  }

  // ---------- 签收单：表格行克隆（保留原型 run 的 rPr 字体） ----------
  function cellRuns(val, rpr) {
    var lines = String(val == null ? "" : val).split("\n");
    return lines.map(function (ln, i) {
      return (i ? '<w:r>' + rpr + "<w:br/></w:r>" : "")
        + '<w:r>' + rpr + '<w:t xml:space="preserve">' + esc(ln) + "</w:t></w:r>";
    }).join("");
  }
  function setCellText(tcXml, val, rpr) {
    var tcpr = (tcXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/) || [""])[0];
    return "<w:tc>" + tcpr + "<w:p>" + cellRuns(val, rpr) + "</w:p></w:tc>";
  }
  var TC_RE = /<w:tc>[\s\S]*?<\/w:tc>|<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
  function fillTable(xml, rows) {
    var tblM = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/);
    if (!tblM) return xml;
    var trs = tblM[0].match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
    if (trs.length < 2) return xml;
    var proto = trs[trs.length - 1]; // 模板空数据行作原型（已含统一字体 run）
    TC_RE.lastIndex = 0;
    var tcs = proto.match(TC_RE) || [];
    var rprs = tcs.map(function (tc) {
      var run = tc.match(/<w:r\b[\s\S]*?<\/w:r>/);
      return run ? (run[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0] : "";
    });
    var built = rows.map(function (row) {
      var filled = tcs.map(function (tc, i) { return setCellText(tc, row[i] || "", rprs[i] || ""); });
      TC_RE.lastIndex = 0;
      return proto.replace(TC_RE, function () { return filled.shift(); });
    }).join("");
    return xml.replace(tblM[0], tblM[0].replace(proto, built));
  }
  function genReceipt(text) {
    var p = parseFree(text);
    if (!p.items.length) throw new Error("未识别到发货清单行，每行一条：产品名称|规格描述|数量|备注（也兼容报价单 6 段格式）");
    var rows = p.items.map(function (it) {
      var spec = it.spec || it.model || "";
      if (it.model && it.spec) spec = it.model + " " + it.spec;
      return [it.name, spec, String(it.qty), it.remark || (it.unit ? "单位：" + it.unit : "")];
    });
    var way = p.fields.delivery || "", fee = p.fields.freight || "";
    function mark(kw) { return way.indexOf(kw) >= 0 ? "\u2611" : "\u25A1"; }
    var fRec = fee.indexOf("收货方") >= 0 ? "\u2611" : "\u25A1";
    var fSup = fee.indexOf("收货方") >= 0 ? "\u25A1" : "\u2611"; // 未指定时默认供方负担
    var map = {
      "{SHIP_DATE}": esc(p.fields.date || ""),
      "{CONTACT}": esc(p.fields.contact || ""),
      "{PHONE}": esc(p.fields.phone || ""),
      "{CONTRACT}": esc(p.fields.contract || ""),
      "{COURIER}": esc(p.fields.courier || ""),
      "{ADDR}": esc(p.fields.addr || ""),
      "{W_SELF}": mark("自提"), "{W_LOGI}": mark("物流"), "{W_SF}": mark("顺丰"), "{W_OTH}": mark("其他"),
      "{F_SUP}": fSup, "{F_REC}": fRec
    };
    return { map: map, rows: rows,
             name: "货物签收单_" + (p.fields.contract || safeName(p.fields.date || "")) + ".docx" };
  }

  // ---------- 模板加载 / 生成编排 ----------
  function loadRes(kind) {
    if (cache[kind]) return cache[kind];
    var p = fetch(TPL[kind]).then(function (r) {
      if (!r.ok) throw new Error("模板加载失败 HTTP " + r.status);
      return JSZip.loadAsync(r.arrayBuffer());
    });
    if (kind === "quote") {
      p = Promise.all([p, fetch(TPL.quoteMeta).then(function (r) { return r.json(); })])
        .then(function (a) { return { zip: a[0], meta: a[1] }; });
    } else {
      p = p.then(function (zip) { return { zip: zip, meta: null }; });
    }
    cache[kind] = p;
    return p;
  }
  function doGenerate() {
    var text = $("docs-input").value;
    var msg = $("docs-msg");
    msg.textContent = "生成中…";
    try {
      if (kind === "quote") {
        var g = genQuote(text);
        loadRes("quote").then(function (res) {
          return res.zip.file("xl/worksheets/sheet1.xml").async("string").then(function (sx) {
            res.zip.file("xl/worksheets/sheet1.xml", buildQuoteSheet(sx, res.meta, g.items, g.fields));
            return res.zip.generateAsync({ type: "blob" });
          }).then(function (blob) { download(blob, g.name); msg.textContent = "已生成：" + g.name + "（合计 " + g.total.toLocaleString("zh-CN") + " 元）"; });
        }).catch(function (e) { msg.textContent = "失败：" + e.message; });
      } else {
        var r = genReceipt(text);
        loadRes("receipt").then(function (res) {
          return res.zip.file("word/document.xml").async("string").then(function (xml) {
            res.zip.file("word/document.xml", repl(fillTable(xml, r.rows), r.map));
            return res.zip.generateAsync({ type: "blob" });
          }).then(function (blob) { download(blob, r.name); msg.textContent = "已生成：" + r.name; });
        }).catch(function (e) { msg.textContent = "失败：" + e.message; });
      }
    } catch (e) { msg.textContent = "失败：" + e.message; }
  }

  // ---------- 图片 OCR（Tesseract.js，模型自托管 /ocr/） ----------
  var ocrWorker = null, ocrBusy = false;
  function ocrSay(msg) { var el = $("docs-ocr"); if (el) el.textContent = msg; }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.onload = res;
      s.onerror = function () { rej(new Error("加载 " + src + " 失败，请检查网络")); };
      document.head.appendChild(s);
    });
  }
  function getOcrWorker() {
    if (ocrWorker) return Promise.resolve(ocrWorker);
    return loadScript("/ocr/tesseract.min.js").then(function () {
      ocrSay("加载识别模型（首次约 5MB，之后秒开）…");
      return Tesseract.createWorker("chi_sim+eng", 1, {
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr",
        langPath: "/ocr",
        logger: function (m) {
          if (m.status === "recognizing text") ocrSay("识别中 " + Math.round((m.progress || 0) * 100) + "%");
          else if (m.status && m.progress != null) ocrSay("加载模型 " + Math.round(m.progress * 100) + "%");
        }
      });
    }).then(function (w) { ocrWorker = w; return w; });
  }
  function fileToCanvas(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, 2400 / img.width);
          var cv = document.createElement("canvas");
          cv.width = Math.round(img.width * scale);
          cv.height = Math.round(img.height * scale);
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv);
        } catch (e) { reject(e); }
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("图片无法读取")); };
      img.src = url;
    });
  }
  function ocrImage(file) {
    if (ocrBusy) { ocrSay("正在识别中，请稍候…"); return; }
    ocrBusy = true;
    ocrSay("准备识别…");
    fileToCanvas(file).then(function (cv) {
      return getOcrWorker().then(function (w) { return w.recognize(cv); });
    }).then(function (res) {
      var raw = (res && res.data && res.data.text) || "";
      if (!raw.trim()) throw new Error("未识别到文字，请换一张更清晰的图片");
      $("docs-input").value = normalizeBlock(raw);
      var rawBox = $("docs-raw-text");
      if (rawBox) rawBox.textContent = raw;
      var det = $("docs-raw");
      if (det) det.classList.remove("hide");
      ocrSay("识别完成，请核对内容后点「生成并下载」");
    }).catch(function (e) { ocrSay("识别失败：" + e.message); })
      .then(function () { ocrBusy = false; });
  }

  // ---------- UI ----------
  var kind = "quote";
  var PLACEHOLDER = {
    quote: "把整块信息直接粘进来即可（客户信息 + 产品表混排都行），例如：\n客户名称：北京某某科技有限公司\n日期：2026-11-18\n联系人：张经理\n电话：13800000000\n邮箱：zhang@xx.com\n备注：（可留空）\n产品名称|产品型号|配置及参数|数量|单位|单价(元)\n联想开天X5h G1d-A007|LK-X5h|海光C86-4G/16G内存/512G固态|10|台|8300",
    receipt: "把整块信息直接粘进来即可，例如：\n发货日期：2026-11-20\n联系人：张经理\n电话：13800000000\n合同编号：HT-2026-1118\n送货方式：物流（自提/物流/顺丰/其他）\n送货公司：顺丰速运\n收货地址：北京市海淀区XX路1号 王五 13900000000\n产品名称|规格及描述|数量|备注\n联想开天X5h G1d-A007|海光C86-4G/16G内存/512G固态|10|无"
  };
  function switchKind(k) {
    kind = k;
    document.querySelectorAll(".docs-tab").forEach(function (b) { b.classList.toggle("on", b.dataset.doc === k); });
    var ta = $("docs-input");
    if (ta) { ta.placeholder = PLACEHOLDER[k]; ta.value = ""; }
    var msg = $("docs-msg"); if (msg) msg.textContent = "";
    ocrSay("");
    var det = $("docs-raw"); if (det) det.classList.add("hide");
  }
  function init() {
    document.querySelectorAll(".docs-tab").forEach(function (b) {
      b.addEventListener("click", function () { switchKind(b.dataset.doc); });
    });
    // #docs-gen 由 docs_v3.js 绑定（生成预览流程）
    var ub = $("docs-upload");
    if (ub) ub.addEventListener("click", function () { var fi = $("docs-file"); if (fi) fi.click(); });
    var fi = $("docs-file");
    if (fi) fi.addEventListener("change", function () {
      if (fi.files && fi.files[0]) ocrImage(fi.files[0]);
      fi.value = "";
    });
    var box = $("docsbox");
    if (box) box.addEventListener("paste", function (e) {
      var cd = e.clipboardData;
      if (cd && cd.items) {
        for (var i = 0; i < cd.items.length; i++) {
          if (cd.items[i].type && cd.items[i].type.indexOf("image") === 0) {
            e.preventDefault();
            var f = cd.items[i].getAsFile();
            if (f) ocrImage(f);
            return;
          }
        }
      }
    });
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  // 导出纯函数供 Node 端测试
  var api = { parseFree: parseFree, parseItemParts: parseItemParts, normDate: normDate,
             buildQuoteSheet: buildQuoteSheet, fillTable: fillTable, repl: repl,
             normalizeBlock: normalizeBlock, wrapLines: wrapLines, calcTotal: calcTotal,
             genQuote: genQuote, genReceipt: genReceipt, todayBJ: todayBJ };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (typeof window !== "undefined") { window.DocsCore = api; window.Docs = api; }
})();
