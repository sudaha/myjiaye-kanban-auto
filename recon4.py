# -*- coding: utf-8 -*-
import json
import urllib.request

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0",
    "Referer": "https://www.zycg.gov.cn/freecms/site/zygjjgzfcgzx/cggg/index.html",
    "X-Requested-With": "XMLHttpRequest",
}
SITE = "6f5243ee-d4d9-4b69-abbd-1e40576ccd7d"
CH_ACTIVE = "d0e7c5f4-b93e-4478-b7fe-61110bb47fd5"
CH_OLD = "bc7fd8d2-d9ec-4d92-9d26-dc7fa22725e6"


def call_list(ch, nt, title=""):
    url = ("https://www.zycg.gov.cn/freecms/rest/v1/notice/selectInfoMore.do?&siteId=%s"
           "&channel=%s&currPage=1&pageSize=15&title=%s&implementWay=&noticeType=%s"
           % (SITE, ch, title, nt))
    raw = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8", "ignore")
    return raw


for label, ch in [("活跃", CH_ACTIVE), ("旧", CH_OLD)]:
    for nt in ["1,2,3,31,32,52,57,61", "2", "57", ""]:
        raw = call_list(ch, nt)
        if len(raw) > 60:
            try:
                d = json.loads(raw)
                rows = d.get("rows") or d.get("list") or d.get("data") or []
                print("[%s channel][nt=%s] len=%d code=%s total=%s rows=%d"
                      % (label, nt, len(raw), d.get("code"), d.get("total"), len(rows)))
                if rows:
                    r0 = rows[0]
                    print("   item keys:", list(r0.keys()))
                    print("   sample:", (r0.get("title") or r0.get("name") or str(r0))[:80])
            except Exception:
                print("[%s channel][nt=%s] 非JSON len=%d head=%s" % (label, nt, len(raw), raw[:80]))
        else:
            print("[%s channel][nt=%s] %s" % (label, nt, raw[:60]))
