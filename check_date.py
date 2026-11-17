# -*- coding: utf-8 -*-
"""核查 publish_date（shortPublistTime）与询价通知书 PDF 上的日期是否一致。"""
import io
import os
import re
import sqlite3

BASE = os.path.dirname(os.path.abspath(__file__))
con = sqlite3.connect(os.path.join(BASE, "data", "board.db"))
con.row_factory = sqlite3.Row

print("=== publish_date 分布（前 14 天）===")
for r in con.execute(
    "select substr(publish_date,1,10) d, count(*) n from announcements "
    "group by d order by d desc limit 14"
):
    print(r["d"], r["n"])

print()
print("=== 抽 5 条有 PDF 的公告 ===")
rows = con.execute(
    "select id, title, publish_date, end_time, pdf_local from announcements "
    "where pdf_local is not null and pdf_local != '' order by id desc limit 5"
).fetchall()
for r in rows:
    print(dict(r))

# 从 PDF 文本里找日期（询价通知书落款 / 发布日期）
def pdf_dates(path):
    if not os.path.isfile(path):
        return None
    try:
        from pypdf import PdfReader
        rd = PdfReader(path)
        out = []
        for pg in rd.pages[:3]:
            t = pg.extract_text() or ""
            for m in re.finditer(r"(20\d{2})[年.\-/](\d{1,2})[月.\-/](\d{1,2})", t):
                out.append("%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3))))
        return sorted(set(out))
    except Exception as e:
        return "ERR " + str(e)[:60]

# 全量比对：所有有 PDF 的公告
print()
print("=== 全量比对（DB publish_date vs PDF 内日期）===")
rows = con.execute(
    "select id, title, publish_date, pdf_local from announcements "
    "where pdf_local is not null and pdf_local != ''"
).fetchall()
mismatch = 0
for r in rows:
    p = os.path.join(BASE, "data", "pdfs", r["pdf_local"])
    ds = pdf_dates(p)
    db_d = (r["publish_date"] or "")[:10]
    if isinstance(ds, str):
        verdict = ds
    elif not ds:
        verdict = "(PDF无日期)"
    elif db_d in ds:
        verdict = "MATCH"
    else:
        verdict = "MISMATCH!"
        mismatch += 1
    if verdict != "MATCH":
        print("%s | DB=%s | PDF=%s | %s" % (r["id"], db_d, ds, r["title"][:36]))
print()
print("共 %d 条有PDF，不一致 %d 条" % (len(rows), mismatch))
