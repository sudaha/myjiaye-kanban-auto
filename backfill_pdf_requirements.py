# -*- coding: utf-8 -*-
"""批量用询价通知书 PDF 完整技术要求回填 board.db，并生成审计报告。

只处理 DB 中当前公告；严格模式下任一有PDF的公告品目数不一致、技术要求为空或缺失，退出码1。
"""
from __future__ import print_function

import argparse
import io
import json
import os
import sqlite3

from pdf_requirements import enrich_products_from_pdf, extract_pdf_requirements

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "data", "board.db")
PDF_DIR = os.path.join(BASE, "data", "pdfs")
REPORT = os.path.join(BASE, "data", "requirements_audit.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--notice", type=int, default=0)
    args = ap.parse_args()

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    sql = "SELECT id, title, products_json, pdf_local FROM announcements"
    vals = ()
    if args.notice:
        sql += " WHERE id=?"
        vals = (args.notice,)
    sql += " ORDER BY id DESC"
    rows = conn.execute(sql, vals).fetchall()

    report = {"total_notices": len(rows), "checked_pdf": 0, "updated": 0,
              "product_count": 0, "complete_products": 0, "failures": [], "notices": []}
    for row in rows:
        nid = row["id"]
        try:
            products = json.loads(row["products_json"] or "[]")
        except Exception:
            products = []
        pdf_name = row["pdf_local"]
        pdf_path = os.path.join(PDF_DIR, pdf_name) if pdf_name else ""
        nr = {"id": nid, "title": row["title"], "api_products": len(products),
              "pdf_items": 0, "complete": False, "items": []}
        if not pdf_path or not os.path.isfile(pdf_path):
            nr["status"] = "no_pdf"
            report["notices"].append(nr)
            continue
        report["checked_pdf"] += 1
        try:
            pdf_items = extract_pdf_requirements(pdf_path)
            nr["pdf_items"] = len(pdf_items)
            enriched, audit = enrich_products_from_pdf(products, pdf_items)
            nr["items"] = audit
            report["product_count"] += len(products)
            report["complete_products"] += sum(1 for x in audit if x["complete"])
            failures = []
            if len(pdf_items) != len(products):
                failures.append("品目数不一致: API=%d PDF=%d" % (len(products), len(pdf_items)))
            for item in audit:
                if not item["complete"]:
                    failures.append("品目%d技术要求不完整:%s" % (item["index"], item["product_name"]))
            if failures:
                nr["status"] = "failed"
                report["failures"].append({"id": nid, "errors": failures})
            else:
                conn.execute("UPDATE announcements SET products_json=?, updated_at=datetime('now','localtime') WHERE id=?",
                             (json.dumps(enriched, ensure_ascii=False, separators=(",", ":")), nid))
                report["updated"] += 1
                nr["status"] = "updated"
                nr["complete"] = True
        except Exception as e:
            nr["status"] = "error"
            nr["error"] = repr(e)
            report["failures"].append({"id": nid, "errors": [repr(e)]})
        report["notices"].append(nr)
        print("%s %s API=%d PDF=%d" % (nid, nr["status"], nr["api_products"], nr["pdf_items"]))

    if not args.notice or not report["failures"]:
        conn.commit()
    else:
        # 单公告调试失败不写脏数据。
        conn.rollback()
    conn.close()

    with io.open(REPORT, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print("SUMMARY checked_pdf=%d updated=%d products=%d complete=%d failures=%d" % (
        report["checked_pdf"], report["updated"], report["product_count"],
        report["complete_products"], len(report["failures"])))
    print("REPORT", REPORT)
    return 1 if args.strict and report["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
