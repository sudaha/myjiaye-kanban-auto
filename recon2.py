# -*- coding: utf-8 -*-
"""第二轮侦察：挖出央采主站 ajax 完整参数 + ccgp 返回内容。"""
import io
import re
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")


def get(url, referer=None, timeout=30):
    h = {"User-Agent": UA}
    if referer:
        h["Referer"] = referer
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


print("=" * 70)
print("[1] 央采主站 $.ajax 完整调用")
pg = get("https://www.zycg.gov.cn/freecms/site/zygjjgzfcgzx/cggg/index.html")
for m in re.finditer(r"\$\.ajax\(\{[^}]{0,600}?\}\)", pg, re.S):
    blk = m.group(0).replace("\n", " ")[:500]
    print("---")
    print(blk)

print()
print("=" * 70)
print("[2] ccgp 返回的 2723 字节内容")
ccgp = get("http://search.ccgp.gov.cn/bxsearch?searchtype=1&bidType=1&kw=&start_time=2026:11:10&end_time=2026:11:17&timeType=6&buyerRegion=&pinMu=0&dlbid=")
print(ccgp[:1500])
