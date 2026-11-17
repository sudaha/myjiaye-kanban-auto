# -*- coding: utf-8 -*-
import sqlite3
import os

conn = sqlite3.connect(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "board.db"))
print("上架日期分布:")
for r in conn.execute("SELECT substr(pub_date,1,10) d, COUNT(*) n FROM announcements GROUP BY d ORDER BY d DESC LIMIT 15"):
    print("  %s  %d 条" % (r[0], r[1]))
null_n = conn.execute("SELECT COUNT(*) FROM announcements WHERE pub_date IS NULL OR pub_date=''").fetchone()[0]
print("缺失 pub_date:", null_n)
conn.close()
