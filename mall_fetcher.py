# -*- coding: utf-8 -*-
"""央采电子卖场「成交公告」抓取器 —— 建机型 + 成交价库（纯标准库）。

接口事实（2026-11 侦察确认，全部免登录）：
  列表 GET https://mkt.zycg.gov.cn/proxy/platform/platform/notice/queryMallNoticePageList
           ?platformId=20&noticeType=4&pageNum=1&pageSize=500
  明细 GET https://mkt.zycg.gov.cn/proxy/platform/platform/notice/queryMallNoticeById
           ?platformId=20&id=<id>

noticeType=4 是成交公告（含询价成交、反拍成交、协议比价）。
正文 data.contentStr 是 HTML 表格，询价型含「产品 / 品牌 / 规格型号 / 数量 / 单价」。
窗口约 4 个月滚动（当前 1150 条，最早 2026-07-20）。

用法：
    python mall_fetcher.py                 # 全量抓取（约 3 页 + 1150 次明细）
    python mall_fetcher.py --max-detail 60 # 只抓前 60 条明细，快速验证
    python mall_fetcher.py --incremental   # 只抓第 1 页最新公告（日常增量）
"""
import argparse
import datetime
import html
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
OUT = os.path.join(DATA, "mall_deals.json")

API = "https://mkt.zycg.com"  # 占位，下面覆盖
API = "https://mkt.zycg.gov.cn/proxy/platform-service/platform/notice"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# 规则按顺序命中即返回：更具体的词放前面，避免「多功能一体机→打印机」「视频会议终端→视频会议」
# 被「一体机/终端→台式机」抢先误分类；触控一体机/会议平板按用户口径单列「商显」，选型时默认排除。
CAT_RULES = [
    ("视频会议", r"视频会议|视频终端|会控|MCU|视频矩阵|编解码"),
    ("商显", r"触控一体机|会议平板|商显|数字标牌|广告机|会议一体机|教学一体机|会议电视"),
    ("打印机", r"打印机|多功能一体机|复印机|扫描仪|传真|墨盒|硒鼓|粉盒"),
    ("存储", r"备份一体机|磁盘阵列|存储|磁盘柜|NAS"),
    ("服务器", r"服务器|小型机|刀片|超融合|GPU"),
    ("网络安全", r"防火墙|网闸|入侵|负载均衡|WAF|堡垒机|运维安全|安全管理|安全运营|审计|态势感知|漏洞|等保|防病毒|动态防护|APT"),
    ("网络", r"交换机|路由器|网关|无线接入|光模块|无线控制|POE"),
    ("笔记本", r"便携式计算机|笔记本|便携机|移动工作站|MateBook"),
    ("台式机", r"台式计算机|台式机|一体机|工作站|终端|微型计算机|计算机|开天|擎云"),
]


def http_json(url, timeout=40):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://mkt.zycg.gov.cn/mall-view/",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def list_notices(page, size=500, notice_type=4):
    url = ("%s/queryMallNoticePageList?platformId=20&noticeType=%d&pageNum=%d&pageSize=%d"
           % (API, notice_type, page, size))
    d = http_json(url).get("data") or {}
    return d.get("totalCount") or 0, d.get("result") or []


def get_detail(nid):
    url = "%s/queryMallNoticeById?platformId=20&id=%s" % (API, nid)
    return http_json(url).get("data") or {}


def strip_tags(s):
    s = re.sub(r"<br\s*/?>", " ", s or "", flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).replace("\xa0", " ").strip()


def parse_tables(content_html):
    """把 contentStr 里的表格解析成 [{headers:[], rows:[[cell,...]]}]。"""
    out = []
    for tbl in re.findall(r"<table.*?</table>", content_html or "", flags=re.S | re.I):
        headers, rows = [], []
        for tr in re.findall(r"<tr.*?</tr>", tbl, flags=re.S | re.I):
            cells = [strip_tags(c) for c in
                     re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.S | re.I)]
            if not cells:
                continue
            if not headers and re.search(r"产品|商品|名称|品牌|型号", "".join(cells)):
                headers = cells
            else:
                rows.append(cells)
        if headers and rows:
            out.append({"headers": headers, "rows": rows})
    return out


def pick_col(headers, names):
    for i, h in enumerate(headers):
        for n in names:
            if n in h:
                return i
    return -1


def num(s):
    m = re.search(r"-?\d+(?:\.\d+)?", str(s or "").replace(",", ""))
    return float(m.group(0)) if m else None


def classify(text):
    for cat, pat in CAT_RULES:
        if re.search(pat, text or "", re.I):
            return cat
    return "其他"


