/* docs_v3.js (part 2, v4) —— docx 签收单通用引擎（零修改）+ HTML 预览 */
(function () {
  "use strict";
  var D = window.Docs || {};
  var X = window.DocsV3.xlsx;
  function escXml(s) { return X.escXml(s); }

  var R_ALIAS = {
    "发货日期": "date", "SHIP_DATE": "date",
    "联系人": "contact", "CONTACT": "contact",
    "电话": "phone", "PHONE": "phone",
    "合同": "contract", "合同编号": "contract", "CONTRACT": "contract",
    "自提": "way_self", "物流": "way_logi", "顺丰": "way_sf", "其他": "way_oth",
    "供方": "fee_sup", "收货": "fee_rec",
    "快递": "courier", "送货公司": "courier", "COURIER": "courier",
    "地址": "addr", "ADDR": "addr",
    "名称": "name", "NAME": "name", "规格": "spec", "SPEC": "spec",
    "数量": "qty", "QTY": "qty", "备注": "remark", "UNIT": "unit", "单位": "unit"
  };
  var R_TOKEN_RE = /\{([A-Za-z0-9_\u4e00-\u9fa5]+)\}/g;
  var ITEM_KEYS = ["name", "spec", "qty", "remark", "unit"];

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
    if (protoIdx < 0) throw new Error("模板未找到产品行（表格内需有一行包含 {名称} 占位符）");
    return { tblStart: docXml.indexOf(tbl[0]), tblEnd: docXml.indexOf(tbl[0]) + tbl[0].length,
             tbl: tbl[0], trs: trs, protoIdx: protoIdx };
  }

  function cellTexts(tc) {
    var out = "", m, re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    while ((m = re.exec(tc))) out += m[1];
    return out;
  }
  function fixWhite(rpr) {
    if (!rpr) return rpr;
    return rpr.replace(/<w:color\s+w:val="FFFFFF"\s*\/>/i, '<w:color w:val="000000"/>')
              .replace(/<w:color\s+w:val="FFFFFF"(?!\s*\/)/i, '<w:color w:val="000000"');
  }
  // 单元格填值：字面量原位替换优先（零结构修改）；多行值才重建 run（保留 tcPr/pPr/rPr）
  function docxFillCell(tc, rpr, tokenMap) {
    var names = Object.keys(tokenMap);
    var needBr = false;
    names.forEach(function (nm) { if (String(tokenMap[nm] || "").indexOf("\n") >= 0) needBr = true; });
    if (!needBr) {
      var out = tc;
      names.forEach(function (nm) {
        var lit = "{" + nm + "}";
        if (out.indexOf(lit) >= 0) out = out.split(lit).join(escXml(String(tokenMap[nm] == null ? "" : tokenMap[nm])));
      });
      return out;
    }
    // 重建：保留 tcPr + 第一段 pPr + 首个 run rPr
    var tcpr = (tc.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/) || [""])[0];
    var firstP = tc.match(/<w:p\b[\s\S]*?<\/w:p>/);
    var ppr = firstP ? ((firstP[0].match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0]) : "";
    var full = X.unescXml(cellTexts(tc));
    names.forEach(function (nm) { full = full.split("{" + nm + "}").join(String(tokenMap[nm] == null ? "" : tokenMap[nm])); });
    var rprSafe = fixWhite(rpr);
    var runs = full.split("\n").map(function (seg, i) {
      return "<w:r>" + rprSafe + '<w:t xml:space="preserve">' + escXml(seg) + "</w:t>" + (i < full.split("\n").length - 1 ? "<w:br/>" : "");
    }).join("");
    return "<w:tc>" + tcpr + "<w:p>" + ppr + runs + "</w:p></w:tc>";
  }

  function buildDocxXml(docXml, p) {
    var det = detectDocx(docXml);
    var proto = det.trs[det.protoIdx];
    var tcs = proto.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    if (tcs.length < 3) throw new Error("模板产品行列数不足（应至少 名称/规格/数量）");
    // 每格 rPr（首个 run）+ 该格 token 名
    var cellInfo = tcs.map(function (tc) {
      var run = tc.match(/<w:r\b[\s\S]*?<\/w:r>/);
      var rpr = run ? ((run[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0]) : "";
      var txt = cellTexts(tc);
      var toks = [], m, re = /\{([A-Za-z0-9_\u4e00-\u9fa5]+)\}/g;
      while ((m = re.exec(txt))) {
        var k = R_ALIAS[m[1]];
        if (k && ITEM_KEYS.indexOf(k) >= 0) toks.push({ raw: m[1], key: k });
      }
      return { rpr: fixWhite(rpr), toks: toks };
    });
    var headerMap = receiptMap(p);
    var rows = p.items.map(function (it) {
      var spec = it.spec || it.model || "";
      if (it.model && it.spec) spec = it.model + " " + it.spec;
      var itemVals = {
        name: it.name || "", spec: spec, qty: String(it.qty != null ? it.qty : ""),
        remark: it.remark || (it.unit ? "单位：" + it.unit : ""), unit: it.unit || ""
      };
      var newTcs = tcs.map(function (tc, k) {
        if (!cellInfo[k].toks.length) return tc;
        var map = {};
        cellInfo[k].toks.forEach(function (t) { map[t.raw] = itemVals[t.key]; });
        return docxFillCell(tc, cellInfo[k].rpr, map);
      });
      var pos = 0;
      // 保留原始 <w:tr ...> 外层属性及 trPr，只替换四个单元格 XML
      return proto.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, function () { return newTcs[pos++]; });
    }).join("");
    var tblNew = det.tbl.replace(proto, rows);
    var xml = docXml.slice(0, det.tblStart) + tblNew + docXml.slice(det.tblEnd);
    // 表头 token 全局原位替换
    xml = xml.replace(R_TOKEN_RE, function (all, name) {
      var k = R_ALIAS[name];
      if (k && ITEM_KEYS.indexOf(k) < 0 && headerMap[k] !== undefined) return String(headerMap[k]);
      return all;
    });
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
    var previewItems = p.items.slice();
    while (previewItems.length < 3) previewItems.push(null); // 原始报价单母版固定保留3个产品格
    var trs = previewItems.map(function (it, i) {
      if (!it) return '<tr class="dq-empty"><td class="c"></td><td></td><td></td><td class="spec"></td><td class="c"></td><td class="c"></td><td class="r"></td><td class="r"></td></tr>';
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
      '<tr class="dq-remark"><td class="c tb">备注Remarks</td>' +
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
      '<div class="dr-sign"><span class="dr-sign-bar">签　收　栏</span>' +
      '<span class="dr-signline">签收人(盖章或签字)：　　　　　　　　　　身份证号(代签需填写)：　　　　　　　　　　</span></div>' +
      '<div class="dr-declare">请阅读并理解下述声明，您在最后的签字表明您确认收到的物品与此单所填内容一致。<br>' +
      '*本货物签收单所填写的信息均与送达您手上的实际物品的信息相符合<br>' +
      '*如您对本次的送货或货物有任何意见和建议，请联系我们<br>' +
      '*请您在确认本货物签收单内容均为正确且属实后，签字或盖章确认。</div>' +
      "</div>";
  }

  (window.DocsV3 = window.DocsV3 || {}).docx = {
    buildDocxXml: buildDocxXml, detectDocx: detectDocx, receiptMap: receiptMap
  };
  (window.DocsV3 = window.DocsV3 || {}).preview = {
    previewQuoteHtml: previewQuoteHtml, previewReceiptHtml: previewReceiptHtml
  };
})();
