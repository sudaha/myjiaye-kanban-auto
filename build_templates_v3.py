# -*- coding: utf-8 -*-
"""v3 模板构建：单产品行 + 中文 token，内置与自定义模板同一引擎。
- quote_template.xlsx : 行9为产品行 token（{序号}{名称}{型号}{规格}{数量}{单位}{单价}{行合计}），
  底部行 {总数}{备注}{联系人}{电话}{邮箱}，头部 {客户}{日期}
- receipt_template.docx : 单数据行 token（{名称}{规格}{数量}{备注}）+ 头部中文 token
"""
import os
import zipfile

import build_templates_v2 as v2  # 复用 STYLES_XML / COLW / 静态 part（副作用：重生成 v2 文件，随后被 v3 覆盖）

HERE = os.path.dirname(os.path.abspath(__file__))
XLSX_SRC = r"C:\Users\48372\OneDrive\Desktop\佳业同创报价单模版.xlsx"
DOCX_SRC = r"C:\Users\48372\OneDrive\Desktop\货物签收单_模板.docx"
TPL_DIR = os.path.join(HERE, "web", "templates")
W = v2.W
S = v2.S

TERMS = "1,报价有效期：30天；\n2,报价含13%增值税；\n3,报价已含国内快递运费；"


def str_cell(ref, s, text):
    return '<c r="%s" s="%d" t="inlineStr"><is><t>%s</t></is></c>' % (ref, s, v2.esc(text))


def empty_cell(ref, s):
    return '<c r="%s" s="%d"/>' % (ref, s)


def num_cell(ref, s, token):
    # token 作为文本占位（引擎识别），模板里显示为 {总数} 等
    return str_cell(ref, s, token)


V3_MERGES = [
    "F1:J1", "F2:J2", "A3:E3", "F3:J3", "A4:E4", "F4:J4", "A5:E5", "F5:J5", "A6:E6", "F6:J6",
    "D7:F8",
    "D9:F9",
    "A10:C10", "D10:F10", "G10:I10", "A11:C11", "D11:J11",
]


def build_sheet_xml():
    cols = "".join('<col min="%d" max="%d" width="%s" customWidth="1"/>' % (i, i, v2.COLW[c])
                   for i, c in enumerate("ABCDEFGHIJ", 1))
    rows = []
    rows.append('<row r="1" ht="54.6" customHeight="1">' +
                str_cell("E1", S["title"], "报 价 单") +
                empty_cell("F1", 0) + empty_cell("G1", 0) + empty_cell("H1", 0) +
                empty_cell("I1", 0) + empty_cell("J1", 0) + "</row>")
    rows.append('<row r="2" ht="21" customHeight="1">' +
                str_cell("E2", S["quot"], "Quotation") +
                empty_cell("F2", 0) + empty_cell("G2", 0) + empty_cell("H2", 0) +
                empty_cell("I2", 0) + empty_cell("J2", 0) + "</row>")
    rows.append('<row r="3" ht="18" customHeight="1">' +
                str_cell("A3", S["co_cn"], "北 京 佳 业 同 创 科 技 有 限 公 司") +
                str_cell("F3", S["label"], "致：  {客户}") + "</row>")
    rows.append('<row r="4" ht="19.25" customHeight="1">' +
                str_cell("A4", S["co_en"], "Beijing Jiayetongchuang Technology Co., Ltd.") +
                str_cell("F4", S["label"], "To:") + "</row>")
    rows.append('<row r="5" ht="19.5" customHeight="1">' +
                str_cell("A5", S["addr_cn"], "地址：北京市海淀区体院西路甲2号 14号楼1层 101") + "</row>")
    rows.append('<row r="6" ht="16.65" customHeight="1">' +
                str_cell("A6", S["addr_en"], "101, Floor 1, Building 14, No.2, Tiyuan West Road, Haidian District, Beijing Beijing China") +
                str_cell("F6", S["label"], "日期 (Date):  {日期}") + "</row>")
    h7 = [("A7", "序号"), ("B7", "产品名称"), ("C7", "产品型号"), ("D7", "配置及参数\nDescription"),
          ("E7", ""), ("F7", ""), ("G7", "数量"), ("H7", "单位"), ("I7", "单价(元)"), ("J7", "合计(元)")]
    rows.append('<row r="7" ht="30.55" customHeight="1">' +
                "".join(str_cell(r, S["head"], t) for r, t in h7) + "</row>")
    h8 = [("A8", "NO."), ("B8", "Commodity"), ("C8", "SKU"), ("D8", ""), ("E8", ""), ("F8", ""),
          ("G8", "Quantity"), ("H8", "Unit"), ("I8", "Price"), ("J8", "Total")]
    rows.append('<row r="8" ht="19.7" customHeight="1">' +
                "".join(str_cell(r, S["head"], t) for r, t in h8) + "</row>")
    # 产品行（单行原型，引擎按 n 复制）
    rows.append('<row r="9">' +  # 产品行不设固定行高：引擎按内容换行自适应
                num_cell("A9", S["A"], "{序号}") +
                str_cell("B9", S["B"], "{名称}") +
                str_cell("C9", S["C"], "{型号}") +
                str_cell("D9", S["D"], "{规格}") +
                empty_cell("E9", S["empty"]) +
                empty_cell("F9", S["empty"]) +
                num_cell("G9", S["G"], "{数量}") +
                str_cell("H9", S["H"], "{单位}") +
                num_cell("I9", S["I"], "{单价}") +
                num_cell("J9", S["J"], "{行合计}") +
                "</row>")
    # 底部行
    rows.append('<row r="10" ht="25.25" customHeight="1">' +
                "".join(empty_cell(c + "10", S["empty"]) for c in "ABCDEF") +
                str_cell("G10", S["total_label"], "合计金额Total Amount") +
                empty_cell("H10", S["empty"]) + empty_cell("I10", S["empty"]) +
                str_cell("J10", S["total_val"], "{总数}") + "</row>")
    rows.append('<row r="11" ht="77.8" customHeight="1">' +
                str_cell("A11", S["remark_label"], "备注Remarks") +
                empty_cell("B11", S["empty"]) + empty_cell("C11", S["empty"]) +
                str_cell("D11", S["remark_text"], "{备注}\n" + TERMS) +
                "".join(empty_cell(c + "11", S["empty"]) for c in "EFGHIJ") + "</row>")
    for r, txt in ((12, "联系人：  {联系人}"), (13, "电话 tel:  {电话}"), (14, "E-mail:  {邮箱}")):
        rows.append('<row r="%d">' % r + str_cell("G%d" % r, S["contact"], txt) + "</row>")
    head = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="%s" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheetPr><pageSetUpPr/></sheetPr>'
            '<dimension ref="A1:J14"/>'
            '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>'
            '<sheetFormatPr defaultRowHeight="14.4"/>'
            "<cols>%s</cols><sheetData>%s</sheetData>" % (W, cols, "".join(rows)))
    sheet = head + '<mergeCells count="%d">' % len(V3_MERGES) + "".join(
        '<mergeCell ref="%s"/>' % m for m in V3_MERGES) + (
        "</mergeCells>"
        '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
        '<pageSetup orientation="landscape" paperSize="9"/>'
        '<drawing r:id="rId1"/></worksheet>')
    return sheet


