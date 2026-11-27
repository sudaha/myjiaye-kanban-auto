# -*- coding: utf-8 -*-
"""从官方成交结果库生成全站中标喜报；严格按我方工商全称匹配。"""
import datetime as dt
import json
import os
import re
from collections import OrderedDict

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "data", "deals.json")
OUT = os.path.join(BASE, "data", "wins.json")
OUR_COMPANIES = (
    "北京佳业同创科技有限公司",
    "北京智鑫盛通科技有限公司",
)


def clean_title(s):
    return re.sub(r"(?:采购项目)?成交公告$", "", (s or "").strip())


def main():
    deals = json.load(open(SRC, encoding="utf-8")).get("deals", [])
    groups = OrderedDict()
    for d in deals:
        company = (d.get("supplier") or "").strip()
        if company not in OUR_COMPANIES:
            continue
        key = (company, d.get("notice_id") or d.get("title") or "")
        g = groups.setdefault(key, {
            "id": "%s_%s" % (company, d.get("notice_id") or len(groups)),
            "company": company,
            "title": clean_title(d.get("title")),
            "date": d.get("date") or "",
            "amount": 0.0,
            "products": [],
            "notice_id": str(d.get("notice_id") or ""),
            "source": "央采电子卖场成交公告",
        })
        g["amount"] += float(d.get("amount") or 0)
        label = " ".join(x for x in (d.get("brand") or "", d.get("model") or d.get("product") or "") if x).strip()
        if label and label not in g["products"]:
            g["products"].append(label)
    wins = list(groups.values())
    for w in wins:
        w["amount"] = round(w["amount"], 2)
        w["products"] = w["products"][:6]
    # 手动/外部中标（国铁商城批采、其他平台等官方成交公告覆盖不到的来源）：
    # 从 data/wins_manual.json 合并，避免每次导出被重建覆盖（2026-11-27 起）。
    manual_file = os.path.join(BASE, "data", "wins_manual.json")
    if os.path.isfile(manual_file):
        try:
            m = json.load(open(manual_file, encoding="utf-8"))
            manual = m.get("wins") if isinstance(m, dict) else m
            have = {w["id"] for w in wins}
            for w in manual or []:
                if w.get("id") and w["id"] not in have:
                    wins.append(w)
                    have.add(w["id"])
        except Exception as e:
            print("[warn] wins_manual 合并失败: %s" % e)
    wins.sort(key=lambda x: (x.get("date") or "", x.get("title") or ""), reverse=True)
    json.dump({"updated_at": dt.datetime.now().isoformat(timespec="seconds"),
               "companies": list(OUR_COMPANIES), "count": len(wins), "wins": wins},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("喜报项目 %d 条（成交明细 %d 条）" % (len(wins), sum(1 for d in deals if (d.get("supplier") or "").strip() in OUR_COMPANIES)))


if __name__ == "__main__":
    main()
