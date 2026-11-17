# -*- coding: utf-8 -*-
"""参数扫描：找出央采主站 API 到底校验什么。"""
import json
import time

import tls_client

URL = ("https://www.zycg.gov.cn/freecms/rest/v1/notice/selectInfoMore.do?&siteId="
       "6f5243ee-d4d9-4b69-abbd-1e40576ccd7d&channel=d0e7c5f4-b93e-4478-b7fe-61110bb47fd5"
       "&currPage=1&pageSize=50&title=&implementWay=1&noticeType=1,2,3,31,32,52,57,61")

BROWSER_HEADERS = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://www.zycg.gov.cn/freecms/site/zygjjgzfcgzx/cggg/index.html",
    "sec-ch-ua": '"Chromium";v="120", "Not_A Brand";v="8", "Google Chrome";v="120"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}


def try_case(label, profile, headers, cookies, h2=True):
    try:
        s = tls_client.Session(client_identifier=profile)
        r = s.get(URL, headers=headers, cookies=cookies or {})
        ok = r.status_code == 200 and '"total"' in r.text
        print("%-42s -> %s len=%d %s" % (label, r.status_code, len(r.text), "OK!" if ok else r.text[:40]))
        return ok
    except Exception as e:
        print("%-42s -> ERR %s" % (label, str(e)[:60]))
        return False


# 1) 不同 impersonate
for p in ["chrome_120", "chrome_124", "chrome_131", "safari_17_0", "firefox_133"]:
    if try_case("impersonate=%s" % p, p, BROWSER_HEADERS, {}):
        break
    time.sleep(2)

# 2) 带 wpk cookie
time.sleep(2)
try_case("chrome_124 + wpk cookie", "chrome_124", BROWSER_HEADERS,
         {"__wpkreporterwid_": "a6215320-5db7-4811-3c40-22871d1b4786"})