def build_quote_xlsx():
    out = os.path.join(TPL_DIR, "quote_template.xlsx")
    with zipfile.ZipFile(XLSX_SRC) as zin:
        theme = zin.read("xl/theme/theme1.xml")
        drawing = zin.read("xl/drawings/drawing1.xml")
        drawing_rels = zin.read("xl/drawings/_rels/drawing1.xml.rels")
        logo = zin.read("xl/media/image1.png")
    parts = {
        "[Content_Types].xml": v2.CONTENT_TYPES,
        "_rels/.rels": v2.ROOT_RELS,
        "docProps/core.xml": v2.CORE_XML,
        "docProps/app.xml": v2.APP_XML,
        "xl/workbook.xml": v2.WORKBOOK,
        "xl/_rels/workbook.xml.rels": v2.WB_RELS,
        "xl/styles.xml": v2.STYLES_XML,
        "xl/theme/theme1.xml": theme,
        "xl/worksheets/sheet1.xml": build_sheet_xml(),
        "xl/worksheets/_rels/sheet1.xml.rels": v2.SHEET_RELS,
        "xl/drawings/drawing1.xml": drawing,
        "xl/drawings/_rels/drawing1.xml.rels": drawing_rels,
        "xl/media/image1.png": logo,
    }
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    print("XLSX v3 完成:", out)


REPL3 = {
    2: "  {发货日期}  ",
    4: "  {联系人}  ",
    6: "  {电话}  ",
    7: "关联合同编号：  {合同}  ",
    13: "送货方式：{自提}自提　{物流}物流　{顺丰}顺丰　{其他}其他",
    15: "送货费用：{供方}由供方负担　　{收货}收货方自理",
    16: "送货公司：  {快递}  ",
    17: "收货方地址及联系人：  {地址}  ",
}


def build_receipt_docx():
    import re as _re
    # 1) 复用 v2 构建：REPL3 段落 token + 单数据行原型（空格子带统一 rPr）
    v2.REPL = REPL3
    v2.build_receipt_docx()
    out = os.path.join(TPL_DIR, "receipt_template.docx")
    # 2) 给原型数据行的 4 个空 w:t 注入 token
    with zipfile.ZipFile(out) as z:
        xml = z.read("word/document.xml").decode("utf-8")
        names = z.namelist()
        data = {n: z.read(n) for n in names}
    tbl_m = _re.search(r"<w:tbl>[\s\S]*?</w:tbl>", xml)
    assert tbl_m, "未找到表格"
    tbl = tbl_m.group(0)
    trs = _re.findall(r"<w:tr\b[\s\S]*?</w:tr>", tbl)
    assert len(trs) == 2, "v3 表格应只有表头+原型行，实际 %d" % len(trs)
    proto = trs[1]
    tokens = ["{名称}", "{规格}", "{数量}", "{备注}"]
    cnt = [0]

    def _fill(m):
        t = tokens[cnt[0]]
        cnt[0] += 1
        return '<w:t xml:space="preserve">%s</w:t>' % t

    filled, n_sub = _re.subn(r"<w:t></w:t>", _fill, proto)
    assert n_sub == 4, "原型行空格子数=%d，应为4" % n_sub
    xml = xml.replace(proto, filled)
    data["word/document.xml"] = xml.encode("utf-8")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in names:
            z.writestr(name, data[name])
    print("DOCX v3 完成:", out)


if __name__ == "__main__":
    # 禁止继续使用本文件的历史重建函数覆盖用户母版。
    # 唯一允许的构建路径：复制原始母版，只向数据格注入 token。
    import build_templates_original as original
    original.build_quote()
    original.build_receipt()
    print("ALL DONE v3 (original-master fidelity mode)")
