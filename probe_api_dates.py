# -*- coding: utf-8 -*-
"""拉取公告详情的原始 JSON，列出所有含时间/日期字段的值，弄清 shortPublistTime 的真实含义。"""
import io
import json
import urllib.request

BASE = "https://mkt.zycg.gov.cn"
DETAIL = BASE + "/proxy/platform-service/platform/notice/queryMallNoticeById?platformId=20&id=%s"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

IDS = [824820, 824817, 824426]  # 11-17 / 11-17 / 11-16


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def walk(obj, path=""):
    """递归找出所有含时间/日期语义的字段。"""
    hits = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = path + "." + k if path else k
            if isinstance(v, (dict, list)):
                hits += walk(v, p)
            else:
                kl = k.lower()
                if any(t in kl for t in ("time", "date", "pub", "gmt", "create", "update",
                                          "start", "end", "bid", "notice")) and v not in (None, "", 0):
                    hits.append((p, v))
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:3]):
            hits += walk(v, "%s[%d]" % (path, i))
    return hits


for nid in IDS:
    print("=" * 70)
    print("公告 id =", nid)
    try:
        d = get_json(DETAIL % nid)
    except Exception as e:
        print("  拉取失败:", e)
        continue
    data = d.get("data", d)
    for p, v in walk(data):
        print("  %-42s = %s" % (p, v))
