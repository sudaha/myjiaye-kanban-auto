(function () {
  "use strict";
  // 商务单证：粘贴信息 → JSZip 在模板内替换占位符 → 一键下载（纯浏览器，数据不出本机）
  var TPL = { quote: "/templates/quote_template.xlsx", receipt: "/templates/receipt_template.docx" };
  var cache = {};
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function num(v) { var n = parseFloat(String(v).replace(/[^\d.\-]/g, "")); return isNaN(n) ? null : n; }
  function fmt(n) { return n == null ? "" : String(n); }
  function parseKV(text) {
    var kv = {};
    text.split(/\r?\n/).forEach(function (line) {
      var m = line.match(/^\s*([^\s:：|]{1,12})\s*[:：]\s*(.+?)\s*$/);
      if (m) kv[m[1]] = m[2];
    });
    return kv;
  }
  function parseItems(text) {
    var items = [];
    text.split(/\r?\n/).forEach(function (line) {
      var parts = line.split("|").map(function (s) { return s.trim(); });
      if (parts.length < 4) return;
      if (parts[0].indexOf("产品名称") >= 0) return; // 表头行
      items.push(parts);
    });
    return items;
  }

  function loadTpl(kind) {
    if (cache[kind]) return cache[kind];
    cache[kind] = fetch(TPL[kind]).then(function (r) {
      if (!r.ok) throw new Error("模板加载失败 HTTP " + r.status);
      return JSZip.loadAsync(r.arrayBuffer());
    });
    return cache[kind];
  }
  function repl(xml, map) {
    Object.keys(map).forEach(function (k) {
      xml = xml.split(k).join(map[k]);
    });
    return xml;
  }
  function download(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  function safeName(s) { return String(s || "").replace(/[\\/:*?"<>|]/g, "").slice(0, 30) || "文件"; }

  function genQuote(text) {
    var kv = parseKV(text);
    var items = parseItems(text);
    if (!items.length) throw new Error("未解析到产品行（每行：名称|型号|配置参数|数量|单位|单价，或 名称|型号|数量|单位|单价）");
    var total = 0, map = {
      "{CUSTOMER}": esc(kv["客户名称"] || kv["客户"] || ""),
      "{DATE}": esc(kv["日期"] || ""),
      "{CONTACT}": esc(kv["联系人"] || ""),
      "{PHONE}": esc(kv["电话"] || ""),
      "{EMAIL}": esc(kv["邮箱"] || kv["E-mail"] || ""),
      "{REMARKS}": kv["备注"] ? esc(kv["备注"]) + "\n\n" : ""
    };
    items.forEach(function (p, i) {
      var n = i + 1, spec = "", qty, unit, price;
      if (p.length >= 6) { var _ = [p[0], p[1], p[2], p[3], p[4], p[5]]; spec = _[2]; qty = _[3]; unit = _[4]; price = _[5]; }
      else { spec = ""; qty = p[2]; unit = p[3]; price = p[4]; }
      var q = num(qty), pr = num(price);
      if (q == null || pr == null) throw new Error("第 " + n + " 行数量/单价不是数字");
      var amt = Math.round(q * pr * 100) / 100;
      total += amt;
      map["{I" + n + "_NAME}"] = esc(p[0]);
      map["{I" + n + "_MODEL}"] = esc(p[1] || "");
      map["{I" + n + "_SPEC}"] = esc(spec);
      map["{I" + n + "_QTY}"] = fmt(q);
      map["{I" + n + "_UNIT}"] = esc(unit || "台");
      map["{I" + n + "_PRICE}"] = fmt(pr);
      map["{I" + n + "_TOTAL}"] = fmt(amt);
    });
    for (var n = items.length + 1; n <= 10; n++) {
      map["{I" + n + "_NAME}"] = map["{I" + n + "_MODEL}"] = map["{I" + n + "_SPEC}"] = "";
      map["{I" + n + "_QTY}"] = map["{I" + n + "_UNIT}"] = map["{I" + n + "_PRICE}"] = map["{I" + n + "_TOTAL}"] = "";
    }
    map["{TOTAL}"] = fmt(Math.round(total * 100) / 100);
    return { map: map, name: "报价单_" + safeName(kv["客户名称"] || kv["客户"]) + "_" + (kv["日期"] || "") + ".xlsx" };
  }

  function setCellText(tcXml, val) {
    // 取第一个段落，保留 pPr，替换为单个 run
    var m = tcXml.match(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/);
    if (!m) return tcXml;
    var inner = m[1], ppr = (inner.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [""])[0];
    var p = "<w:p>" + ppr + '<w:r><w:t xml:space="preserve">' + val + "</w:t></w:r></w:p>";
    return tcXml.replace(m[0], p);
  }
  function fillTable(xml, rows) {
    var tbl = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/);
    if (!tbl) return xml;
    var trs = tbl[0].match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || [];
    if (trs.length < 2) return xml;
    var proto = trs[trs.length - 1]; // 空数据行作原型
    var built = rows.map(function (r) {
      var tcs = proto.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
      var filled = tcs.map(function (tc, i) { return setCellText(tc, esc(r[i] || "")); });
      return proto.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, function () { return filled.shift(); });
    }).join("");
    var newTbl = tbl[0].replace(proto, built);
    return xml.replace(tbl[0], newTbl);
  }
  function genReceipt(text) {
    var kv = parseKV(text);
    var items = parseItems(text).map(function (p) { return [p[0], p[1] || "", p[2] || "", p[3] || ""]; });
    if (!items.length) throw new Error("未解析到发货清单行（每行：名称|规格描述|数量|备注）");
    var ship = kv["发货日期"] || kv["日期"] || "";
    var way = kv["送货方式"] || "", fee = kv["送货费用"] || "";
    var mark = function (sel, key) { return sel ? "\u2611" : "\u25A1"; };
    var map = {
      "{SHIP_DATE}": esc(ship),
      "{CONTACT}": esc(kv["联系人"] || ""),
      "{PHONE}": esc(kv["电话"] || ""),
      "{CONTRACT}": esc(kv["合同编号"] || ""),
      "{COURIER}": esc(kv["送货公司"] || ""),
      "{ADDR}": esc(kv["收货地址"] || kv["收货方地址"] || ""),
      "{W_SELF}": mark(way.indexOf("自提") >= 0, 1),
      "{W_LOGI}": mark(way.indexOf("物流") >= 0, 1),
      "{W_SF}": mark(way.indexOf("顺丰") >= 0, 1),
      "{W_OTH}": mark(way.indexOf("其他") >= 0, 1),
      "{F_SUP}": mark(fee.indexOf("供方") >= 0, 1),
      "{F_REC}": mark(fee.indexOf("收货方") >= 0, 1)
    };
    return { map: map, rows: items, name: "货物签收单_" + (kv["合同编号"] || safeName(ship)) + ".docx" };
  }

  var PLACEHOLDER = {
    quote: "客户名称：北京某某科技有限公司\n日期：2026-11-18\n联系人：张经理\n电话：13800000000\n邮箱：zhang@xx.com\n备注：（可留空）\n产品名称|产品型号|配置及参数|数量|单位|单价(元)\n联想开天X5h G1d-A007|LK-X5h|海光C86-4G/16G内存/512G固态|10|台|8300",
    receipt: "发货日期：2026-11-20\n联系人：张经理\n电话：13800000000\n合同编号：HT-2026-1118\n送货方式：物流（自提/物流/顺丰/其他）\n送货费用：供方负担（供方负担/收货方自理）\n送货公司：顺丰速运\n收货地址：北京市海淀区XX路1号 王五 13900000000\n产品名称|规格及描述|数量|备注\n联想开天X5h G1d-A007|海光C86-4G/16G内存/512G固态|10|无"
  };
  var kind = "quote";
  function switchKind(k) {
    kind = k;
    document.querySelectorAll(".docs-tab").forEach(function (b) { b.classList.toggle("on", b.dataset.doc === k); });
    $("docs-input").placeholder = PLACEHOLDER[k];
    $("docs-msg").textContent = "";
  }
  function init() {
    document.querySelectorAll(".docs-tab").forEach(function (b) {
      b.addEventListener("click", function () { switchKind(b.dataset.doc); });
    });
    $("docs-gen").addEventListener("click", function () {
      var text = $("docs-input").value;
      var msg = $("docs-msg");
      msg.textContent = "生成中…";
      (function () {
        try {
          if (kind === "quote") {
            var g = genQuote(text);
            loadTpl("quote").then(function (zip) {
              // openpyxl 模板用 inlineStr（无 sharedStrings.xml），两个位置都替换
              zip.file("xl/worksheets/sheet1.xml").async("string").then(function (sx) {
                zip.file("xl/worksheets/sheet1.xml", repl(sx, g.map));
                var ss = zip.file("xl/sharedStrings.xml");
                var p = ss ? ss.async("string").then(function (s) { zip.file("xl/sharedStrings.xml", repl(s, g.map)); }) : Promise.resolve();
                return p.then(function () { return zip.generateAsync({ type: "blob" }); });
              }).then(function (blob) { download(blob, g.name); msg.textContent = "已生成：" + g.name; });
            }).catch(function (e) { msg.textContent = "失败：" + e.message; });
          } else {
            var g = genReceipt(text);
            loadTpl("receipt").then(function (zip) {
              zip.file("word/document.xml").async("string").then(function (xml) {
                zip.file("word/document.xml", repl(fillTable(xml, g.rows), g.map));
                return zip.generateAsync({ type: "blob" });
              }).then(function (blob) { download(blob, g.name); msg.textContent = "已生成：" + g.name; });
            }).catch(function (e) { msg.textContent = "失败：" + e.message; });
          }
        } catch (e) { msg.textContent = "失败：" + e.message; }
      })();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
