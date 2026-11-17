# -*- coding: utf-8 -*-
"""把 DB 的 publish_date 从"上架时间"改为"发标日期"（询价通知书 PDF 印刷落款）。
数据源：本地 82 份 PDF（已验证与接口 attchList[0].created 100% 一致），纯离线。"""
import os
import re
import sqlite3

ROOT = os.path.dirname(os.path.abspath(__file__))
PDF_DIR = os.path.join(ROOT, "data", "pdfs")
from pypdf import PdfReader


def pdf_official_date(path):
    rd = PdfReader(path)
    text = "\n".join((pg.extract_text() or "") for pg in rd.pages[:4])
    ds = set()
    for m in re.finditer(r"(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", text):
        ds.add("%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3))))
    return ds


con = sqlite3.connect(os.path.join(ROOT, "data", "board.db"))
con.row_factory = sqlite3.Row
rows = con.execute(
    "select id, publish_date, pdf_local from announcements where pdf_local is not null and pdf_local != ''"
).fetchall()

updated = ambiguous = nochange = 0
problems = []
for r in rows:
    p = os.path.join(PDF_DIR, r["pdf_local"])
    ds = pdf_official_date(p) if os.path.isfile(p) else set()
    if len(ds) == 1:
        new_d = sorted(ds)[0]
        if new_d != r["publish_date"]:
            con.execute("update announcements set publish_date = ? where id = ?", (new_d, r["id"]))
            updated += 1
        else:
            nochange += 1
    else:
        ambiguous += 1
        problems.append((r["id"], sorted(ds), r["publish_date"]))

con.commit()
con.close()
print("更新 %d 条 | 原本已一致 %d 条 | 无法判定 %d 条" % (updated, nochange, ambiguous))
if problems:
    print("需人工核对:")
    for nid, ds, old in problems:
        print("  ", nid, "PDF日期=", ds, " 原DB=", old)
