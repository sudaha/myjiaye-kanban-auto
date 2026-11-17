# -*- coding: utf-8 -*-
"""抓一页带关键词的 ccgp 结果，dump 结构用于校准正则/参数。只发 1 个请求。"""
import io
import urllib.parse
import urllib.request

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

def fetch(kw, searchtype=1, st="2026:11:10", et="2026:11:17"):
    url = ("http://search.ccgp.gov.cn/bxsearch?searchtype=%d&bidType=1&kw=%s&"
           "start_time=%s&end_time=%s&timeType=6&buyerRegion=&pinMu=0&dlbid=&p=0"
           % (searchtype, urllib.parse.quote(kw), st, et))
    req = urllib.request.Request(url, headers=UA)
    html = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "ignore")
    return html

import time

for kw, st_ in [("服务器", 1), ("服务器", 2)]:
    if st_ > 1:
        time.sleep(45)
    html = fetch(kw, st_)
    with io.open("ccgp_kw_%d.html" % st_, "w", encoding="utf-8") as f:
        f.write(html)
    print("kw=服务器 searchtype=%d -> %d bytes, 含'频繁'=%s, 含zycg结果区=%s"
          % (st_, len(html), "频繁" in html, "vT-srchResult" in html or "searchList" in html))
    import re
    # 找所有 <li> 数量与第一个 li 样本
    lis = re.findall(r"<li[^>]*>.*?</li>", html, re.S)
    print("  li 数量: %d" % len(lis))
    for x in lis[:2]:
        print("  样本:", x[:300].replace("\n", " "))
    m = re.search(r"共(\d+)条", html)
    print("  总数文本:", m.group(0) if m else "未找到")
