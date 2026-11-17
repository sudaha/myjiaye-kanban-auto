# -*- coding: utf-8 -*-
"""从 web_fetch 落盘文件提取 8 条公告的 attchList 日期，与本地 PDF 落款比对。"""
import os
import re

SRC = "C:\\Users\\48372\\.accio\\accounts\\1741251172_127001\\agents\\MID-21251172U1792735-281014-2742-B8D55B\\agent-core\\tool-results\\CID-23251172U1794879-281014-0003-336B90\\web_fetch_call_763cde4ef4db45dcb81cdc5d.txt"
PDF_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "pdfs")
from pypdf import PdfReader

txt = open(SRC, encoding="utf-8", errors="ignore").read()
ids = [824795, 824796, 824798, 824801, 824805, 824806, 824813, 824815]
ok = 0
for nid in ids:
    idx = txt.find("id=%d" % nid)
    seg = txt[idx: idx + 40000] if idx >= 0 else ""
    m = re.search(r'attchList.*?"created":"(20\d{2}-\d{2}-\d{2})', seg)
    api_d = m.group(1) if m else None
    pdf_d = None
    p = os.path.join(PDF_DIR, "%d.pdf" % nid)
    if os.path.isfile(p):
        rd = PdfReader(p)
        t = "\n".join((pg.extract_text() or "") for pg in rd.pages[:4])
        ds = set("%s-%02d-%02d" % (mm.group(1), int(mm.group(2)), int(mm.group(3)))
                 for mm in re.finditer(r"(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", t))
        pdf_d = sorted(ds)
    mark = "OK" if (api_d and api_d in (pdf_d or [])) else "CHECK"
    ok += 1 if mark == "OK" else 0
    print(nid, "api=", api_d, " pdf=", pdf_d, mark)
print("---")
print("%d /8 一致" % ok)
