# -*- coding: utf-8 -*-
"""按浏览器真实顺序：index.html -> userInfo(建会话) -> selectInfoMore。"""
import http.cookiejar
import json
import time
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0"}
BASE = "https://www.zycg.gov.cn"
REF = BASE + "/freecms/site/zygjjgzfcgzx/cggg/index.html"

for attempt in range(3):
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

    def get(url, referer=REF, timeout=30):
        h = dict(UA)
        if referer:
            h["Referer"] = referer
        return op.open(urllib.request.Request(url, headers=h), timeout=timeout).read().decode("utf-8", "ignore")

    get(REF)  # 1) 页面
    time.sleep(0.5)
    ui = get(BASE + "/gateway/gp-auth-center/rest/v1/user/userInfo")  # 2) 建会话
    print("尝试%d userInfo: %s cookies=%s" % (attempt + 1, ui[:60].replace("\n", " "), [c.name for c in cj]))
    time.sleep(0.5)
    api = (BASE + "/freecms/rest/v1/notice/selectInfoMore.do?&siteId="
           "6f5243ee-d4d9-4b69-abbd-1e40576ccd7d&channel=d0e7c5f4-b93e-4478-b7fe-61110bb47fd5"
           "&currPage=1&pageSize=50&title=&implementWay=1&noticeType=1,2,3,31,32,52,57,61")
    raw = get(api)
    d = json.loads(raw) if raw.startswith("{") else {}
    ok = d.get("code") == "200"
    print("尝试%d API: code=%s total=%s rows=%d" % (attempt + 1, d.get("code"), d.get("total"), len(d.get("data") or [])))
    if ok:
        for it in (d.get("data") or [])[:3]:
            print("   -", it["addtimeStr"], it["title"][:50])
        break
    time.sleep(2)
