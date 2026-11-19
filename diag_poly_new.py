# -*- coding: utf-8 -*-
import io
import json
import os
from collections import Counter

BASE = os.path.dirname(os.path.abspath(__file__))
d = json.load(io.open(os.path.join(BASE, "data", "poly_items.json"), encoding="utf-8"))
items = d.get("items") or d.get("projects") or []
print("polo 条目数:", len(items), " 顶层键:", list(d.keys())[:8] if isinstance(d, dict) else type(d))
if items:
    print("样本键:", list(items[0].keys())[:20])
    c = Counter((it.get("publish_date") or "")[:10] for it in items)
    for day, n in sorted(c.items(), reverse=True)[:8]:
        print("  %s  %d 条" % (day, n))
