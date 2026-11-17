# -*- coding: utf-8 -*-
"""把成交记录聚合成「机型库」，供选型助手匹配 + 价格参考。

输入： data/mall_deals.json（mall_fetcher.py 产出，逐行商品成交记录）
输出： data/products.json

聚合口径：按 (品类, 品牌, 型号关键词) 归并；型号关键词取型号字段，
        若型号缺失则取商品名里的型号片段；价格用成交单价的中位数。
"""
import datetime
import io
import json
import os
import re
import statistics

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "data", "mall_deals.json")
OUT = os.path.join(BASE, "data", "products.json")

BRANDS = [
    "华为", "HUAWEI", "联想", "Lenovo", "thinkpad", "清华同方", "同方", "软通华方", "iSoftStone",
    "紫光", "新华三", "H3C", "浪潮", "inspur", "戴尔", "DELL", "惠普", "HP", "华硕", "ASUS",
    "宏碁", "acer", "神舟", "攀升", "长城", "曙光", "中科可控", "航天七〇六", "七〇六",
    "天融信", "启明星辰", "奇安信", "网神", "山石", "绿盟", "深信服", "迈凡", "硅库", "UNIS",
    "宝德", "宁畅", "超聚变", "xFusion", "锐捷", "锐捷网络", "迈普", "中兴", "ZTE",
]

# 型号常见形态：字母+数字混合串
MODEL_RE = re.compile(r"(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9\-_/\.]{2,24})(?![A-Za-z0-9])")


def clean(s):
    return re.sub(r"\s+", " ", (s or "")).strip()


def split_brand_model(product, brand, model):
    name = clean(product)
    brand = clean(brand)
    model = clean(model)
    if not brand:
        for b in BRANDS:
            if b.lower() in name.lower():
                brand = b
                break
    if not model:
        # 去掉品牌词后，取第一个像型号的片段
        rest = name
        if brand:
            rest = re.sub(re.escape(brand), " ", rest, flags=re.I)
        cands = [m for m in MODEL_RE.findall(rest)
                 if len(re.sub(r"[^0-9]", "", m)) >= 2 and not re.fullmatch(r"(?i)(D15|A4|ADF)", m)]
        if cands:
            model = cands[0]
    return brand, model, name


def model_key(brand, model, name):
    base = clean(model) or clean(name)
    base = re.sub(r"[（(].*?[）)]", " ", base)          # 去括号补充说明
    base = re.sub(r"\s+", "", base)
    return (brand or "").lower() + "|" + base.lower()[:40]


def main():
    if not os.path.isfile(SRC):
        print("缺少 %s，请先跑 mall_fetcher.py" % SRC)
        return 2
    with io.open(SRC, encoding="utf-8") as f:
        data = json.load(f)
    rows = data.get("items") or []
    print("成交明细 %d 行" % len(rows))

    groups = {}
    for r in rows:
        brand, model, name = split_brand_model(r.get("product"), r.get("brand"), r.get("model"))
        k = model_key(brand, model, name)
        g = groups.setdefault(k, {
            "key": k, "category": r.get("category") or "其他",
            "brand": brand, "model": model, "name": name,
            "prices": [], "deals": 0, "qtys": [],
            "suppliers": [], "notice_ids": [], "buyers": [], "dates": [],
        })
        g["deals"] += 1
        if r.get("unit_price") and 10 <= r["unit_price"] <= 5_000_000:
            g["prices"].append(float(r["unit_price"]))
        if r.get("qty"):
            g["qtys"].append(float(r["qty"]))
        if r.get("supplier") and r["supplier"] not in g["suppliers"]:
            g["suppliers"].append(r["supplier"])
        if r.get("buyer") and r["buyer"] not in g["buyers"]:
            g["buyers"].append(r["buyer"])
        if r.get("notice_id") and r["notice_id"] not in g["notice_ids"]:
            g["notice_ids"].append(r["notice_id"])
        if r.get("date"):
            g["dates"].append(r["date"])

    products = []
    for g in groups.values():
        prices = sorted(g["prices"])
        item = {
            "key": g["key"], "category": g["category"], "brand": g["brand"],
            "model": g["model"], "name": g["name"], "deals": g["deals"],
            "price_min": round(prices[0]) if prices else None,
            "price_med": round(statistics.median(prices)) if prices else None,
            "price_max": round(prices[-1]) if prices else None,
            "qty_total": int(sum(g["qtys"])) if g["qtys"] else None,
            "last_date": max(g["dates"]) if g["dates"] else "",
            "suppliers": g["suppliers"][:5],
            "buyers": g["buyers"][:5],
            "notice_ids": g["notice_ids"][:10],
        }
        products.append(item)

    products.sort(key=lambda x: (-x["deals"], -(x["price_med"] or 0)))

    payload = {
        "updated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "deal_rows": len(rows),
        "product_count": len(products),
        "products": products,
    }
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    from collections import Counter
    print("机型 %d 个" % len(products))
    print("品类分布", dict(Counter([p["category"] for p in products])))
    print("有价格的机型 %d 个" % len([p for p in products if p["price_med"]]))
    print("已写入 %s" % OUT)
    print("\n成交次数 Top 10：")
    for p in products[:10]:
        print("  [%s] %-28s 单价中位 %-9s 成交 %d 次"
              % (p["category"], (p["name"] or "")[:28],
                 p["price_med"] or "-", p["deals"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
