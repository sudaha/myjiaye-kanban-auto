# -*- coding: utf-8 -*-
import re

pg = open("ccgp_page1.html", encoding="utf-8", errors="ignore").read()
opts = re.findall(r'value="([^"]{1,20})"[^>]*>([^<]{2,30})</option>', pg)
print("options total:", len(opts))
for v, t in opts:
    t = t.strip()
    if t and any(k in t for k in ["计算机", "软件", "网络", "终端", "信息化", "货物"]):
        print(" ", v, "=", t)
