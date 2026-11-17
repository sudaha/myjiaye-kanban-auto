# -*- coding: utf-8 -*-
"""慢速单请求测试 ccgp 限流是否解除。"""
import re
import urllib.request

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
}
url = ("http://search.ccgp.gov.cn/bxsearch?searchtype=1&bidType=1&kw=&"
       "start_time=2026:11:10&end_time=2026:11:17&timeType=6&buyerRegion=&pinMu=0&dlbid=")
pg = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read().decode("utf-8", "ignore")
print("len=", len(pg))
if "频繁" in pg:
    print("仍被限流")
else:
    items = re.findall(r'<a[^>]*href="([^"]+)"[^>]*title="([^"]+)"', pg)
    dates = re.findall(r"(\d{4}[-/]\d{1,2}[-/]\d{1,2})", pg)
    total = re.search(r"共\s*(\d+)\s*条|total[^0-9]*(\d+)", pg)
    print("链接数=", len(items), "日期样本=", dates[:4], "总数=", total.groups() if total else None)
    for u, t in items[:5]:
        print("-", t[:50], "->", u[:70])
    # 保存第一页 HTML 供解析
    open("ccgp_page1.html", "w", encoding="utf-8").write(pg)
    print("已存 ccgp_page1.html")
