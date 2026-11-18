/* ============================================================
 * docs_v3.js (part 1) —— 通用模板引擎（xlsx 报价单）
 * 模板约定：产品行 = 同时含 {名称}{数量} token 的行；引擎将其复制 n 份，
 * 其下行整体平移；其余 token 为标量。内置模板与用户自定义模板同一引擎。
 * 依赖 window.Docs（docs.js 导出的 parseFree / wrapLines / todayBJ 等）
 * ============================================================ */
(function () {
  "use strict";
  var D = window.Docs || {};

  /* ---------- 基础 ---------- */
  function escXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function unescXml(s) {
    return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
                    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }
  function fmtMoney(n) {
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // token 名 → 字段键（中英文别名）
  var ALIAS = {
    "客户": "customer", "客户名称": "customer", "CUSTOMER": "customer", "customer": "customer",
    "日期": "date", "DATE": "date", "date": "date",
    "联系人": "contact", "CONTACT": "contact", "contact": "contact",
    "电话": "phone", "PHONE": "phone", "phone": "phone",
    "邮箱": "email", "EMAIL": "email", "email": "email",
    "备注": "remarks", "REMARKS": "remarks", "remarks": "remarks",
    "总数": "total", "TOTAL": "total", "total": "total",
    "序号": "no", "NO": "no",
    "名称": "name", "NAME": "name",
    "型号": "model", "MODEL": "model",
    "规格": "spec", "SPEC": "spec",
    "数量": "qty", "QTY": "qty",
    "单位": "unit", "UNIT": "unit",
    "单价": "price", "PRICE": "price",
    "行合计": "itemtotal", "TOTAL_ITEM": "itemtotal"
  };
  var TOKEN_RE = /\{([A-Za-z0-9_\u4e00-\u9fa5]+)\}/g;
  function tokensOf(text) {
    var out = [], m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(String(text)))) {
      var k = ALIAS[m[1]];
      if (k) out.push(k);
    }
    return out;
  }
  function tokenValue(value, map) {
    return String(value).replace(TOKEN_RE, function (all, name) {
      var k = ALIAS[name];
      if (k && map[k] !== undefined) return map[k];
      return all; // 未知 token 原样保留
    });
  }

  /* ---------- sheet 解析 ---------- */
  function parseSharedStrings(xml) {
    if (!xml) return [];
    var out = [], m, re = /<si>([\s\S]*?)<\/si>/g;
    while ((m = re.exec(xml))) {
      var t = "", mm, tr = /<t[^>]*>([\s\S]*?)<\/t>/g;
      while ((mm = tr.exec(m[1]))) t += mm[1];
      out.push(unescXml(t));
    }
    return out;
  }

  function colWidths(xml) {
    var w = {}, m, re = /<col\b[^>]*\bmin="(\d+)"[^>]*\bmax="(\d+)"[^>]*\bwidth="([\d.]+)"[^>]*\/?>/g;
    while ((m = re.exec(xml))) {
      var a = +m[1], b = +m[2], width = parseFloat(m[3]);
      for (var c = a; c <= b && c <= 26; c++) {
        var letter = String.fromCharCode(64 + c);
        w[letter] = width;
      }
    }
    return w;
  }

  // rows: r -> { attrs, cells: [{ref, s, t, v(已解码文本), raw}] }
  function parseSheet(xml, ss) {
    var rows = {}, m, re = /<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g;
    while ((m = re.exec(xml))) {
      var attrs = m[1] || "";
      var body = m[2] || "";
      var r = +((attrs.match(/\br="(\d+)"/) || [])[1]);
      if (!r) continue;
      var cells = [], cm, cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      while ((cm = cre.exec(body))) {
        var ca = cm[1] || "", cb = cm[2] || "";
        var ref = ((ca.match(/\br="([A-Z]+\d+)"/) || [])[1]) || "";
        var s = ((ca.match(/\bs="(\d+)"/) || [])[1]) || "";
        var t = ((ca.match(/\bt="([^"]+)"/) || [])[1]) || "";
        var v = "", is = cb.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
        if (is) { v = unescXml(is[1]); }
        else { var vv = cb.match(/<v>([\s\S]*?)<\/v>/); if (vv) v = unescXml(vv[1]); }
        if (t === "s" && v !== "") v = (ss && ss[+v] !== undefined) ? ss[+v] : v;
        cells.push({ ref: ref, s: s, t: t, v: v });
      }
      rows[r] = { attrs: attrs, cells: cells };
    }
    return rows;
  }

  /* ---------- 模板检测 ---------- */
  function detectXlsx(sheetXml, ss) {
    var rows = parseSheet(sheetXml, ss);
    var rList = Object.keys(rows).map(Number).sort(function (a, b) { return a - b; });
    var productRow = -1;
    for (var i = 0; i < rList.length; i++) {
      var toks = [];
      rows[rList[i]].cells.forEach(function (c) { toks = toks.concat(tokensOf(c.v)); });
      if (toks.indexOf("name") >= 0 && toks.indexOf("qty") >= 0) { productRow = rList[i]; break; }
    }
    if (productRow < 0) throw new Error("模板未找到产品行（需同时包含 {名称} 和 {数量} 占位符）");
    return { rows: rows, rList: rList, productRow: productRow, widths: colWidths(sheetXml) };
  }

  /* ---------- 单元格写出 ---------- */
  function writeCell(cell, ref, value) {
    var s = cell.s ? ' s="' + cell.s + '"' : "";
    // 原数值格（无 t 且有 v）保持数值类型
    if (cell.t !== "s" && cell.t !== "inlineStr" && cell.v !== "" && !tokensOf(cell.v).length) {
      return '<c r="' + ref + '"' + s + "><v>" + escXml(cell.v) + "</v></c>";
    }
    if (value === undefined || value === null || value === "") return '<c r="' + ref + '"' + s + '/>';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + escXml(value) + "</t></is></c>";
  }

  function renumRef(ref, newRow) {
    return ref.replace(/([A-Z]+)\d+$/, "$1" + newRow);
  }

  /* ---------- 主构建 ---------- */
  // p = { fields, items }；返回新 sheet1.xml
  function buildXlsxXml(sheetXml, ssXml, p, kind) {
    var ss = parseSharedStrings(ssXml);
    var det = detectXlsx(sheetXml, ss);
    var rows = det.rows, pr = det.productRow, widths = det.widths;
    var n = p.items.length;
    if (!n) throw new Error("没有可填入的产品行");
    var delta = n - 1;

    // 标量值
    var total = 0;
    p.items.forEach(function (it) { total += (it.qty || 0) * (it.price || 0); });
    var scalar = {
      customer: p.fields.customer || "", date: p.fields.date || D.todayBJ ? D.todayBJ() : "",
      contact: p.fields.contact || "", phone: p.fields.phone || "",
      email: p.fields.email || "", remarks: p.fields.remarks || "",
      total: fmtMoney(total)
    };

    // 产品行每行值
    var rowVals = p.items.map(function (it, i) {
      return {
        no: String(i + 1), name: it.name || "", model: it.model || "", spec: it.spec || "",
        qty: String(it.qty != null ? it.qty : ""), unit: it.unit || "",
        price: it.price != null ? fmtMoney(it.price) : "",
        itemtotal: it.price != null ? fmtMoney((it.qty || 0) * it.price) : ""
      };
    });

    function fillRow(rInfo, newRow, map) {
      var attrs = rInfo.attrs.replace(/\br="\d+"/, 'r="' + newRow + '"');
      var body = rInfo.cells.map(function (c) {
        var ref = renumRef(c.ref, newRow);
        var toks = tokensOf(c.v);
        var val;
        if (toks.length) {
          val = tokenValue(c.v, map);
          // 整格只有一个 token → 直接取值（避免残留前后缀）
          var only = c.v.match(/^\{([A-Za-z0-9_\u4e00-\u9fa5]+)\}$/);
          if (only && ALIAS[only[1]] && map[ALIAS[only[1]]] !== undefined) val = map[ALIAS[only[1]]];
        } else {
          val = c.v;
        }
        return writeCell({ s: c.s, t: c.t, v: toks.length ? "" : c.v }, ref, toks.length ? val : (c.t === "" && c.v === "" ? "" : val));
      }).join("");
      // 行高：产品行按文本换行自适应（仅 kind=quote 且有宽度信息时）
      return { attrs: attrs, body: body };
    }

    var outRows = [];
    var maxCol = "A";
    function trackCol(ref) {
      var L = ref.replace(/\d+$/, "");
      if (L > maxCol) maxCol = L;
    }

    // 1) 顶部行（r < pr）
    det.rList.forEach(function (r) {
      if (r >= pr) return;
      var fr = fillRow(rows[r], r, scalar);
      rows[r].cells.forEach(function (c) { if (c.ref) trackCol(c.ref); });
      outRows.push('<row ' + fr.attrs + ">" + fr.body + "</row>");
    });
    // 产品行原型信息（只解析一次）
    var protoCells = rows[pr].cells;
    var specCol = "", nameCol = "";
    protoCells.forEach(function (c) {
      var toks = tokensOf(c.v);
      if (toks.indexOf("spec") >= 0) specCol = c.ref.replace(/\d+$/, "");
      if (toks.indexOf("name") >= 0) nameCol = c.ref.replace(/\d+$/, "");
    });
    var specCap = widths[specCol] ? Math.floor(widths[specCol] * 0.92) : 40;
    var nameCap = widths[nameCol] ? Math.floor(widths[nameCol] * 0.92) : 12;
    var protoAttrs = rows[pr].attrs.replace(/\br="\d+"/, "").replace(/\sht="[\d.]+"( customHeight="1")?/, "");

    // 2) 产品行 × n
    for (var i = 0; i < n; i++) {
      var nr = pr + i;
      protoCells.forEach(function (c) { trackCol(renumRef(c.ref, nr)); });
      var body = protoCells.map(function (c) {
        var ref = renumRef(c.ref, nr);
        var toks = tokensOf(c.v);
        var val = c.v;
        if (toks.length) {
          val = tokenValue(c.v, rowVals[i]);
          var only = c.v.match(/^\{([A-Za-z0-9_\u4e00-\u9fa5]+)\}$/);
          if (only && ALIAS[only[1]] && rowVals[i][ALIAS[only[1]]] !== undefined) val = rowVals[i][ALIAS[only[1]]];
          if (val === undefined || val === null) val = "";
        }
        return writeCell({ s: c.s, t: c.t, v: toks.length ? "" : c.v }, ref, val);
      }).join("");
      // 行高自适应（报价单：按规格/名称换行数撑开）
      var htPart = "";
      if (kind === "quote") {
        var lines = 1;
        if (D.wrapLines) {
          if (specCol) lines = Math.max(lines, D.wrapLines(rowVals[i].spec, specCap));
          if (nameCol) lines = Math.max(lines, D.wrapLines(rowVals[i].name, nameCap));
        }
        htPart = ' ht="' + (lines > 1 ? lines * 16 + 5 : 21) + '" customHeight="1"';
      }
      outRows.push('<row r="' + nr + '"' + protoAttrs + htPart + ">" + body + "</row>");
    }
    // 3) 底部行（r > pr，平移 delta）
    det.rList.forEach(function (r) {
      if (r <= pr) return;
      var nr = r + delta;
      var fr = fillRow(rows[r], nr, scalar);
      rows[r].cells.forEach(function (c) { if (c.ref) trackCol(renumRef(c.ref, nr)); });
      outRows.push('<row ' + fr.attrs + ">" + fr.body + "</row>");
    });

    var xml = sheetXml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, "<sheetData>" + outRows.join("") + "</sheetData>");

    // 合并单元格：顶部保留；产品行按 n 复制；底部平移
    var merges = [], m, mre = /<mergeCell ref="([A-Z]+\d+:[A-Z]+\d+)"/g;
    var last = det.rList[det.rList.length - 1] + delta;
    while ((m = mre.exec(sheetXml))) {
      var parts = m[1].split(":");
      var r1 = +parts[0].replace(/[A-Z]/g, ""), r2 = +parts[1].replace(/[A-Z]/g, "");
      if (r1 === pr && r2 === pr) {
        for (var k = 0; k < n; k++) merges.push(renumRef(parts[0], pr + k) + ":" + renumRef(parts[1], pr + k));
      } else if (r1 > pr) {
        merges.push(renumRef(parts[0], r1 + delta) + ":" + renumRef(parts[1], r2 + delta));
      } else {
        merges.push(m[1]);
      }
    }
    xml = xml.replace(/<mergeCells count="\d+">[\s\S]*?<\/mergeCells>/,
      '<mergeCells count="' + merges.length + '">' + merges.map(function (r) { return '<mergeCell ref="' + r + '"/>'; }).join("") + "</mergeCells>");

    // dimension
    xml = xml.replace(/<dimension ref="[^"]*"/, '<dimension ref="A1:' + maxCol + last + '"');
    return xml;
  }

  (window.DocsV3 = window.DocsV3 || {}).xlsx = {
    buildXlsxXml: buildXlsxXml, detectXlsx: detectXlsx, parseSharedStrings: parseSharedStrings,
    parseSheet: parseSheet, fmtMoney: fmtMoney, escXml: escXml, unescXml: unescXml,
    ALIAS: ALIAS, tokensOf: tokensOf, tokenValue: tokenValue
  };
})();

