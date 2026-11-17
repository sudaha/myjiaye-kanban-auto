# -*- coding: utf-8 -*-
import json
from playwright.sync_api import sync_playwright

PAGE = "https://www.zycg.gov.cn/freecms/site/zygjjgzfcgzx/cggg/index.html"
API = ("https://www.zycg.gov.cn/freecms/rest/v1/notice/selectInfoMore.do?&siteId="
       "6f5243ee-d4d9-4b69-abbd-1e40576ccd7d&channel=d0e7c5f4-b93e-4478-b7fe-61110bb47fd5"
       "&currPage=1&pageSize=10&title=&implementWay=1&noticeType=1,2,3,31,32,52,57,61")

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    pg = b.new_page()
    pg.goto(PAGE, timeout=60000)
    pg.wait_for_timeout(8000)
    raw = pg.evaluate(
        "(u) => fetch(u, {headers:{'X-Requested-With':'XMLHttpRequest'}}).then(r=>r.text())",
        API)
    d = json.loads(raw)
    print("headless+8s -> code=%s total=%s" % (d.get("code"), d.get("total")))
    b.close()
