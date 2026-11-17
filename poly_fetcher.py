# -*- coding: utf-8 -*-
"""保利集团招标采购供应链平台（gyl.poly.com.cn）公告抓取器。

接口事实（2026-11 侦察确认，全部免鉴权）：
  POST /api/truelore-business-support/noauth/trans/trade/pageEs
  GET  /api/truelore-business-support/noauth/trans/trade/getByTradeId?id=..&noticeType=..

关键点：
  1. noticeType / tenderOrganizeFormId / purchasePatternId 必须置空，
     否则集中采购、委托代理的项目会被过滤掉。
  2. businessName 是标题子串匹配，不分词，所以本地用同义词组过滤。
  3. 附件是 S3 预签名链接，30 分钟过期，必须取详情后立即下载。

用法：
    python poly_fetcher.py --list-only          # 只拉列表，看分类命中
    python poly_fetcher.py --detail-limit 40    # 拉详情并下载附件（最多 40 条）
"""
import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
OUT_JSON = os.path.join(DATA, "poly_items.json")
PDF_DIR = os.path.join(DATA, "poly_pdfs")

API = "https://gyl.poly.com.cn/api/truelore-business-support/noauth/trans/trade"
TRADE_PATTERN = "1377439814630121473"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

NOTICE_TYPES = {1: "采购公告", 2: "变更/公示", 3: "候选人公示", 4: "结果公告", 5: "异常公告"}

# 品类关键词（标题命中，按优先级从具体到泛化）
CAT_RULES = [
    ("服务器", r"服务器|算力|智算|超算|小型机|刀片"),
    ("存储", r"存储|磁盘阵列|硬盘|备份一体机|对象存储|分布式存储|磁带库|NAS\b"),
    ("网络", r"交换机|路由器|防火墙|网络设备|无线|AP\b|负载均衡|入侵检测|上网行为|光模块|综合布线"),
    ("笔记本", r"笔记本|便携机|便携式|移动工作站|超极本"),
    ("台式机", r"台式机|台式主机|台式电脑|工作站|一体机|计算机终端|电脑终端|终端设备|微型计算机|信创终端"),
    ("打印机", r"打印机|多功能一体机|复印机|扫描仪|传真机"),
]

# 服务/运维/工程类噪声，命中这些一律不算 IT 硬件采购
EXCLUDE = re.compile(
    r"维护服务|维保服务|维修服务|保养服务|租赁服务|劳务外包|监理服务|设计服务|咨询服务|"
    r"策划服务|保洁服务|绿化服务|搬迁服务|运输服务|会议服务|评估服务|审计服务|物业服务|"
    r"外包服务|改造工程|装修工程|空调|舞台灯|演出|票务|安保|餐饮|保洁|绿化",
    re.I,
)
# 必须是这些硬件词才算 IT 采购
HW_TERM = re.compile(
    r"服务器|存储|磁盘阵列|硬盘|交换机|路由器|防火墙|网络设备|无线AP|负载均衡|"
    r"台式机|台式主机|笔记本|便携|计算机|工作站|一体机|终端|"
    r"打印机|复印机|扫描仪|显示器|内存条|固态|CPU|主板|电源|机柜|UPS",
    re.I,
)

IT_HINT = re.compile(
    r"服务器|主机|工作站|台式|便携|笔记本|计算机|电脑|终端|存储|磁盘|阵列|备份|"
    r"网络|交换机|路由|防火墙|安全设备|机房|UPS|打印机|扫描仪|显示器|监控|"
    r"信息化|系统集成|数据中心|智算|算力|软件|硬件|IT",
    re.I,
)