/* docs_v3.js (part 2) —— docx 签收单通用引擎 + HTML 预览构建 */
(function () {
  "use strict";
  var D = window.Docs || {};
  var X = window.DocsV3.xlsx;
  function escXml(s) { return X.escXml(s); }

  // 签收单字段键 → token 名（模板里用中文 token；英文别名兼容）
  var R_ALIAS = {
    "发货日期": "date", "SHIP_DATE": "date",
    "联系人": "contact", "CONTACT": "contact",
    "电话": "phone", "PHONE": "phone",
    "合同": "contract", "合同编号": "contract", "CONTRACT": "contract",
    "自提": "way_self", "物流": "way_logi", "顺丰": "way_sf", "其他": "way_oth",
    "供方": "fee_sup", "收货": "fee_rec",
    "快递": "courier", "送货公司": "courier", "COURIER": "courier",
    "地址": "addr", "ADDR": "addr"
  };
  var R_TOKEN_RE = /\{([A-Za-z0-9_\u4e00-\u9fa5]+)\}/g;

  function receiptMap(p) {
    var way = p.fields.delivery || "", fee = p.fields.freight || "";
    function mark(kw) { return way.indexOf(kw) >= 0 ? "\u2611" : "\u25A1"; }
    var fRec = fee.indexOf("收货方") >= 0;
    return {
      date: p.fields.date || (D.todayBJ ? D.todayBJ() : ""),
      contact: p.fields.contact || "", phone: p.fields.phone || "",
      contract: p.fields.contract || "",
      way_self: mark("自提"), way_logi: mark("物流"), way_sf: mark("顺丰"), way_oth: mark("其他"),
      fee_sup: fRec ? "\u25A1" : "\u2611", fee_rec: fRec ? "\u2611" : "\u25A1",
      courier: p.fields.courier || "", addr: p.fields.addr || ""
    };
  }

  function detectDocx(docXml) {
    var tbl = docXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/);
    if (!tbl) throw new Error("模板未找到表格");
    var trs = tbl[0].match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
    var protoIdx = -1;
    trs.forEach(function (t, i) {
      if (t.indexOf("{名称}") >= 0 || t.indexOf("{NAME}") >= 0) protoIdx = i;
    });
    if (protoIdx < 0) throw new Error("模板未找到产品行（表格内需有一行同时包含 {名称} 占位符）");
    return { tblStart: docXml.indexOf(tbl[0]), tblEnd: docXml.indexOf(tbl[0]) + tbl[0].length,
             tbl: tbl[0], trs: trs, protoIdx: protoIdx };
  }

  function docxCell(tc, rpr, text) {
    var tcpr = (tc.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/) || [""])[0];
    var parts = String(text == null ? "" : text).split("\n");
    var runs = parts.map(function (seg, i) {
      return "<w:r>" + rpr + '<w:t xml:space="preserve">' + escXml(seg) + "</w:t>" + (i < parts.length - 1 ? "<w:br/>" : "");
    }).join("");
    return "<w:tc>" + tcpr + "<w:p>" + runs + "</w:p></w:tc>";
  }

  // p = { fields, items }；返回新 document.xml
  function buildDocxXml(docXml, p) {
    var det = detectDocx(docXml);
    var proto = det.trs[det.protoIdx];
    var tcs = proto.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    if (tcs.length < 3) throw new Error("模板产品行列数不足（应至少 名称/规格/数量）");
    // 各格 rPr（取该格第一个 run 的 rPr）
    var rprs = tcs.map(function (tc) {
      var run = tc.match(/<w:r\b[\s\S]*?<\/w:r>/);
      if (!run) return "";
      var r = run[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
      return r ? r[0] : "";
    });
    var map = receiptMap(p);
    // 生成 n 行
    var rows = p.items.map(function (it, i) {
      var spec = it.spec || it.model || "";
      if (it.model && it.spec) spec = it.model + " " + it.spec;
      var vals = [it.name || "", spec, String(it.qty != null ? it.qty : ""),
                  it.remark || (it.unit ? "单位：" + it.unit : "")];
      var newTcs = tcs.map(function (tc, k) { return docxCell(tc, rprs[k] || rprs[0], vals[k] || ""); });
      var trPr = (proto.match(/<w:trPr>[\s\S]*?<\/w:trPr>/) || [""])[0];
      return "<w:tr>" + trPr + newTcs.join("") + "</w:tr>";
    }).join("");
    // 替换原型行
    var tblNew = det.tbl.replace(proto, rows);
    var xml = docXml.slice(0, det.tblStart) + tblNew + docXml.slice(det.tblEnd);
    // 表头 token 全局替换
    R_TOKEN_RE.lastIndex = 0;
    xml = xml.replace(R_TOKEN_RE, function (all, name) {
      var k = R_ALIAS[name];
      if (k && map[k] !== undefined) return map[k];
      return all;
    });
    // 残留 token 检查
    var left = [], m, cre = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    while ((m = cre.exec(xml))) {
      var tm = m[1].match(/\{([A-Za-z0-9_\u4e00-\u9fa5]+)\}/);
      if (tm && left.indexOf(tm[0]) < 0) left.push(tm[0]);
    }
    return { xml: xml, leftTokens: left };
  }

  /* ================= HTML 预览 ================= */
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                                    .replace(/\n/g, "<br>");
  }

  function previewQuoteHtml(p, total, logoUrl) {
    var map = { customer: p.fields.customer || "", date: p.fields.date || "",
                contact: p.fields.contact || "", phone: p.fields.phone || "", email: p.fields.email || "" };
    var trs = p.items.map(function (it, i) {
      var spec = it.spec || it.model || "";
      return "<tr>" +
        '<td class="c">' + (i + 1) + "</td>" +
        "<td>" + escHtml(it.name) + "</td>" +
        "<td>" + escHtml(it.model) + "</td>" +
        '<td class="spec">' + escHtml(spec) + "</td>" +
        '<td class="c">' + escHtml(it.qty) + "</td>" +
        '<td class="c">' + escHtml(it.unit) + "</td>" +
        '<td class="r">' + (it.price != null ? X.fmtMoney(it.price) : "") + "</td>" +
        '<td class="r">' + (it.price != null ? X.fmtMoney((it.qty || 0) * it.price) : "") + "</td>" +
        "</tr>";
    }).join("");
    return '<div class="doc-paper dq-paper">' +
      '<div class="dq-top">' +
      (logoUrl ? '<img class="dq-logo" src="' + logoUrl + '" alt="">' : '<div class="dq-logo dq-logo-ph">JIAYE TECH</div>') +
      '<div class="dq-co"><div class="dq-t1">报 价 单</div><div class="dq-t2">Quotation</div>' +
      '<div class="dq-c1">北 京 佳 业 同 创 科 技 有 限 公 司</div>' +
      '<div class="dq-c2">Beijing Jiayetongchuang Technology Co., Ltd.</div>' +
      '<div class="dq-c3">地址：北京市海淀区体院西路甲2号 14号楼1层 101</div>' +
      "</div>" +
      '<div class="dq-to"><div>致：  ' + escHtml(map.customer) + "</div><div>To:</div>" +
      '<div class="dq-date">日期 (Date):  ' + escHtml(map.date) + "</div></div>" +
      "</div>" +
      '<table class="dq-table">' +
      "<thead><tr><th class='w-no'>序号</th><th class='w-name'>产品名称</th><th class='w-model'>产品型号</th>" +
      '<th class="w-spec">配置及参数<br>Description</th><th class="w-qty">数量</th><th class="w-unit">单位</th>' +
      "<th class='w-price'>单价(元)</th><th class='w-total'>合计(元)</th></tr>" +
      "<tr><th>NO.</th><th>Commodity</th><th>SKU</th><th></th><th>Quantity</th><th>Unit</th><th>Price</th><th>Total</th></tr></thead>" +
      "<tbody>" + trs +
      '<tr class="dq-total"><td colspan="5"></td><td colspan="3" class="c tb">合计金额Total Amount</td>' +
      '<td class="r tb">' + X.fmtMoney(total) + "</td></tr>" +
      '<tr class="dq-remark"><td class="c tb" rowspan="1">备注Remarks</td>' +
      '<td class="tb" colspan="7">' + escHtml(p.fields.remarks ? p.fields.remarks + "\n" : "") +
      "1,报价有效期：30天；<br>2,报价含13%增值税；<br>3,报价已含国内快递运费；</td></tr>" +
      "</tbody></table>" +
      '<div class="dq-contact">联系人：  ' + escHtml(map.contact) + "　　电话 tel:  " + escHtml(map.phone) +
      "　　E-mail:  " + escHtml(map.email) + "</div>" +
      "</div>";
  }

  function previewReceiptHtml(p) {
    var map = receiptMap(p);
    var trs = p.items.map(function (it) {
      var spec = it.spec || it.model || "";
      if (it.model && it.spec) spec = it.model + " " + it.spec;
      return "<tr>" +
        "<td>" + escHtml(it.name) + "</td>" +
        '<td class="spec">' + escHtml(spec) + "</td>" +
        '<td class="c">' + escHtml(it.qty) + "</td>" +
        "<td>" + escHtml(it.remark || (it.unit ? "单位：" + it.unit : "")) + "</td></tr>";
    }).join("");
    return '<div class="doc-paper dr-paper">' +
      '<div class="dr-title">货物签收单</div>' +
      '<div class="dr-meta">发货日期：  ' + escHtml(map.date) + "　　联系人：  " + escHtml(map.contact) +
      "　　电话：  " + escHtml(map.phone) + "　　关联合同编号：  " + escHtml(map.contract) + "</div>" +
      '<div class="dr-sub">发货清单：</div>' +
      '<table class="dr-table"><thead><tr><th class="w1">产品名称</th><th class="w2">规格及描述</th>' +
      '<th class="w3">数量</th><th class="w4">备注</th></tr></thead><tbody>' + trs + "</tbody></table>" +
      '<div class="dr-line">送货方式：' + map.way_self + "自提　" + map.way_logi + "物流　" + map.way_sf + "顺丰　" + map.way_oth + "其他" +
      "　　送货费用：" + map.fee_sup + "由供方负担　　" + map.fee_rec + "收货方自理</div>" +
      '<div class="dr-line">送货公司：  ' + escHtml(map.courier) + "</div>" +
      '<div class="dr-line dr-addr">收货方地址及联系人：  ' + escHtml(map.addr) + "</div>" +
      '<div class="dr-sign">—————— 签 收 栏 ——————<span class="dr-signline">签收人(盖章或签字)：　　　　　　　　身份证号(代签需填写)：　　　　　　　　</span></div>' +
      "</div>";
  }

  (window.DocsV3 = window.DocsV3 || {}).docx = {
    buildDocxXml: buildDocxXml, detectDocx: detectDocx, receiptMap: receiptMap
  };
  (window.DocsV3 = window.DocsV3 || {}).preview = {
    previewQuoteHtml: previewQuoteHtml, previewReceiptHtml: previewReceiptHtml
  };
})();

