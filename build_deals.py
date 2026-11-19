# -*- coding: utf-8 -*-
"""生成央采成交结果库 data/deals.json，供「参与投标记录·中标率/查漏补缺」使用。

数据来源：
    data/mall_notices.json —— 成交公告原文（从中抽取「成交供应商名称」）
    data/mall_deals.json   —— 成交明细（品牌/型号/数量/单价/金额/品类/成交日期）

关键：需求公告 与 成交公告 之间无共用 id，需按「归一化标题」关联。
归一化规则（与前端 app.js 的 normTitle 保持一致）：
    去掉括号内容（（询价）（反拍）（框采）等）、去掉 采购项目/需求公告/成交公告 等
    标记词、去掉空格与标点，得到「采购方+品类」键。
"""
import hashlib
import json
import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))
NOTICES = os.path.join(BASE, "data", "mall_notices.json")
DEALS = os.path.join(BASE, "data", "mall_deals.json")
OUT = os.path.join(BASE, "data", "deals.json")

MARKERS = ["采购项目需求公告", "采购需求公告", "需求公告",
           "采购项目成交公告", "成交公告",
           "反拍采购成交公告", "询价采购成交公告", "框采采购成交公告", "反拍成交公告",
           "反拍", "询价", "框采", "竞价", "采购项目", "采购", "公告", "成交"]


def norm_title(t):
    t = re.sub(r"[（(][^）)]*[）)]", "", t or "")
    for m in MARKERS:
        t = t.replace(m, "")
    return re.sub(r"[\s·：:，。、\-—/（）()\"\u201c\u201d]", "", t)


def extract_supplier(content):
    txt = re.sub(r"<[^>]+>", " ", content or "")
    txt = re.sub(r"&nbsp;?", " ", txt)
    txt = re.sub(r"\s+", " ", txt)
    for w in ("成交供应商名称", "中标供应商名称", "供应商名称"):
        i = txt.find(w)
        if i < 0:
            continue
        seg = txt[i + len(w):i + len(w) + 60].strip().lstrip("：: ")
        m = re.match(r"([\u4e00-\u9fff（）()·A-Za-z0-9]{2,40}?(?:公司|中心|局|所|研究院|学院|大学|集团|厂|部|室|店|社|行))", seg)
        if m:
            return m.group(1)
        j = seg.find("成交金额")
        if j > 0:
            return seg[:j].strip()
        return seg[:30].strip()
    return ""


def main():
    notices = json.load(open(NOTICES, encoding="utf-8")).get("notices", {})
    supplier_by_notice = {str(k): extract_supplier(v.get("content", ""))
                          for k, v in notices.items()}

    deals = json.load(open(DEALS, encoding="utf-8")).get("items", [])
    out = []
    for r in deals:
        nid = str(r.get("notice_id") or "")
        title = r.get("title") or ""
        supplier = supplier_by_notice.get(nid, "").strip()
        # 若正文抽不到，退回原 supplier 字段（可能为「情况：」占位，需前端再过滤）
        if not supplier:
            s = str(r.get("supplier") or "").strip()
            if s and s not in ("情况：", "成交", "供应商", "中标供应商", "供应商名称", "成交供应商"):
                supplier = s
        out.append({
            "notice_id": nid,
            "title": title,
            "norm_key": norm_title(title),
            "supplier": supplier,
            "brand": r.get("brand") or "",
            "model": r.get("model") or "",
            "product": r.get("product") or "",
            "category": r.get("category") or "其他",
            "qty": r.get("qty"),
            "unit_price": r.get("unit_price"),
            "amount": r.get("amount"),
            "date": r.get("date") or "",
        })
    json.dump({"updated_at": json.load(open(DEALS, encoding="utf-8")).get("updated_at", ""),
               "deal_count": len(out),
               "deals": out},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False,
              separators=(",", ":"))
    with_supplier = sum(1 for x in out if x["supplier"])
    print("deals.json 生成完成：%d 条成交，其中可提取中标公司 %d 条" % (len(out), with_supplier))


if __name__ == "__main__":
    main()
