# -*- coding: utf-8 -*-
"""模拟页面完整初始化流程：index.html -> 子请求 -> 拿 cookie -> 调 API。"""
import http.cookiejar
import json
import re
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0"}
BASE = "https://www.zycg.gov.cn"

cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def get(url, referer=None, timeout=30):
    h = dict(UA)
    if referer:
        h["Referer"] = referer
    r = op.open(urllib.request.Request(url, headers=h), timeout=timeout)
    return r.read().decode("utf-8", "ignore")


page = get(BASE + "/freecms/site/zygjjgzfcgzx/cggg/index.html")
print("step1 页面加载后 cookies:", [c.name for c in cj])

# 找页面里引用的其他 API/子请求
refs = sorted(set(re.findall(r"['\"](/(?:gateway|freecms/rest)[^'\"]+)['\"]", page)))
print("页面引用的 gateway/rest 端点:")
for u in refs:
    print("  ", u)
for u in refs:
    try:
        body = get(BASE + u, referer=BASE + "/freecms/site/zygjjgzfcgzx/cggg/index.html")
        print("  GET", u[:60], "->", body[:80].replace("\n", " "))
    except Exception as e:
        print("  GET", u[:60], "-> ERR", str(e)[:50])
    if cj:
        names = [c.name for c in cj]
        if names != ["__wpkreporterwid_"]:
            print("   >>> cookies 变为:", names)

api = ("BASE/freecms/rest/v1/notice/selectInfoMore.do?&siteId="
       "6f5243ee-d4d9-4b69-abbd-1e40576ccd7d&channel=d0e7c5f4-b93e-4478-b7fe-61110bb47fd5"
       "&currPage=1&pageSize=20&title=&implementWay=1&noticeType=1,2,3,31,32,52,57,61").replace("BASE", BASE)
raw = get(api, referer=BASE + "/freecms/site/zygjjgzfcgzx/cggg/index.html")
print()
print("最终 API:", raw[:150])
print("所有 cookies:", [(c.name, c.value[:20]) for c in cj])
