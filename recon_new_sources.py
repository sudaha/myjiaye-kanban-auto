# -*- coding: utf-8 -*-
"""侦察两个新数据源的列表接口：
1) 央采主站 www.zycg.gov.cn freecms 采购公告（招标/磋商/询价公告）
2) 中国政府采购网 search.ccgp.gov.cn（中央+地方公告）
"""
import io
import json
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
print("[1] 央采主站 采购公告列表页")
pg = get("https://www.zycg.gov.cn/freecms/site/zygjjgzfcgzx/cggg/index.html")
print("页面长度:", len(pg))
# 找 JS 里的 ajax 地址
for m in sorted(set(re.findall(r"['\"]([^'\"]*(?:json|ajax|api|list|query|page)[^'\"]*)['\"]", pg))):
    if "css" not in m.lower() and "img" not in m.lower():
        print("  JS候选:", m[:100])
# 找列表项链接
infos = re.findall(r"href=\"([^\"]*/info/[^\"]+)\"", pg)
print("  info链接数:", len(infos), infos[:3])
# 找内嵌列表数据（有些 freecms 直接服务端渲染）
titles = re.findall(r"<a[^>]*>([^<]{8,60})</a>", pg)
print("  标题抽样:", [t.strip()[:30] for t in titles[:6]])

print()
print("=" * 70)
print("[2] ccgp 中国政府采购网 bxsearch 公告列表")
# bidType: 1=招标公告(中央), 2=中标公告, 5=询价, 100=地方?  先试 1 与 100
for bt, name in [(1, "中央招标"), (100, "地方公告")]:
    url = ("http://search.ccgp.gov.cn/bxsearch?searchtype=1&bidType=%d&kw=&"
           "start_time=2026:11:10&end_time=2026:11:17&timeType=6&buyerRegion=&pinMu=0&dlbid=" % bt)
    try:
        pg = get(url, timeout=30)
        n = len(re.findall(r"vT-srch-result-list", pg)) + pg.count("listm")
        items = re.findall(r"<a[^>]*href=\"([^\"]+)\"[^>]*>([^<]{10,70})</a>", pg)
        date_hits = re.findall(r"(\d{4}[-/]\d{1,2}[-/]\d{1,2})", pg)
        print("[%s] bidType=%d len=%d 链接数=%d 日期样本=%s" % (name, bt, len(pg), len(items), date_hits[:4]))
        for u, t in items[:4]:
            print("    ", t.strip()[:45], "->", u[:80])
    except Exception as e:
        print("[%s] bidType=%d 失败: %s" % (name, bt, str(e)[:80]))
