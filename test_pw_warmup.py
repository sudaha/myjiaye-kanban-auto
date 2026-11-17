# -*- coding: utf-8 -*-
"""受控实验：同一 playwright(chrome) 上下文里，API 连续调用是否"预热后"才通过。"""
import json
from playwright.sync_api import sync_playwright

PAGE = "https://www.zycg.gov.cn/freecms/site/zygjjgzfcgzx/cggg/index.html"
API = ("https://www.zycg.gov.cn/freecms/rest/v1/notice/selectInfoMore.do?&siteId="
       "6f5243ee-d4d9-4b69-abbd-1e40576ccd7d&channel=d0e7c5f4-b93e-4478-b7fe-61110bb47fd5"
       "&currPage=1&pageSize=10&title=&implementWay=1&noticeType=1,2,3,31,32,52,57,61")

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=False)
    ctx = browser.new_context()
    page = ctx.new_page()
    print("打开页面…")
    page.goto(PAGE, timeout=60000)
    page.wait_for_timeout(8000)  # 给 WAF JS 充足时间
    print("cookies after load:", [c["name"] for c in ctx.cookies()])

    for i in range(5):
        raw = page.evaluate(
            "(url) => fetch(url, {headers:{'X-Requested-With':'XMLHttpRequest'}})"
            ".then(r=>r.text())", API)
        try:
            d = json.loads(raw)
            print("调用%d: code=%s total=%s" % (i + 1, d.get("code"), d.get("total")))
            if d.get("code") == "200":
                print("  >>> 第%d次调用通过！" % (i + 1))
                break
        except Exception:
            print("调用%d: 非JSON %s" % (i + 1, raw[:60]))
        print("cookies now:", [c["name"] for c in ctx.cookies()])
        page.wait_for_timeout(5000)
    browser.close()
