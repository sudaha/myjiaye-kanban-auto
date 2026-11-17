# -*- coding: utf-8 -*-
"""分析 ccgp 第一页：总数、翻页结构、条目解析验证。"""
import re

pg = open("ccgp_page1.html", encoding="utf-8", errors="ignore").read()
seg = re.sub(r"\s+", " ", pg)

i = seg.find("共")
print("总数区:", seg[max(0, i - 60):i + 80] if i > 0 else "未找到 共")

j = seg.find("下一页")
print("翻页区:", seg[max(0, j - 250):j + 50] if j > 0 else "无下一页文字")

# 条目解析验证
items = re.findall(
    r'<li>\s*<a href="(http[^"]+)"[^>]*>\s*([^<]{5,120}?)\s*</a>.*?'
    r'(\d{4}\.\d{1,2}\.\d{1,2} \d{2}:\d{2}(?::\d{2})?)\s*\|\s*采购人：([^|<]+)\|([^|<]*)<br/>\s*'
    r'<strong[^>]*>([^<]+)</strong>\s*\|\s*([^|<]+)\|\s*<strong[^>]*>([^<]+)</strong>',
    pg, re.S)
print()
print("解析到条目:", len(items))
for u, t, dt, buyer, ag, typ, region, cat in items[:6]:
    print("-", dt, "|", buyer.strip()[:20], "|", typ.strip(), "|", region.strip(), "|", t.strip()[:40])
    print("   ", u)
