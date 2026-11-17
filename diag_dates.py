# -*- coding: utf-8 -*-
import sqlite3
import os

conn = sqlite3.connect(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "board.db"))
conn.row_factory = sqlite3.Row
meta = dict(conn.execute("SELECT key, value FROM meta").fetchall())
print("meta:", meta)
cols = [c[1] for c in conn.execute("PRAGMA table_info(announcements)").fetchall()]
print("columns:", cols)
print()
rows = conn.execute("SELECT id, publish_date, end_time, title FROM announcements ORDER BY id DESC LIMIT 30").fetchall()
for r in rows:
    print("%-8s pub=%s end=%s %s" % (r["id"], r["publish_date"], str(r["end_time"])[:16], (r["title"] or "")[:44]))
print()
print("publish_date 分布（最近）:")
for r in conn.execute("SELECT substr(publish_date,1,10) d, COUNT(*) n FROM announcements GROUP BY d ORDER BY d DESC LIMIT 12"):
    print("  %s  %d 条" % (r[0], r[1]))
conn.close()
