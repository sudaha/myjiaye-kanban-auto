# -*- coding: utf-8 -*-
"""用新版 CAT_RULES 对 data/mall_deals.json 里的商品行重新打品类标签（免重抓）。"""
import io
import json
import os
from collections import Counter

import mall_fetcher as mf

BASE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(BASE, "data", "mall_deals.json")


def main():
    with io.open(P, encoding="utf-8") as f:
        d = json.load(f)
    old = Counter(r.get("category") for r in d["items"])
    for r in d["items"]:
        r["category"] = mf.classify(r.get("product"))
    new = Counter(r["category"] for r in d["items"])
    with io.open(P, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    print("旧分布", dict(old))
    print("新分布", dict(new))


if __name__ == "__main__":
    main()
