# -*- coding: utf-8 -*-
"""全量验证：接口 attchList[0].created（PDF生成时间） vs PDF 印刷落款日期。
逐条比对，并检查每条的附件数量，确保 attchList[0] 就是询价通知书。"""
import json
import os
import re
import sqlite3
import time
import urllib.request

BASE = "https://mkt.zycg.gov.cn"
DETAIL = BASE + "/proxy/platform-service/platform/notice/queryMallNoticeById?platformId=20&id=%s"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
ROOT = os.path.dirname(os.path.abspath(__file__))
PDF_DIR = os.path.join(ROOT, "data", "pdfs")
from pypdf import PdfReader


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def to_date(v):
    """把 epoch毫秒 / 'YYYY-MM-DD HH:MM:SS' / 'YYYY年M月D日' 统一成 YYYY-MM-DD。"""
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
    if not os.path.isfile(path):
        return None, False
    rd = PdfReader(path)
    text = "\n".join((pg.extract_text() or "") for pg in rd.pages[:4])
    ds = set()
    for m in re.finditer(r"(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", text):
        ds.add("%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3))))
    return (sorted(ds)[0] if len(ds) == 1 else sorted(ds)), True


con = sqlite3.connect(os.path.join(ROOT, "data", "board.db"))
con.row_factory = sqlite3.Row
rows = con.execute(
    "select id, publish_date, pdf_local from announcements where pdf_local is not null and pdf_local != ''"
).fetchall()

agree = pdf_missing = attch_missing = multi = 0
problems = []
for i, r in enumerate(rows):
    nid = r["id"]
    try:
        d = get_json(DETAIL % nid)
    except Exception as e:
        problems.append((nid, "接口失败 " + str(e)[:40]))
        attch_missing += 1
        time.sleep(0.5)
        continue
    data = d.get("data", d)
    attch = (data.get("contentObj") or {}).get("attchList") or []
    if not attch:
        problems.append((nid, "无附件"))
        attch_missing += 1
        time.sleep(0.5)
        continue
    if len(attch) > 1:
        multi += 1
    api_date = to_date(attch[0].get("created"))
    pdf_date, has_pdf = pdf_official_date(os.path.join(PDF_DIR, r["pdf_local"]))
    if not has_pdf:
        pdf_missing += 1
    ok = (api_date is not None) and (api_date == pdf_date)
    if ok:
        agree += 1
    else:
        problems.append((nid, "api=%s pdf=%s attch数=%d 当前DB=%s" %
                         (api_date, pdf_date, len(attch), r["publish_date"])))
    if (i + 1) % 20 == 0:
        print("  ...已验证 %d/%d" % (i + 1, len(rows)), flush=True)
    time.sleep(0.5)

print("=" * 70)
print("总 %d 条 | 完全一致 %d | 接口缺附件 %d | 本地缺PDF %d | 多附件 %d" %
      (len(rows), agree, attch_missing, pdf_missing, multi))
print("问题条目（api日期 != PDF落款）:")
if problems:
    for nid, msg in problems:
        print("  ", nid, msg)
else:
    print("   无 —— 100%% 一致")
