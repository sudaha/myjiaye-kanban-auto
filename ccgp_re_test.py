# -*- coding: utf-8 -*-
"""离线验证新 ITEM_RE 对保存的关键词结果页的解析。"""
import io
import re

html = io.open("ccgp_kw_1.html", encoding="utf-8", errors="ignore").read()

ITEM_RE = re.compile(
    r'<a href="(http://www\.ccgp\.gov\.cn/cggg/[^"]+)"[^>]*>(.*?)</a>'
    r'.*?<span>(\d{4}\.\d{1,2}\.\d{1,2} \d{2}:\d{2}(?::\d{2})?)\s*\|\s*采购人：([^|]+?)\s*\|\s*代理机构：([^|]*?)\s*<br/>\s*'
    r'<strong[^>]*>\s*([^<]*?)\s*</strong>\s*\|\s*([^|<]*?)\s*\|\s*<strong[^>]*>\s*([^<]*?)\s*</strong>',
    re.S)

items = ITEM_RE.findall(html)
print("解析出 %d 条（页面应有 20）" % len(items))
for u, t, d, buyer, ag, typ, region, cat in items[:5]:
    t = re.sub(r"<[^>]+>", "", t).strip()
    print(" %s | %s | %s | %s | %s | %s | %s"
          % (d, t[:38], buyer.strip(), ag.strip(), typ.strip(), region.strip(), cat.strip()))
    print("   " + u)
