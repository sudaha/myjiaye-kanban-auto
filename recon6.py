# -*- coding: utf-8 -*-
"""用 tls-client（Chrome 指纹）测试央采主站 API。"""
import json

import tls_client

c = tls_client.Session(client_identifier="chrome_124")
url = ("https://www.zycg.gov.cn/freecms/rest/v1/notice/selectInfoMore.do?&siteId="
       "6f5243ee-d4d9-4b69-abbd-1e40576ccd7d&channel=d0e7c5f4-b93e-4478-b7fe-61110bb47fd5"
       "&currPage=1&pageSize=50&title=&implementWay=1&noticeType=1,2,3,31,32,52,57,61")
r = c.get(url, headers={"Accept": "application/json, text/javascript, */*; q=0.01",
                        "Referer": "https://www.zycg.gov.cn/freecms/site/zygjjgzfcgzx/cggg/index.html"})
body = r.text
print("status:", r.status_code, "len:", len(body))
try:
    d = json.loads(body)
    print("code:", d.get("code"), "total:", d.get("total"), "rows:", len(d.get("data", [])))
    for it in d.get("data", [])[:3]:
        print("-", it["addtimeStr"], it["title"][:50])
except Exception:
    print("head:", body[:200])