def http_json(url, body=None, timeout=30):
    data = None
    headers = {"User-Agent": UA, "Accept": "application/json, text/plain, */*"}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json;charset=UTF-8"
        headers["Origin"] = "https://gyl.poly.com.cn"
        headers["Referer"] = "https://gyl.poly.com.cn/web-portal/"
    req = urllib.request.Request(url, data=data, headers=headers,
                                 method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def list_page(notice_type, page, page_size=200):
    body = {
        "unitCode": None,
        "pageNum": page,
        "pageSize": page_size,
        "tradePattern": TRADE_PATTERN,
        "noticeType": (None if notice_type in (0, "0") else notice_type),
        "businessName": "",
        "releaseEndTime": "",
        "releaseStartTime": "",
        "purchaseProjectType": "",
        "purchaseMode": None,
        "tenderOrganizeFormId": None,   # 关键：置空才不漏集中采购
        "purchasePatternId": None,      # 关键：置空才不漏委托代理
    }
    d = http_json(API + "/pageEs", body)["data"]
    return d.get("totalCount") or 0, d.get("list") or []


def ms_to_dt(ms):
    if not ms:
        return None
    try:
        return datetime.datetime.fromtimestamp(int(ms) / 1000.0).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


def classify(title, scope=""):
    text = (title or "") + " " + (scope or "")
    if EXCLUDE.search(title or ""):
        return None
    if not HW_TERM.search(text):
        return None
    for cat, pat in CAT_RULES:
        if re.search(pat, text, re.I):
            return cat
    return None


def fetch_list(notice_types=(1, 2, 3), page_size=200, max_pages=15, verbose=True):
    items = []
    for nt in notice_types:
        page = 1
        while page <= max_pages:
            try:
                total, rows = list_page(nt, page, page_size)
            except Exception as e:
                if verbose:
                    print("  [!] type=%s page=%s 失败: %s" % (nt, page, e))
                break
            if verbose:
                print("  type=%s(%s) page=%s -> %d/%d"
                      % (nt, NOTICE_TYPES.get(nt, "?"), page, len(rows), total))
            for r in rows:
                r["_noticeType"] = nt
            items.extend(rows)
            if not rows or page * page_size >= total:
                break
            page += 1
    return items


def normalize(r):
    return {
        "id": str(r.get("id")),
        "notice_type": r.get("noticeType") or r.get("_noticeType"),
        "notice_type_name": NOTICE_TYPES.get(r.get("_noticeType"), ""),
        "title": (r.get("businessName") or "").strip(),
        "code": r.get("purchaseProjectCode") or "",
        "section_code": r.get("bidSectionCode") or "",
        "tenderer": r.get("tendererName") or "",
        "agency": r.get("tenderAgencyName") or "",
        "publish_date": (ms_to_dt(r.get("releaseTime")) or "")[:10],
        "publish_time": ms_to_dt(r.get("releaseTime")) or "",
        "bid_end_time": ms_to_dt(r.get("newBidEndTime") or r.get("bidEndTime")) or "",
        "project_type": r.get("purchaseProjectTypeName") or "",
        "pattern": r.get("purchasePatternName") or "",
        "organize_form": r.get("tenderOrganizeFormName") or "",
    }


def fetch_detail(item_id, notice_type):
    url = "%s/getByTradeId?id=%s&noticeType=%s" % (API, item_id, notice_type)
    d = http_json(url).get("data") or {}
    return d


def download(url, path, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        blob = r.read()
    if not blob.startswith(b"%PDF"):
        raise ValueError("not pdf")
    with open(path, "wb") as f:
        f.write(blob)
    return len(blob)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list-only", action="store_true")
    ap.add_argument("--scan-goods", action="store_true")
    ap.add_argument("--scan-all", action="store_true")
    ap.add_argument("--goods-limit", type=int, default=0)
    ap.add_argument("--detail-limit", type=int, default=0)
    ap.add_argument("--types", default="1,2,3")
    ap.add_argument("--max-pages", type=int, default=15)
    args = ap.parse_args()

    os.makedirs(DATA, exist_ok=True)
    types = tuple(int(x) for x in args.types.split(",") if x.strip())
    print("拉取公告列表，类型=%s ..." % (types,))
    raw = fetch_list(types, max_pages=args.max_pages)
    print("共拿到 %d 条原始公告" % len(raw))

    now = datetime.datetime.now()
    seen = set()
    rows = []
    for r in raw:
        it = normalize(r)
        if not it["id"] or it["id"] in seen:
            continue
        seen.add(it["id"])
        it["category"] = classify(it["title"])
        it["it_hint"] = bool(IT_HINT.search(it["title"]))
        end = it["bid_end_time"]
        it["is_open"] = 1 if (end and end >= now.strftime("%Y-%m-%d %H:%M:%S")) else 0
        rows.append(it)

    rows.sort(key=lambda x: (x["publish_date"], x["id"]), reverse=True)

    # 同一项目会在多种公告类型里重复出现，按项目编号归并，保留信息量最大的一条
    best = {}
    prio = {1: 0, 2: 1, 3: 2, 4: 3, 5: 4}
    for x in rows:
        k = x["code"] or x["id"]
        if k not in best or prio.get(x["notice_type"], 9) < prio.get(best[k]["notice_type"], 9):
            best[k] = x
    rows = list(best.values())
    print("按项目编号归并后 %d 个独立项目" % len(rows))

    # 标题没命中但属于"货物"的项目，仍然可能藏在技术参数里（服务器/存储/网络）
    if args.scan_goods:
        goods = [x for x in rows if not x.get("scope") and (args.scan_all or not x["it_hint"])]
        limit = args.goods_limit or len(goods)
        print("标题未命中但属『货物』的项目 %d 条，进入详情扫描前 %d 条 ..." % (len(goods), limit))
        hit = 0
        for i, it in enumerate(goods[:limit], 1):
            try:
                raw_d = fetch_detail(it["id"], it["notice_type"] or "")
                d = (raw_d.get("biddingNotice") or raw_d.get("biddingChangeNotice")
                     or raw_d.get("bidResultAnnounce") or raw_d.get("bidCandidateAnnounce")
                     or raw_d.get("tenderExceptionNotice") or {})
                scope = (d.get("biddingScope") or "").strip()
                it["scope"] = scope[:1500]
                it["budget"] = d.get("reckonPrice")
                it["contact_person"] = d.get("contactPerson") or ""
                it["contact_phone"] = d.get("contactNumber") or ""
                it["catalog"] = d.get("purchaseDirectory") or ""
                cat = classify(it["title"], scope)
                if cat or IT_HINT.search(scope or ""):
                    it["category"] = cat
                    it["it_hint"] = True
                    it["from_scope"] = True
                    hit += 1
                    print("    + [%s] %s" % (cat or "IT", it["title"][:36]))
                if i % 25 == 0:
                    print("    扫描 %d/%d，命中 %d" % (i, limit, hit))
                time.sleep(0.12)
            except Exception as e:
                print("    [FAIL] %s -> %s" % (it["title"][:26], e))
        print("详情扫描完成：新增命中 %d 条" % hit)

    it_rows = [x for x in rows if x["it_hint"]]

    print("-" * 56)
    print("去重后 %d 条；标题命中 IT 关键词 %d 条；仍在投标期 %d 条"
          % (len(rows), len(it_rows), len([x for x in rows if x["is_open"]])))
    from collections import Counter
    print("IT 品类分布：", dict(Counter([x["category"] or "未分类" for x in it_rows])))
    print("公告类型分布：", dict(Counter([x["notice_type_name"] for x in rows])))
    print("-" * 56)
    for x in it_rows[:12]:
        print("  [%s] %s | %s | 截止 %s" % (x["category"] or "-", x["title"][:38],
                                            x["tenderer"][:16], x["bid_end_time"][:10]))

    if args.list_only:
        with open(OUT_JSON, "w", encoding="utf-8") as f:
            json.dump({"updated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
                       "total": len(rows), "items": rows}, f, ensure_ascii=False, indent=1)
        print("\n已写入 %s（%d 条）" % (OUT_JSON, len(rows)))
        return 0

    # 详情 + 附件
    limit = args.detail_limit or len(it_rows)
    targets = [x for x in it_rows if x["is_open"]][:limit]
    os.makedirs(PDF_DIR, exist_ok=True)
    print("\n抓详情并下载附件：%d 条" % len(targets))
    ok = 0
    for i, it in enumerate(targets, 1):
        try:
            d = fetch_detail(it["id"], it["notice_type"])
            notice = d.get("biddingNotice") or {}
            it["budget"] = notice.get("reckonPrice")
            it["scope"] = (notice.get("biddingScope") or "").strip()[:1500]
            it["contact_person"] = notice.get("contactPerson") or ""
            it["contact_phone"] = notice.get("contactNumber") or ""
            it["catalog"] = notice.get("purchaseDirectory") or ""
            it["category"] = it["category"] or classify(it["title"], it["scope"])
            files = (notice.get("announceFileDtoList") or [])[:3]
            it["attachments"] = []
            for f in files:
                name = f.get("fileName") or "attachment.pdf"
                url = f.get("downLoadUrl") or ""
                rec = {"name": name, "url": url, "local": None, "size": 0}
                if url and name.lower().endswith(".pdf"):
                    safe = re.sub(r'[\\/:*?"<>|]', "_", name)[:80]
                    local = "%s_%s" % (it["id"], safe)
                    path = os.path.join(PDF_DIR, local)
                    try:
                        rec["size"] = download(url, path)
                        rec["local"] = local
                    except Exception as e:
                        rec["error"] = str(e)
                it["attachments"].append(rec)
            ok += 1
            print("  %d/%d %s | 附件 %d" % (i, len(targets), it["title"][:34], len(it["attachments"])))
            time.sleep(0.6)
        except Exception as e:
            print("  %d/%d [FAIL] %s -> %s" % (i, len(targets), it["title"][:30], e))

    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump({"updated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
                   "total": len(rows), "items": rows}, f, ensure_ascii=False, indent=1)
    print("\n详情成功 %d 条；已写入 %s" % (ok, OUT_JSON))
    return 0


if __name__ == "__main__":
    sys.exit(main())
