# -*- coding: utf-8 -*-
"""交叉验证：接口 contentObj.publishTime（文档落款） vs PDF 全文里印刷的日期。"""
import io
import json
import os
import re
import urllib.request

BASE = "https://mkt.zycg.gov.cn"
DETAIL = BASE + "/proxy/platform-service/platform/notice/queryMallNoticeById?platformId=20&id=%s"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
PDF_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "pdfs")
from pypdf import PdfReader


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def cn_to_iso(s):
    """2026年11月17日 -> 2026-11-17"""
    if not s:
        return None
    m = re.search(r"(20\d{2})年(\d{1,2})月(\d{1,2})日", s)
    if not m:
        return None
    return "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3)))


def pdf_all_dates(path):
    rd = PdfReader(path)
    text = "\n".join((pg.extract_text() or "") for pg in rd.pages)
    found = set()
    for m in re.finditer(r"(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", text):
        found.add("%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3))))
    return found, text


IDS = [824820, 824817, 824426, 824819, 824815, 824801]
print("id      接口落款      PDF印刷日期集合                          一致?")
print("-" * 80)
agree = disagree = nopdf = 0
for nid in IDS:
    try:
        d = get_json(DETAIL % nid)
    except Exception as e:
        print(nid, "接口失败", e)
        continue
    doc_date = cn_to_iso(d.get("data", d).get("contentObj", {}).get("publishTime"))
    p = os.path.join(PDF_DIR, "%d.pdf" % nid)
    if not os.path.isfile(p):
        print("%-8s %-12s (无本地PDF)" % (nid, doc_date))
        nopdf += 1
        continue
    dates, text = pdf_all_dates(p)
    ok = (doc_date in dates) if doc_date else None
    mark = "✓" if ok else ("?" if not doc_date else "✗")
    if ok:
        agree += 1
    elif ok is False:
        disagree += 1
    print("%-8s %-12s %-34s %s" % (nid, doc_date, sorted(dates), mark))
    if not ok:
        # 找含"日"的行帮助人工判断
        for line in text.splitlines():
            if ("月" in line and "日" in line) or re.search(r"20\d{2}", line):
                print("        | " + line.strip()[:60])

print("-" * 80)
print("一致 %d / 不一致 %d / 无PDF %d" % (agree, disagree, nopdf))
