# -*- coding: utf-8 -*-
"""给 announcements 表补 pub_date（平台上架日期 shortPublistTime）。
publish_date 现在是 PDF 落款发标日；上架日期被覆盖前没存，需要回补：
1) 列表接口一次拿全最近 14 天条目的 shortPublistTime；
2) 更老的条目逐条调详情接口回补（限流：每 40 条停 60s，3 次重试）。
"""
import os
import sqlite3
import time

import db as dbmod
import fetcher as fz

HERE = os.path.dirname(os.path.abspath(__file__))
DBF = os.path.join(HERE, "data", "board.db")

conn = sqlite3.connect(DBF)
conn.row_factory = sqlite3.Row
cols = [c[1] for c in conn.execute("PRAGMA table_info(announcements)").fetchall()]
if "pub_date" not in cols:
    conn.execute("ALTER TABLE announcements ADD COLUMN pub_date TEXT")
    conn.commit()
    print("已添加 pub_date 列")

ids = [r[0] for r in conn.execute("SELECT id FROM announcements").fetchall()]
print("库内共 %d 条" % len(ids))

# 1) 列表接口（最近窗口一次取全）
filled = 0
try:
    rows = fz.list_page(0, 1, page_size=500)
    for r in rows:
        rid = int(r.get("id") or 0)
        st = (r.get("shortPublistTime") or "")[:10]
        if rid and st:
            cur = conn.execute("UPDATE announcements SET pub_date=? WHERE id=?", (st, rid))
            filled += cur.rowcount
    conn.commit()
    print("列表回补 %d 条" % filled)
except Exception as e:
    print("列表接口失败: %s" % e)

# 2) 详情接口回补缺失的
todo = [r[0] for r in conn.execute(
    "SELECT id FROM announcements WHERE pub_date IS NULL OR pub_date=''").fetchall()]
print("待详情回补 %d 条" % len(todo))
ok = fail = 0
for i, nid in enumerate(todo):
    if i and i % 40 == 0:
        time.sleep(60)
    try:
        # 直接用 detail API 的 data.shortPublistTime（不能用 fetch_detail，它优先返回 PDF 落款日）
        raw = fz.http_get_json(fz.DETAIL_URL.format(nid=nid))
        data = raw.get("data") or {}
        obj = data.get("contentObj") or {}
        st = (data.get("shortPublistTime") or obj.get("shortPublistTime") or "")[:10]
        if st:
            conn.execute("UPDATE announcements SET pub_date=? WHERE id=?", (st, nid))
            conn.commit()
            ok += 1
        else:
            fail += 1
            print("  [warn] %s 无上架日期" % nid)
    except Exception as e:
        fail += 1
        print("  [warn] detail %s: %s" % (nid, str(e)[:60]))
    time.sleep(1.2)
print("详情回补 完成 %d / 失败 %d" % (ok, fail))
conn.close()
