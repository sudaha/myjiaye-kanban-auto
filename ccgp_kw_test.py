# -*- coding: utf-8 -*-
"""测 ccgp 关键词检索量级：7 天窗口，各 IT 关键词各有多少结果。"""
import re
import time
import urllib.parse
import urllib.request

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
}


def search(kw):
    url = ("http://search.ccgp.gov.cn/bxsearch?searchtype=1&bidType=1&kw=%s&"
           "start_time=2026:11:10&end_time=2026:11:17&timeType=6&buyerRegion=&pinMu=0&dlbid="
           % urllib.parse.quote(kw))
    pg = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read().decode("utf-8", "ignore")
    if "频繁" in pg:
        return None
    m = re.search(r"共找到\s*(\d+)\s*条", re.sub(r"<[^>]+>", "", pg))
    return int(m.group(1)) if m else -1


for kw in ["服务器", "台式", "笔记本", "计算机", "工作站", "一体机", "交换机", "存储", "GPU"]:
    n = search(kw)
    print("%-6s %s" % (kw, n))
    time.sleep(12)
