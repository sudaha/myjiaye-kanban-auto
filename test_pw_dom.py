# -*- coding: utf-8 -*-
"""实验：读列表页渲染后的 DOM（页面自身 JS 调 API），不自己发 API 请求。"""
from playwright.sync_api import sync_playwright

PAGE = "https://www.zycg.gov.cn/freecms/site/zygjjgzfcgzx/cggg/index.html"

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    pg = b.new_context().new_page()
    pg.goto(PAGE, timeout=60000)
    pg.wait_for_timeout(15000)
    body = pg.content()
    print("DOM 长度:", len(body))
    # 找公告列表区
    for sel in (".news-list", ".list li", "ul li a", ".con a", ".list a", "a[href*='/freecms/site/zygjjgzfcgzx/cggg/']"):
        try:
            n = pg.locator(sel).count()
        except Exception:
            n = "?"
        print("选择器 %-40s -> %s 个" % (sel, n))
    # 抓前 8 个可能的公告链接样本
    links = pg.eval_on_selector_all(
        "a[href*='cggg']", "els => els.slice(0,8).map(e => e.href + ' | ' + (e.innerText||'').trim().slice(0,50))")
    for l in links:
        print("-", l.replace("\n", " "))
    # 找翻页控件
    pagers = pg.eval_on_selector_all(
        "a,li,button", "els => els.filter(e => /下一页|下页|next|›|»/.test(e.innerText||'')).slice(0,6).map(e => e.tagName + ' ' + (e.className||'') + ' | ' + (e.innerText||'').trim())")
    print("翻页控件样本:")
    for x in pagers:
        print(" *", x)
    b.close()
