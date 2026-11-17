# -*- coding: utf-8 -*-
"""慢速重试 8 条被限流(403)的公告：attchList[0].created vs PDF 落款日期。"""
import json
import os
import re
import time
import urllib.request

DETAIL = ("https://mkt.zycg.gov.cn/proxy/platform-service/platform/notice/"
          "queryMallNoticeById?platformId=20&id=%s")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
PDF_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "pdfs")
from pypdf import PdfReader

IDS = [824795, 824796, 824798, 824801, 824805, 824806, 824813, 824815]


def to_date(v):
    if not v:
        return None
    if isinstance(v, (int, float)):
        import datetime
        return datetime.datetime.fromtimestamp(v / 1000).strftime("%Y-%m-%d")
    s = str(v)
    m = re.match(r"(20\d{2})-(\d{2})-(\d{2})", s)
    if m:
        return s[:10]
    m = re.search(r"(20\d{2})年(\d{1,2})月(\d{1,2})日", s)
    if m:
        return "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3)))
    return None


def pdf_official_date(path):
    rd = PdfReader(path)
    text = "\n".join((pg.extract_text() or "") for pg in rd.pages[:4])
    ds = set()
    for m in re.finditer(r"(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", text):
        ds.add("%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3))))
    return sorted(ds)


agree = 0
for i, nid in enumerate(IDS):
    api_date = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(DETAIL % nid, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read().decode("utf-8", "ignore"))
            attch = (d.get("data", d).get("contentObj") or {}).get("attchList") or []
            if attch:
                api_date = to_date(attch[0].get("created"))
            break
        except Exception as e:
            print("  %d 第%d次失败 %s，20s后重试" % (nid, attempt + 1, str(e)[:40]), flush=True)
            time.sleep(20)
    pdf_date = pdf_official_date(os.path.join(PDF_DIR, "%d.pdf" % nid))
    ok = api_date in pdf_date if (api_date and pdf_date) else False
    agree += 1 if ok else 0
    print("%-8s api=%s  pdf=%s  %s" % (nid, api_date, pdf_date, "OK" if ok else "FAIL"), flush=True)
    time.sleep(8)

print("=" * 50)
print("重试结果: %d/8 一致" % agree)
