# -*- coding: utf-8 -*-
"""决定性测试：headless chromium 能否通过央采主站 API 的 TLS 防护。"""
import json
from playwright.sync_api import sync_playwright

PAGE = "https://www.zycg.gov.cn/freecms/site/zygjjgzfcgzx/cggg/index.html"
API = ("https://www.zycg.gov.cn/freecms/rest/v1/notice/selectInfoMore.do?&siteId="
       "6f5243ee-d4d9-4b69-abbd-1e40576ccd7d&channel=d0e7c5f4-b93e-4478-b7fe-61110bb47fd5"
       "&currPage=1&pageSize=50&title=&implementWay=1&noticeType=1,2,3,31,32,52,57,61")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                                          "Chrome/120.0.0.0 Safari/537.36"))
    page = ctx.new_page()
    page.goto(PAGE, timeout=60000)
    page.wait_for_timeout(3000)
    raw = page.evaluate(
        "(url) => fetch(url, {headers:{'X-Requested-With':'XMLHttpRequest'}})"
        ".then(r=>r.text())", API)
    d = json.loads(raw)
    print("code=", d.get("code"), "total=", d.get("total"), "rows=", len(d.get("data") or []))
    for it in (d.get("data") or [])[:5]:
        print("-", it["addtimeStr"], it["title"][:55])
    browser.close()
