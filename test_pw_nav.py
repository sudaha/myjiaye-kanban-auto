# -*- coding: utf-8 -*-
"""实验：page.goto 直接导航 API URL（而非 XHR fetch），连测 3 页看 WAF 是否放行。"""
import json
import re
from playwright.sync_api import sync_playwright

PAGE = "https://www.zycg.gov.cn/freecms/site/zygjjgzfcgzx/cggg/index.html"
API = ("https://www.zycg.gov.cn/freecms/rest/v1/notice/selectInfoMore.do?&siteId="
       "6f5243ee-d4d9-4b69-abbd-1e40576ccd7d&channel=d0e7c5f4-b93e-4478-b7fe-61110bb47fd5"
       "&currPage=%d&pageSize=50&title=&implementWay=1&noticeType=1,2,3,31,32,52,57,61")

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    pg = b.new_context().new_page()
    pg.goto(PAGE, timeout=60000)
    pg.wait_for_timeout(8000)
    for n in (1, 2, 3):
        pg.goto(API % n, timeout=60000)
        pg.wait_for_timeout(3000)
        text = pg.text_content("body") or ""
        m = re.search(r"code[\"':\s]+([0-9-]+)", text[:200])
        total = re.search(r"total[\"':\s]+(\d+)", text[:400])
        print("page%d via goto -> %s bytes, code=%s total=%s"
              % (n, len(text), m.group(1) if m else "?", total.group(1) if total else "?"))
        if m and m.group(1) != "200":
            break
        pg.wait_for_timeout(5000)
    b.close()