def extract_deals(nid, notice, content_html):
    """从正文表格里抽商品行。返回 [{product,brand,model,qty,unit_price,amount,supplier,buyer}]。"""
    deals = []
    supplier = ""
    plain = strip_tags(content_html or "")
    m = re.search(r"成交供应商(?:名称)?[：:\s]*([^\s，,。<]{2,40})", plain)
    if m:
        supplier = m.group(1)
    # 反拍类公告的商品数量只写在正文里：「采购数量：8」
    mq = re.search(r"采购数量[：:\s]*(\d+)", plain)
    text_qty = float(mq.group(1)) if mq else None
    for t in parse_tables(content_html):
        h = t["headers"]
        hs = "".join(h)
        # 响应人/落标审查表、纯供应商报价表（无商品名）都不是商品明细
        if "响应人" in hs or "被拒绝原因" in hs:
            continue
        reverse_mode = "报价商品名称" in hs
        i_prod = pick_col(h, ["产品", "商品名称", "货物名称", "报价商品名称"])
        i_brand = pick_col(h, ["品牌"])
        i_model = pick_col(h, ["规格型号", "型号", "规格"])
        i_qty = pick_col(h, ["数量"])
        i_price = pick_col(h, ["单价", "报价(元)", "报价（元）", "报价"])
        i_amt = pick_col(h, ["成交金额", "总报价", "金额", "合计"])
        i_sup = pick_col(h, ["成交供应商", "供应商名称", "供应商"])
        i_buy = pick_col(h, ["采购组织单位", "采购单位", "采购人"])
        i_win = pick_col(h, ["是否成交"])
        if i_prod < 0:
            continue
        if not reverse_mode and pick_col(h, ["规格型号", "型号", "数量", "单价"]) < 0:
            continue
        for row in t["rows"]:
            def cell(i):
                return row[i].strip() if 0 <= i < len(row) else ""

            # 反拍表里每个供应商一行，只取成交那一行
            if reverse_mode and i_win >= 0 and "成交" not in cell(i_win):
                continue

            prod = cell(i_prod)
            model = cell(i_model)
            brand = cell(i_brand)
            name = " ".join(x for x in (prod, brand, model) if x).strip()
            if not name or len(name) < 2:
                continue
            # 反拍型把品牌型号合并在商品名里，尝试拆出括号内型号
            if not model and "（" in prod:
                mm = re.search(r"[（(]([^）)]+)[）)]", prod)
                if mm:
                    model = mm.group(1)
            # 去掉 "13-华为防火墙" 这类序号前缀
            prod = re.sub(r"^\s*\d{1,3}\s*[-、.．]\s*", "", prod or "")
            qty = num(cell(i_qty)) or text_qty
            up = num(cell(i_price))
            amt = num(cell(i_amt))
            # 单价以「总额 / 数量」为准，避免各公告列名不一致导致取错列
            if qty and amt and qty > 0:
                up = round(amt / qty, 2)
            elif up is not None and amt and qty is None:
                up = None  # 数量未知时单价不可信
            deals.append({
                "notice_id": nid,
                "product": prod or name,
                "brand": brand,
                "model": model,
                "qty": qty,
                "unit_price": up,
                "amount": amt,
                "supplier": cell(i_sup) or supplier,
                "buyer": cell(i_buy),
                "category": classify(name),
                "title": notice.get("noticeTitle") or "",
                "date": (notice.get("publishtimeStr") or notice.get("publishTimeStr") or "")[:10],
            })
    return deals


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-detail", type=int, default=0)
    ap.add_argument("--incremental", action="store_true")
    ap.add_argument("--pages", type=int, default=3)
    ap.add_argument("--page-size", type=int, default=500)
    args = ap.parse_args()

    os.makedirs(DATA, exist_ok=True)
    old = {"items": []}
    if args.incremental and os.path.isfile(OUT):
        with open(OUT, "r", encoding="utf-8") as f:
            old = json.load(f)
    seen = {x["notice_id"] for x in old.get("items", [])}

    notices = []
    pages = 1 if args.incremental else args.pages
    for p in range(1, pages + 1):
        total, rows = list_notices(p, args.page_size)
        print("列表 page=%d -> %d/%d" % (p, len(rows), total))
        notices.extend(rows)
        if len(rows) < args.page_size:
            break
    print("待处理公告 %d 条（已在库 %d）" % (len(notices), len(seen)))

    deals = list(old.get("items", []))
    ok = fail = 0
    todo = [n for n in notices if str(n.get("id")) not in seen]
    if args.max_detail:
        todo = todo[:args.max_detail]
    for i, n in enumerate(todo, 1):
        nid = str(n.get("id"))
        try:
            d = get_detail(nid)
            got = extract_deals(nid, d, d.get("contentStr") or "")
            if got:
                deals.extend(got)
                ok += 1
            else:
                fail += 1
            if i % 25 == 0:
                print("  明细 %d/%d，成功 %d，无商品行 %d，累计商品行 %d"
                      % (i, len(todo), ok, fail, len(deals)))
            time.sleep(0.12)
        except Exception as e:
            fail += 1
            print("  [FAIL] %s -> %s" % (nid, e))

    payload = {
        "updated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "notice_count": len(notices),
        "deal_rows": len(deals),
        "items": deals,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    from collections import Counter
    print("-" * 50)
    print("公告成功 %d / 无商品行 %d" % (ok, fail))
    print("商品行总计 %d" % len(deals))
    print("品类分布", dict(Counter([x["category"] for x in deals])))
    priced = [x for x in deals if x.get("unit_price")]
    print("有单价的行 %d，单价区间 %.0f ~ %.0f 元"
          % (len(priced), min([x["unit_price"] for x in priced] or [0]),
             max([x["unit_price"] for x in priced] or [0])))
    print("已写入 %s" % OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
