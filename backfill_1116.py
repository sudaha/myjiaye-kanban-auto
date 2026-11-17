# -*- coding: utf-8 -*-
"""把 2026-11-16 遗漏的 11 条公告补入看板数据库（走与 run_fetch 相同的数据口径）。"""
import os, sys, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db, fetcher

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "data", "board.db")
PDF = os.path.join(HERE, "data", "pdfs")
IDS = ["824481", "824479", "824478", "824477", "824473", "824461",
       "824425", "824412", "824411", "824408", "824404"]

db.init_db(DB)
for nid in IDS:
    try:
        d = fetcher.fetch_detail(nid)
    except Exception as e:
        print("  detail fail", nid, e)
        continue
    if not d.get("end_time"):
        print("  skip (no detail)", nid)
        continue
    d["is_end"] = fetcher._is_end(d.get("end_time"))
    d["category"] = fetcher.categorize(d.get("title"), d.get("products") or [])
    d["products_json"] = json.dumps(d.get("products") or [], ensure_ascii=False)
    if d.get("pdf_url"):
        p = fetcher.download_pdf(d["pdf_url"], PDF, nid)
        d["pdf_local"] = os.path.basename(p) if p else None
    d["detail_fetched"] = 1
    db.upsert_announcement(DB, d)
    print("  + %s | %s | %-4s | %s" % (nid, d.get("publish_date"), d["category"], (d.get("title") or "")[:34]))
    time.sleep(0.5)

print("total:", db.stats(DB))
print("cats:", db.categories(DB))
