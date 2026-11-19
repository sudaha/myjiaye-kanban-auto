# -*- coding: utf-8 -*-
"""抓取机型库涉及的全部成交公告正文，供看板站内弹层展示（规避 WAF 403）。

背景：选型助手「查看原始成交公告」原来直接跳转 mkt.zycg.gov.cn 详情页，
央采 WAF 对带外部 Referer（kanban.myjiaye.top）的请求返回 403，用户点不开。
本脚本在服务端把公告正文拉下来缓存为 data/mall_notices.json，前端站内渲染。

接口（免登录，与 mall_fetcher.py 一致）：
  GET https://mkt.zycg.gov.cn/proxy/platform-service/platform/notice/queryMallNoticeById?platformId=20&id=<id>

用法：
  python fetch_mall_notices.py           # 抓全部 products.json 里引用的 notice id（增量合并）
  python fetch_mall_notices.py --limit N # 只处理前 N 个缺失 id（快速验证）
"""
import argparse
import datetime
import io
import json
import os
import re
import time
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
PRODUCTS = os.path.join(DATA, "products.json")
OUT = os.path.join(DATA, "mall_notices.json")

API = "https://mkt.zycg.gov.cn/proxy/platform-service/platform/notice"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
STYLE_RE = re.compile(r"<style.*?</style>", re.S | re.I)


def http_json(url, timeout=40):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://mkt.zycg.gov.cn/mall-view/",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def fetch_detail(nid):
    url = "%s/queryMallNoticeById?platformId=20&id=%s" % (API, nid)
    d = http_json(url).get("data") or {}
    content = STYLE_RE.sub("", d.get("contentStr") or "", count=1).strip()
    return {
        "title": d.get("noticeTitle") or "",
        "date": d.get("publishTimeStr") or "",
        "code": d.get("identifyingCode") or "",
        "content": content,
        "official": "https://mkt.zycg.gov.cn/mall-view/information/detail?noticeId=%s" % nid,
        "pdf_url": (d.get("pdfUrl") or "").lstrip("/"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    products = json.load(io.open(PRODUCTS, encoding="utf-8"))
    ids = set()
    for p in products.get("products", []):
        for nid in (p.get("notice_ids") or []):
            ids.add(str(nid))
    ids = sorted(ids)
    print("products.json 引用公告 %d 个" % len(ids))

    notices = {}
    if os.path.isfile(OUT):
        old = json.load(io.open(OUT, encoding="utf-8"))
        notices = old.get("notices") or {}
    todo = [i for i in ids if i not in notices]
    if args.limit:
        todo = todo[:args.limit]
    print("已缓存 %d，待抓 %d" % (len(notices), len(todo)))

    ok = fail = 0
    for n, nid in enumerate(todo, 1):
        for attempt in (1, 2):
            try:
                notices[nid] = fetch_detail(nid)
                ok += 1
                break
            except Exception as e:
                if attempt == 2:
                    fail += 1
                    print("  [FAIL] %s -> %r" % (nid, e))
                else:
                    time.sleep(1.0)
        if n % 25 == 0:
            print("  进度 %d/%d 成功 %d 失败 %d" % (n, len(todo), ok, fail))
        time.sleep(0.1)

    payload = {
        "updated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(notices),
        "notices": notices,
    }
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print("-" * 50)
    print("本轮成功 %d 失败 %d，总缓存 %d 个公告" % (ok, fail, len(notices)))
    print("已写入 %s（%.1f MB）" % (OUT, os.path.getsize(OUT) / 1048576.0))
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