/* docs_v3.js (part 3) —— 预览CSS / PDF打印 / 自定义模板上传 / UI 装配 */
(function () {
  "use strict";
  var D = window.Docs || {};
  var X = window.DocsV3.xlsx, DX = window.DocsV3.docx, PV = window.DocsV3.preview;
  function $(id) { return document.getElementById(id); }

  /* ---------- 预览样式（屏幕 + 打印共用） ---------- */
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
    ".dr-sign{margin-top:26px;font-weight:700;font-size:13px;letter-spacing:4px}" +
    ".dr-signline{display:block;font-weight:400;letter-spacing:0;margin-top:26px;font-size:12px}";

  var PRINT_CSS = "@page{margin:10mm}html,body{margin:0;padding:0}" +
    ".dr-paper{max-width:none;width:auto}" + PREVIEW_CSS;

  /* ---------- PDF 导出（隐藏 iframe 打印，目标选「另存为 PDF」） ---------- */
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

  /* ---------- 状态 ---------- */
  var state = {
    kind: "quote",
    custom: { quote: null, receipt: null },   // ArrayBuffer
    customName: { quote: "", receipt: "" },
    last: null,                                // { buf, name, html, landscape }
    tplCache: {}, logoUrl: ""
  };

  function msg(t, err) {
    var el = $("docs-msg");
    if (el) { el.textContent = t || ""; el.style.color = err ? "#c0392b" : ""; }
  }

  function loadTplBuf(kind) {
    if (state.custom[kind]) return Promise.resolve(state.custom[kind]);
    var url = "/templates/" + (kind === "quote" ? "quote_template.xlsx" : "receipt_template.docx");
    if (!state.tplCache[url]) {
      state.tplCache[url] = fetch(url).then(function (r) {
        if (!r.ok) throw new Error("模板加载失败：" + url);
        return r.arrayBuffer();
      });
    }
    return state.tplCache[url];
  }

  function logoDataUrl() {
    if (state.logoUrl) return Promise.resolve(state.logoUrl);
    return loadTplBuf("quote").then(function (buf) {
      return JSZip.loadAsync(buf).then(function (zip) {
        var f = zip.file("xl/media/image1.png");
        if (!f) { state.logoUrl = ""; return ""; }
        return f.async("base64").then(function (b64) {
          state.logoUrl = "data:image/png;base64," + b64;
          return state.logoUrl;
        });
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

  /* ---------- 生成预览 ---------- */
  async function doPreview() {
    msg("");
    var pv = $("docs-preview");
    if (pv) pv.innerHTML = "";
    var text = ($("docs-input") || { value: "" }).value.trim();
    if (!text) return msg("请先粘贴信息（或点「图片识别」）", true);
    var p = D.parseFree(text);
    if (!p.items.length) return msg("未识别到产品行。报价单每行：名称|型号|规格|数量|单位|单价；签收单：名称|规格|数量|备注", true);
    try {
      var buf, html, name, landscape = true;
      if (state.kind === "quote") {
        var zip = await JSZip.loadAsync(await loadTplBuf("quote"));
        var sx = await zip.file("xl/worksheets/sheet1.xml").async("string");
        var ssFile = zip.file("xl/sharedStrings.xml");
        var ss = ssFile ? await ssFile.async("string") : null;
        zip.file("xl/worksheets/sheet1.xml", X.buildXlsxXml(sx, ss, p, "quote"));
        buf = await zip.generateAsync({ type: "arraybuffer" });
        var total = 0;
        p.items.forEach(function (it) { total += (it.qty || 0) * (it.price || 0); });
        var logo = await logoDataUrl();
        html = PV.previewQuoteHtml(p, total, logo);
        name = "报价单_" + (p.fields.customer || "客户") + "_" + (p.fields.date || "") + ".xlsx";
      } else {
        var zip2 = await JSZip.loadAsync(await loadTplBuf("receipt"));
        var dx = await zip2.file("word/document.xml").async("string");
        var res = DX.buildDocxXml(dx, p);
        if (res.leftTokens.length) msg("提示：模板中残留未识别占位符 " + res.leftTokens.join(" "), false);
        zip2.file("word/document.xml", res.xml);
        buf = await zip2.generateAsync({ type: "arraybuffer" });
        html = PV.previewReceiptHtml(p);
        name = "签收单_" + (p.fields.contract || p.fields.customer || "客户") + ".docx";
        landscape = false;
      }
      state.last = { buf: buf, name: name, html: html, landscape: landscape };
      var pvEl = $("docs-preview");
      if (pvEl) { pvEl.innerHTML = html; pvEl.classList.remove("hide"); }
      $("docs-actions").classList.remove("hide");
      msg("预览已生成，可下载 Excel/Word 或一键导出 PDF");
    } catch (e) {
      msg("生成失败：" + e.message, true);
    }
  }

  /* ---------- 导出按钮 ---------- */
  function dlNative() {
    if (!state.last) return msg("请先生成预览", true);
    download(state.last.buf, state.last.name);
  }
  function dlPdf() {
    if (!state.last) return msg("请先生成预览", true);
    printPdf(state.last.html, state.last.landscape, state.last.name);
    msg("已打开打印对话框：目标打印机选「另存为 PDF」即可");
  }

  /* ---------- 自定义模板 ---------- */
  async function loadCustomTpl(file) {
    var kind = state.kind;
    try {
      var buf = await file.arrayBuffer();
      var zip = await JSZip.loadAsync(buf);
      if (kind === "quote") {
        var sx = await zip.file("xl/worksheets/sheet1.xml").async("string");
        var ssFile = zip.file("xl/sharedStrings.xml");
        var ss = ssFile ? await ssFile.async("string") : null;
        X.detectXlsx(sx, X.parseSharedStrings(ss));
      } else {
        var dx = await zip.file("word/document.xml").async("string");
        DX.detectDocx(dx);
      }
      state.custom[kind] = buf;
      state.customName[kind] = file.name;
      var chip = $("docs-tpl-chip");
      if (chip) chip.textContent = "当前模板：自定义 · " + file.name;
      msg("自定义模板已启用（" + (kind === "quote" ? "报价单" : "签收单") + "）");
    } catch (e) {
      msg("模板无效：" + e.message, true);
    }
  }
  function resetTpl() {
    var kind = state.kind;
    state.custom[kind] = null; state.customName[kind] = "";
    var chip = $("docs-tpl-chip");
    if (chip) chip.textContent = "当前模板：内置" + (kind === "quote" ? "报价单" : "签收单") + "（可编辑后重新上传）";
    msg("已恢复内置模板");
  }
  async function dlBlank() {
    var buf = await loadTplBuf(state.kind);
    download(buf, state.kind === "quote" ? "空白报价单模板.xlsx" : "空白签收单模板.docx");
  }

  /* ---------- 装配 ---------- */
  function init() {
    // 预览样式注入
    if (!document.getElementById("docs-v3-css")) {
      var st = document.createElement("style");
      st.id = "docs-v3-css";
      st.textContent = PREVIEW_CSS +
        "#docs-preview{margin-top:14px;border:1px solid var(--line);border-radius:10px;overflow:auto;background:#e8eaed;padding:18px;max-height:70vh}" +
        "#docs-preview .doc-paper{margin:0 auto;box-shadow:0 2px 10px rgba(0,0,0,.18)}" +
        "#docs-actions{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}" +
        "#docs-actions .btn{padding:8px 16px;border-radius:999px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:13px}" +
        "#docs-actions .btn:hover{border-color:#0f7b5f;color:#0f7b5f}" +
        ".docs-tplbar{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap;font-size:12px}" +
        ".docs-tplbar button{padding:5px 12px;border-radius:999px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:12px}" +
        ".docs-tplbar button:hover{border-color:#0f7b5f;color:#0f7b5f}";
      document.head.appendChild(st);
    }
    // 标签切换（沿用 v2 的 .docs-tab 绑定，这里同步 state.kind）
    document.querySelectorAll(".docs-tab").forEach(function (b) {
      b.addEventListener("click", function () {
        state.kind = b.dataset.doc || "quote";
        state.last = null;
        var pv = $("docs-preview"); if (pv) { pv.innerHTML = ""; pv.classList.add("hide"); }
        var act = $("docs-actions"); if (act) act.classList.add("hide");
        msg("");
        var chip = $("docs-tpl-chip");
        if (chip) chip.textContent = "当前模板：" + (state.custom[state.kind] ? "自定义 · " + state.customName[state.kind] : "内置" + (state.kind === "quote" ? "报价单" : "签收单") + "（可编辑后重新上传）");
        var fi = $("docs-tpl-file");
        if (fi) fi.accept = state.kind === "quote" ? ".xlsx" : ".docx";
      });
    });
    var gen = $("docs-gen");
    if (gen) { gen.textContent = "👀 生成预览"; gen.addEventListener("click", doPreview); }
    var b1 = $("docs-dl-native"); if (b1) b1.addEventListener("click", dlNative);
    var b2 = $("docs-dl-pdf"); if (b2) b2.addEventListener("click", dlPdf);
    var up = $("docs-tpl-upload"); if (up) up.addEventListener("click", function () { var f = $("docs-tpl-file"); if (f) f.click(); });
    var fi = $("docs-tpl-file"); if (fi) fi.addEventListener("change", function () { if (fi.files && fi.files[0]) loadCustomTpl(fi.files[0]); fi.value = ""; });
    var rs = $("docs-tpl-reset"); if (rs) rs.addEventListener("click", resetTpl);
    var bk = $("docs-tpl-blank"); if (bk) bk.addEventListener("click", dlBlank);
  }
  if (typeof document !== "undefined" && document.getElementById("docsbox")) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  /* ---------- Node 测试导出 ---------- */
  var api = {
    buildXlsxXml: X.buildXlsxXml, detectXlsx: X.detectXlsx,
    parseSharedStrings: X.parseSharedStrings, parseSheet: X.parseSheet,
    buildDocxXml: DX.buildDocxXml, detectDocx: DX.detectDocx,
    previewQuoteHtml: PV.previewQuoteHtml, previewReceiptHtml: PV.previewReceiptHtml,
    printPdf: printPdf, fmtMoney: X.fmtMoney
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

