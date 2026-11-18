// docs v4 引擎 Node 测试：零修改原则 + 免符号解析 + 真实模板回归
const fs = require("fs");
const path = require("path");
const B = __dirname;
global.window = {};
const docs = require(path.join(B, "static_src", "docs.js"));
global.window.Docs = docs;
const v3 = require(path.join(B, "static_src", "docs_v3.js"));
const JSZip = require(path.join(B, "static_src", "jszip.min.js"));

let pass = 0, fail = 0;
function T(name, cond, extra) {
  if (cond) { pass++; console.log("  OK  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "  | " + extra : "")); }
}
const countRe = (s, re) => (s.match(re) || []).length;

// ---------- 真实模板（内置） ----------
function loadZip(p) {
  return JSZip.loadAsync(fs.readFileSync(p));
}
function sheetOf(zip) {
  return zip.file("xl/worksheets/sheet1.xml").async("string");
}

const TEXT1 = [
  "客户名称：北京某某科技有限公司", "日期：2026-11-18", "联系人：张经理", "电话：13800000000",
  "邮箱：zhang@xx.com", "备注：（可留空）",
  "产品名称|产品型号|配置及参数|数量|单位|单价(元)",
  "联想开天X5h G1d-A007|LK-X5h|海光C86-4G/16G内存/512G固态|10|台|8300",
  "戴尔 PowerEdge R760|PE-R760|Xeon Gold 6430/256G内存|2|台|128000"
].join("\n");

(async function main() {
  const qzip = await loadZip(path.join(B, "web", "templates", "quote_template.xlsx"));
  const qsheet = await sheetOf(qzip);
  const qstyles = qzip.file("xl/styles.xml") ? await qzip.file("xl/styles.xml").async("string") : "";
  const qss = qzip.file("xl/sharedStrings.xml") ? await qzip.file("xl/sharedStrings.xml").async("string") : null;

  const TEXT_FREE = [
    "客户名称：北京某某科技有限公司", "日期：2026-11-18", "联系人：张经理", "电话：13800000000",
    "邮箱：zhang@xx.com",
    "联想开天X5h G1d-A007 LK-X5h 海光C86-4G/16G内存/512G固态 10台 8300",
    "戴尔 PowerEdge R760 PE-R760 Xeon Gold 6430/256G内存 2 台 128000"
  ].join("\n");

  console.log("== 免符号解析 freeItem ==");
  const pF = docs.parseFree(TEXT_FREE);
  T("识别 2 行", pF.items.length === 2, String(pF.items.length));
  T("名称含中文+ASCII", pF.items[0] && pF.items[0].name === "联想开天X5h G1d-A007", pF.items[0] && pF.items[0].name);
  T("型号", pF.items[0] && pF.items[0].model === "LK-X5h", pF.items[0] && pF.items[0].model);
  T("规格", pF.items[0] && pF.items[0].spec === "海光C86-4G/16G内存/512G固态", pF.items[0] && pF.items[0].spec);
  T("数量/单位/单价", pF.items[0] && pF.items[0].qty === 10 && pF.items[0].unit === "台" && pF.items[0].price === 8300,
    pF.items[0] && JSON.stringify(pF.items[0]));
  T("第二行分开写 2 台", pF.items[1] && pF.items[1].qty === 2 && pF.items[1].unit === "台" && pF.items[1].price === 128000,
    pF.items[1] && JSON.stringify(pF.items[1]));
  const pNoQty = docs.parseFree("今天天气很好 12345");
  T("无数量不误判", pNoQty.items.length === 0, JSON.stringify(pNoQty.items));
  const pRC = docs.parseFree("戴尔 PowerEdge R760 PE-R760 Xeon 6430 2 含上架安装");
  T("尾部备注", pRC.items.length === 1 && pRC.items[0].qty === 2 && pRC.items[0].remark === "含上架安装",
    JSON.stringify(pRC.items));

  console.log("== 内置报价单 n=2 ==");
  const p1 = docs.parseFree(TEXT1);
  const r2 = v3.buildXlsxXml(qsheet, qss, qstyles, p1, "quote");
  T("原母版17行全部保留", countRe(r2.sheetXml, /<row /g) === 17, String(countRe(r2.sheetXml, /<row /g)));
  T("客户已填", r2.sheetXml.indexOf("北京某某科技有限公司") >= 0);
  T("token 无残留", !/\{[A-Za-z0-9_\u4e00-\u9fa5]+\}/.test(r2.sheetXml), (r2.sheetXml.match(/\{[^}]+\}/g) || []).join(","));
  T("金额格式化", r2.sheetXml.indexOf("128,000.00") >= 0 && r2.sheetXml.indexOf("339,000.00") >= 0);
  T("序号 2 已填", r2.sheetXml.indexOf('<t xml:space="preserve">2</t>') >= 0);
  T("原3个产品格合并保留", r2.sheetXml.indexOf('ref="D9:F9"') >= 0 && r2.sheetXml.indexOf('ref="D10:F10"') >= 0 && r2.sheetXml.indexOf('ref="D11:F11"') >= 0);
  T("原总行 G12:I12 保留", r2.sheetXml.indexOf('ref="G12:I12"') >= 0);
  T("原 dimension A1:J17 保留", r2.sheetXml.indexOf('ref="A1:J17"') >= 0);
  T("联系人原位 G14", r2.sheetXml.indexOf("联系人：张经理") >= 0);
  T("sharedStrings 字节不变", r2.ssXml === (qss || ""));

  console.log("== 内置报价单 n=12 ==");
  const p12 = docs.parseFree(["客户名称：大单", "日期：2026-11-18"].concat(
    Array.from({ length: 12 }, (_, i) => ["产品A" + i, "型号" + i, "海光C86/16G" + i, i + 1, "台", 1000].join("|"))).join("\n"));
  const r12 = v3.buildXlsxXml(qsheet, qss, qstyles, p12, "quote");
  T("原空白尾行保留，扩容后26行", countRe(r12.sheetXml, /<row /g) === 26, String(countRe(r12.sheetXml, /<row /g)));
  T("G21:I21 总行", r12.sheetXml.indexOf('ref="G21:I21"') >= 0);
  T("dimension A1:J26", r12.sheetXml.indexOf('ref="A1:J26"') >= 0);
  T("第12行名称", r12.sheetXml.indexOf("产品A11") >= 0);

  console.log("== mock 用户模板（sharedStrings + 多run + 白字 + 固定行高）零修改证明 ==");
  const MOCK_STYLES = '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="4">' +
    '<font><sz val="11"/><name val="宋体"/></font>' +
    '<font><sz val="11"/><color rgb="FFFFFFFF"/><name val="宋体"/></font>' +
    '<font><b/><sz val="11"/><name val="宋体"/></font>' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/>' +
    '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>';
  const MOCK_SS = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="10" uniqueCount="10">' +
    '<si><t>致：  {客户}</t></si>' +
    '<si><t>{日期}</t></si>' +
    '<si><r><rPr><b/></rPr><t>产品</t></r><r><rPr><b/></rPr><t>名称</t></r></si>' +
    '<si><t>{序号}</t></si>' +
    '<si><t>{型号}</t></si>' +
    '<si><t>{规格}</t></si>' +
    '<si><t>{数量}</t></si>' +
    '<si><t>{单价}</t></si>' +
    '<si><t>静态文本XYZ</t></si>' +
    '<si><t>联系人：  {联系人}</t></si></sst>';
  const MOCK_SHEET = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="A1:H5"/>' +
    '<cols><col min="1" max="1" width="6" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/></cols>' +
    '<sheetData>' +
    '<row r="1" ht="18.6" customHeight="1"><c r="A1" s="0" t="s"><v>0</v></c><c r="B1" s="1" t="s"><v>1</v></c><c r="H1" s="3" t="s"><v>8</v></c></row>' +
    '<row r="2"><c r="A2" s="2" t="s"><v>2</v></c><c r="B2" s="2" t="inlineStr"><is><r><rPr><b/></rPr><t>多</t></r><r><rPr><b/><i/></rPr><t>run富文本</t></r></is></c></row>' +
    '<row r="3" ht="24" customHeight="1"><c r="A3" s="0" t="s"><v>3</v></c><c r="B3" s="1" t="inlineStr"><is><t>{名称}</t></is></c><c r="C3" s="0" t="s"><v>4</v></c><c r="D3" s="0" t="s"><v>5</v></c><c r="E3" s="0" t="s"><v>6</v></c><c r="F3" s="0" t="inlineStr"><is><t>{单位}</t></is></c><c r="G3" s="1" t="s"><v>7</v></c><c r="H3" s="1" t="inlineStr"><is><t>{行合计}</t></is></c></row>' +
    '<row r="4"><c r="A4" s="0" t="inlineStr"><is><t>{总数}</t></is></c></row>' +
    '<row r="5"><c r="A5" s="1" t="s"><v>9</v></c></row>' +
    '</sheetData></worksheet>';

  const rm = v3.buildXlsxXml(MOCK_SHEET, MOCK_SS, MOCK_STYLES, p1, "quote");
  T("白字检测 xf1", v3.whiteXfs(MOCK_STYLES, v3.whiteFontIds(MOCK_STYLES))[1] === true);
  const newRow3 = (rm.sheetXml.match(/<row\s+r="3"[^>]*>[\s\S]*?<\/row>/) || [""])[0];
  const sB3 = ((newRow3.match(/<c r="B3" s="(\d+)"/) || [])[1]);
  const sG3 = ((newRow3.match(/<c r="G3" s="(\d+)"/) || [])[1]);
  T("白字格 B3 换黑字 xf", sB3 !== undefined && sB3 !== "1", "sB3=" + sB3);
  T("白字格 G3 换黑字 xf", sG3 !== undefined && sG3 !== "1", "sG3=" + sG3);
  const newFonts = (rm.stylesXml.match(/<font>[\s\S]*?<\/font>/g) || []).length;
  const newXfs = (rm.stylesXml.match(/<cellXfs count="(\d+)"/) || [])[1];
  T("styles 追加统一字体+白字兼容字体", newFonts === 6, String(newFonts));
  T("styles 仅追加受控 xf", newXfs === "7", String(newXfs));
  T("新字体为黑", /<font>[\s\S]*?<color rgb="FF000000"\/>[\s\S]*?<\/font>/.test(rm.stylesXml) ||
    (rm.stylesXml.match(/<font>[\s\S]*?<\/font>/g) || []).slice(-1)[0].indexOf('rgb="FF000000"') >= 0);
  T("非 token 格字节不变（H1 静态）", rm.sheetXml.indexOf('<c r="H1" s="3" t="s"><v>8</v></c>') >= 0);
  T("多 run 富文本保留", rm.sheetXml.indexOf('<r><rPr><b/></rPr><t>多</t></r><r><rPr><b/><i/></rPr><t>run富文本</t></r>') >= 0);
  T("固定行高保持", /<row r="3" ht="24" customHeight="1">/.test(rm.sheetXml) && /<row r="1" ht="18.6" customHeight="1">/.test(rm.sheetXml));
  T("无 token 行原样（行2 除 A2 外）", rm.sheetXml.indexOf('<c r="B2" s="2" t="inlineStr">') >= 0);
  T("ss 字节不变（不触碰 sharedStrings）", rm.ssXml === MOCK_SS, rm.ssXml.slice(0, 120));
  T("t=s 产品格转 inlineStr且使用统一样式", /<c r="C3" s="5" t="inlineStr"><is><t xml:space="preserve">LK-X5h<\/t><\/is><\/c>/.test(rm.sheetXml),
    (rm.sheetXml.match(/<c r="C3"[^>]*>[\s\S]*?<\/c>/) || [""])[0]);
  T("行数 6", countRe(rm.sheetXml, /<row /g) === 6, String(countRe(rm.sheetXml, /<row /g)));
  const rowA6 = (rm.sheetXml.match(/<row\s+r="6"[^>]*>[\s\S]*?<\/row>/) || [""])[0];
  T("底部行平移+白字改黑", /<c r="A6" s="4" t="inlineStr"><is><t xml:space="preserve">联系人：  张经理<\/t><\/is><\/c>/.test(rowA6), rowA6);
  T("mock sheet token 无残留", !/\{[A-Za-z0-9_\u4e00-\u9fa5]+\}/.test(rm.sheetXml), (rm.sheetXml.match(/\{[^}]+\}/g) || []).join(","));

  console.log("== 一键成表：内置 generic xlsx ==");
  const gzip = await loadZip(path.join(B, "web", "templates", "generic_table.xlsx"));
  const gsheet = await sheetOf(gzip);
  const gstyles = await gzip.file("xl/styles.xml").async("string");
  T("detect 产品行=4", v3.detectXlsx(gsheet, []).productRow === 4);
  const rg = v3.buildXlsxXml(gsheet, null, gstyles, p1, "quote");
  T("generic 行数=6", countRe(rg.sheetXml, /<row /g) === 6, String(countRe(rg.sheetXml, /<row /g)));
  T("generic 日期客户填", rg.sheetXml.indexOf("2026-11-18") >= 0 && rg.sheetXml.indexOf("北京某某科技有限公司") >= 0);
  T("generic 总行 H6", rg.sheetXml.indexOf('<c r="H6"') >= 0 && rg.sheetXml.indexOf("339,000.00") >= 0);
  T("generic 无 token 残留", !/\{[A-Za-z0-9_\u4e00-\u9fa5]+\}/.test(rg.sheetXml));

  console.log("== 一键成表：内置 generic docx ==");
  const gz2 = await loadZip(path.join(B, "web", "templates", "generic_table.docx"));
  const gdoc = await gz2.file("word/document.xml").async("string");
  const TEXT_R = [
    "发货日期：2026-11-20", "联系人：李工", "电话：13911112222", "合同编号：HT-2026-1119",
    "送货方式：顺丰", "送货费用：收货方自理", "送货公司：顺丰速运",
    "收货地址：北京市昌平区回龙观东大街111号 赵六 13822225555",
    "产品名称|规格及描述|数量|备注",
    "戴尔 PowerEdge R760|PE-R760 Xeon 6430×2/256G内存|2|含上架安装",
    "锐捷交换机|RG-S6510 48口千兆|2|",
    "H3C路由器|MSR3640-XS 双电源|4|"
  ].join("\n");
  const pR = docs.parseFree(TEXT_R);
  const rgd = v3.buildDocxXml(gdoc, pR);
  T("generic docx 表格 4 行", (rgd.xml.match(/<w:tr\b/g) || []).length === 4, String((rgd.xml.match(/<w:tr\b/g) || []).length));
  T("generic docx 已填", rgd.xml.indexOf("戴尔 PowerEdge R760") >= 0 && rgd.xml.indexOf("H3C路由器") >= 0);
  T("generic docx 发货日期", rgd.xml.indexOf("2026-11-20") >= 0 && rgd.xml.indexOf("李工") >= 0);
  T("generic docx 无残留", rgd.leftTokens.length === 0, rgd.leftTokens.join(","));

  console.log("== 内置签收单 docx ==");
  const rzip = await loadZip(path.join(B, "web", "templates", "receipt_template.docx"));
  const rdoc = await rzip.file("word/document.xml").async("string");
  const rRes = v3.buildDocxXml(rdoc, pR);
  T("表格行数=4", (rRes.xml.match(/<w:tr\b/g) || []).length === 4, String((rRes.xml.match(/<w:tr\b/g) || []).length));
  T("3 产品已填", rRes.xml.indexOf("戴尔 PowerEdge R760") >= 0 && rRes.xml.indexOf("锐捷交换机") >= 0 && rRes.xml.indexOf("H3C路由器") >= 0);
  T("备注列", rRes.xml.indexOf("含上架安装") >= 0);
  T("勾选顺丰", rRes.xml.indexOf("\u2611顺丰") >= 0 && rRes.xml.indexOf("\u25A1自提") >= 0);
  T("合同号", rRes.xml.indexOf("HT-2026-1119") >= 0);
  T("无残留 token", rRes.leftTokens.length === 0, rRes.leftTokens.join(","));

  console.log("== 预览 HTML ==");
  const qh = v3.previewQuoteHtml(p1, 339000, "");
  T("quote 预览客户", qh.indexOf("北京某某科技有限公司") >= 0);
  T("quote 预览合计", qh.indexOf("339,000.00") >= 0);
  const th = v3.previewTableHtml(p1);
  T("table 预览是字符串", typeof th === "string" && th.indexOf("产品清单") >= 0 && th.indexOf("339,000.00") >= 0);
  const rh = v3.previewReceiptHtml(pR);
  T("receipt 预览地址", rh.indexOf("北京市昌平区回龙观东大街111号") >= 0);

  console.log("\n%d passed, %d failed", pass, fail);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error("FATAL", e); process.exit(2); });
