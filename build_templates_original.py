# -*- coding: utf-8 -*-
"""从用户原始母版生成网页运行模板。

硬规则：
- 原始 xlsx/docx 是唯一母版；不重建工作簿/文档，不替换任何资源或样式。
- 仅修改 sheet1.xml/document.xml 中需要填数据的位置，注入 token。
- ZIP 内其他成员原字节复制；原始文件本身永不写入。
"""
import os
import re
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "source_templates")
OUT = os.path.join(ROOT, "web", "templates")
QUOTE_SRC = os.path.join(SRC, "佳业同创报价单模版_原始母版.xlsx")
RECEIPT_SRC = os.path.join(SRC, "货物签收单_模板_原始母版.docx")
os.makedirs(OUT, exist_ok=True)


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def patch_xlsx_cell(xml, ref, text):
    pat = re.compile(r'<c\b[^>]*\br="%s"[^>]*?(?:/>|>[\s\S]*?</c>)' % re.escape(ref))
    m = pat.search(xml)
    if not m:
        raise RuntimeError("原始报价单未找到单元格 %s" % ref)
    seg = m.group(0)
    open_m = re.match(r"<c\b([^>]*)", seg)
    attrs = open_m.group(1)
    attrs = re.sub(r'\s+t="[^"]*"', "", attrs)
    attrs = re.sub(r'\s+r="[^"]*"', "", attrs)
    attrs = attrs.rstrip().rstrip("/").rstrip()  # 自闭合 <c .../> 去掉尾部斜线
    rep = '<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (
        ref, attrs, esc(text))
    return xml[:m.start()] + rep + xml[m.end():]


def build_quote():
    with zipfile.ZipFile(QUOTE_SRC) as zin:
        names = zin.namelist()
        data = {n: zin.read(n) for n in names}
    sheet = data["xl/worksheets/sheet1.xml"].decode("utf-8")

    # 仅把原母版对应数据格改成 token；原 3 个产品行全部保留。
    values = {
        "F3": "                      致：{客户}",
        "F6": "日期 (Date):{日期}",
        "A9": "{序号}", "B9": "{名称}", "C9": "{型号}", "D9": "{规格}",
        "G9": "{数量}", "H9": "{单位}", "I9": "{单价}", "J9": "{行合计}",
        "A10": "{序号}", "B10": "{名称}", "C10": "{型号}", "D10": "{规格}",
        "G10": "{数量}", "H10": "{单位}", "I10": "{单价}", "J10": "{行合计}",
        "A11": "{序号}", "B11": "{名称}", "C11": "{型号}", "D11": "{规格}",
        "G11": "{数量}", "H11": "{单位}", "I11": "{单价}", "J11": "{行合计}",
        "J12": "{总数}",
        "D13": "{备注}\n1,报价有效期：30天；\n\n2,报价含13%增值税；\n\n3,报价已含国内快递运费；",
        "G14": "联系人：{联系人}",
        "G15": "电话 tel:{电话}",
        "G16": "E-mail:{邮箱}",
    }
    for ref, text in values.items():
        sheet = patch_xlsx_cell(sheet, ref, text)
    data["xl/worksheets/sheet1.xml"] = sheet.encode("utf-8")

    dst = os.path.join(OUT, "quote_template.xlsx")
    with zipfile.ZipFile(dst, "w") as zout:
        for n in names:
            info = zipfile.ZipInfo(n)
            src_info = zipfile.ZipFile(QUOTE_SRC).getinfo(n)
            info.date_time = src_info.date_time
            info.compress_type = src_info.compress_type
            info.external_attr = src_info.external_attr
            zout.writestr(info, data[n])
    print("QUOTE original-master template:", dst)


def replace_wt_by_index(xml, mapping):
    idx = [0]
    def sub(m):
        i = idx[0]
        idx[0] += 1
        if i not in mapping:
            return m.group(0)
        return m.group(1) + esc(mapping[i]) + "</w:t>"
    return re.sub(r"(<w:t(?:\s[^>]*)?>)([\s\S]*?)</w:t>", sub, xml)


def inject_cell_token(tc, token):
    # 原数据行空白单元格：只在其首段末尾增加一个文本 run；tcPr/pPr/边框/宽度原样保留。
    p = re.search(r"<w:p\b[^>]*>[\s\S]*?</w:p>", tc)
    if not p:
        raise RuntimeError("原始签收单数据行单元格没有段落")
    pxml = p.group(0)
    run = '<w:r><w:t xml:space="preserve">%s</w:t></w:r>' % esc(token)
    pnew = pxml.replace("</w:p>", run + "</w:p>")
    return tc[:p.start()] + pnew + tc[p.end():]


def build_receipt():
    with zipfile.ZipFile(RECEIPT_SRC) as zin:
        names = zin.namelist()
        infos = {n: zin.getinfo(n) for n in names}
        data = {n: zin.read(n) for n in names}
    doc = data["word/document.xml"].decode("utf-8")
    doc = replace_wt_by_index(doc, {
        2: "{发货日期}",
        4: "{联系人}",
        6: "{电话}",
        7: "关联合同编号：{合同}",
        13: "送货方式：{自提}自提　{物流}物流　{顺丰}顺丰　{其他}其他",
        15: "送货费用：{供方}由供方负担　　{收货}收货方自理",
        16: "送货公司：{快递}",
        17: "收货方地址及联系人：{地址}",
    })
    tbl_m = re.search(r"<w:tbl>[\s\S]*?</w:tbl>", doc)
    if not tbl_m:
        raise RuntimeError("原始签收单未找到表格")
    trs = re.findall(r"<w:tr\b[\s\S]*?</w:tr>", tbl_m.group(0))
    if len(trs) != 2:
        raise RuntimeError("原始签收单应为表头+1个空数据行，实际 %d 行" % len(trs))
    proto = trs[1]
    tcs = re.findall(r"<w:tc>[\s\S]*?</w:tc>", proto)
    if len(tcs) != 4:
        raise RuntimeError("原始签收单数据行应为4格，实际 %d 格" % len(tcs))
    filled = [inject_cell_token(tcs[i], ("{名称}", "{规格}", "{数量}", "{备注}")[i]) for i in range(4)]
    pos = [0]
    proto_new = re.sub(r"<w:tc>[\s\S]*?</w:tc>", lambda m: filled.__getitem__(pos.__setitem__(0, pos[0] + 1) or pos[0] - 1), proto)
    tbl_new = tbl_m.group(0).replace(proto, proto_new)
    doc = doc[:tbl_m.start()] + tbl_new + doc[tbl_m.end():]
    data["word/document.xml"] = doc.encode("utf-8")

    dst = os.path.join(OUT, "receipt_template.docx")
    with zipfile.ZipFile(dst, "w") as zout:
        for n in names:
            src_info = infos[n]
            info = zipfile.ZipInfo(n)
            info.date_time = src_info.date_time
            info.compress_type = src_info.compress_type
            info.external_attr = src_info.external_attr
            zout.writestr(info, data[n])
    print("RECEIPT original-master template:", dst)


if __name__ == "__main__":
    build_quote()
    build_receipt()
    print("ALL ORIGINAL MASTER TEMPLATES READY")
