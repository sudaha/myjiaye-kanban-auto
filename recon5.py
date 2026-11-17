# -*- coding: utf-8 -*-
"""确认央采主站 API 纯 Python 可用 + 详情页字段。"""
import json
import re
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0"}
BASE = "https://www.zycg.gov.cn"
API = (BASE + "/freecms/rest/v1/notice/selectInfoMore.do?&siteId=6f5243ee-d4d9-4b69-abbd-1e40576ccd7d"
       "&channel=d0e7c5f4-b93e-4478-b7fe-61110bb47fd5&currPage=%d&pageSize=%d&title="
       "&implementWay=1&noticeType=1,2,3,31,32,52,57,61")


def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


d = json.loads(get(API % (1, 50)))
print("code=", d.get("code"), "total=", d.get("total"), "本页=", len(d.get("data", [])))
items = d["data"]
print("字段:", list(items[0].keys()))
for it in items[:3]:
    print("-", it["addtimeStr"], it["title"][:50])

# 详情页结构
it = items[0]
url = it["pageurl"] if it["pageurl"].startswith("http") else BASE + it["pageurl"]
pg = get(url)
print()
print("详情长度:", len(pg))
body = re.search(r"(.*?)(<script|<footer|版权)", pg, re.S)
text = re.sub(r"<[^>]+>", " ", body.group(1) if body else pg)
text = re.sub(r"\s+", " ", text)
# 抓关键字段
for kw in ["采购人", "采购预算", "预算金额", "最高限价", "公告期限", "项目名称", "采购内容", "响应文件", "递交"]:
    i = text.find(kw)
    if i >= 0:
        print("  [%s] %s" % (kw, text[i:i + 90]))
