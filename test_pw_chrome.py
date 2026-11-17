# -*- coding: utf-8 -*-
"""用真实 Chrome（channel=chrome）测试央采主站 API。headless 失败则试可见模式。"""
import json
from playwright.sync_api import sync_playwright

PAGE = "https://www.zycg.gov.cn/freecms/site/zygjjgzfcgzx/cggg/index.html"
API = ("https://www.zycg.gov.cn/freecms/rest/v1/notice/selectInfoMore.do?&siteId="
       "6f5243ee-d4d9-4b69-abbd-1e40576ccd7d&channel=d0e7c5f4-b93e-4478-b7fe-61110bb47fd5"
       "&currPage=1&pageSize=50&title=&implementWay=1&noticeType=1,2,3,31,32,52,57,61")


def try_mode(headless):
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=headless)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(PAGE, timeout=60000)
        page.wait_for_timeout(3000)
        raw = page.evaluate(
            "(url) => fetch(url, {headers:{'X-Requested-With':'XMLHttpRequest'}})"
            ".then(r=>r.text())", API)
        d = json.loads(raw)
        ok = d.get("code") == "200"
        print("headless=%s -> code=%s total=%s rows=%d"
              % (headless, d.get("code"), d.get("total"), len(d.get("data") or [])))
        if ok:
            for it in (d.get("data") or [])[:3]:
                print("  -", it["addtimeStr"], it["title"][:55])
        browser.close()
        return ok


try_mode(True) or try_mode(False)
