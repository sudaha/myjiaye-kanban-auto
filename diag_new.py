# -*- coding: utf-8 -*-
import io
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
d = json.load(io.open(os.path.join(BASE, "dist", "data", "zycg", "list.json"), encoding="utf-8"))
new = [it for it in d["items"] if it.get("is_new")]
print("总数 %d, 标记新 %d" % (d["total"], len(new)))
for it in new[:30]:
    print("  NEW %s  %s" % ((it.get("pub_date") or "")[:10], it["title"][:40]))
s = json.load(io.open(os.path.join(BASE, "dist", "data", "zycg", "status.json"), encoding="utf-8"))
print("status: new_count=%s new_days=%s" % (s.get("new_count"), s.get("new_days")))
bl = json.load(io.open(os.path.join(BASE, "data", "last_seen_zycg.json"), encoding="utf-8"))
print("基线: at=%s ids=%d" % (bl["at"], len(bl["ids"])))
