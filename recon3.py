# -*- coding: utf-8 -*-
import re
pg = open("cggg_page.html", encoding="utf-8").read()
for m in re.finditer(r"(siteId|channel|implementWay|noticeType)\s*=\s*['\"]?([^'\n\r;]{1,60})", pg):
    s = m.group(1)
    if s in ("implementWay", "noticeType") and m.group(2).strip() in ("", "''", '""'):
        continue
    ctx = pg[max(0, m.start() - 100):m.start()].replace("\n", " ")[-80:]
    print("%-12s = %s" % (s, m.group(2).strip()))
    print("   ctx:", ctx)
