# -*- coding: utf-8 -*-
"""国铁商城批采模块数据抓取器。

公开源：cg.95306.cn 国铁采购平台（无需 key/登录；mhId 仅访客指纹）。
受限源：mall.95306.cn 国铁商城批量采购专区（需 SSO serviceTicket/Authorization）。

默认抓取最近 120 天、与佳业国铁店铺和 IT 行业相关的采购公告。接口有限流，
请求间隔默认 6 秒；遇 0-0203 自动退避 25 秒。详情正文公开，附件下载需登录。
"""
import argparse
import datetime as dt
import html
import json
import os
import random
import re
import time
import urllib.parse
import urllib.request
import uuid

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
OUT = os.path.join(DATA, "rail_items.json")
API = "https://cg.95306.cn/proxy/portal/elasticSearch/queryProcurementNoticeList"
DETAIL = "https://cg.95306.cn/baseinfor/notice/informationShow?id={}"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

KEYWORDS = [
    "台式机", "笔记本", "计算机", "软通华方", "清华同方",
    "服务器", "存储", "交换机", "路由器", "防火墙", "网络设备",
]
CAT_RULES = [
    ("台式机", r"台式机|台式电脑|台式主机|微型计算机|信创终端|计算机终端|工作站"),
    ("笔记本", r"笔记本|便携式计算机|移动工作站|便携机"),
    ("服务器", r"服务器|算力|智算|小型机|刀片"),
    ("存储", r"信息存储|数据存储|信创存储|存储服务器|存储设备|磁盘阵列|硬盘|备份一体机|NAS\b|磁带库"),
    ("网络", r"交换机|路由器|网络设备|无线AP|光模块|综合布线|负载均衡"),
    ("网络安全", r"防火墙|入侵检测|网络安全|安全网关|上网行为|日志审计|堡垒机"),
]
EXCLUDE = re.compile(
    r"会议平板|智慧黑板|广告机|拼接屏|电子白板|商显|电视机|大屏幕|LED屏|"
    r"一体机|打印机|打印设备|扫描仪|复印机|多功能一体机|"
    r"终止公告|流标公告|废标公告|中标公告|成交公告|结果公告|维修|维保|维护业务|业务外包|服务外包|租赁|"
    r"报废|废旧|处置项目|不含存储设备",
    re.I,
)
BRANDS = ["软通华方", "清华同方", "同方", "华为", "联想", "紫光", "新华三", "H3C", "浪潮", "曙光"]
BRAND_LIMIT = re.compile(r"指定品牌|品牌要求|推荐品牌|限定品牌|原厂授权|制造商授权|唯一授权", re.I)


def clean_text(s):
    s = html.unescape(s or "")
    # 先删除 style/script 块，防止样式源码进入公告正文。
    s = re.sub(r"<(style|script)\b[^>]*>.*?</\1>", " ", s, flags=re.I | re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    # 部分国铁竞价正文把 CSS 当纯文本前缀返回（无 <style> 包裹），从“公告日期”起截断。
    if s.lstrip().startswith(".backNotWrap") and "公告日期" in s:
        s = s[s.find("公告日期"):]
    return re.sub(r"\s+", " ", s).strip()


def classify(text):
    if EXCLUDE.search(text or ""):
        return None
    for cat, pat in CAT_RULES:
        if re.search(pat, text or "", re.I):
            return cat
    return None


def post_list(keyword, page, start, end, mhid, timeout=30):
    body = {
        "mhId": mhid, "Authorization": "", "projBidType": "", "bidType": "",
        "noticeType": "000", "unitType": "", "wzType": "", "title": keyword,
        "biddingProjCode": "", "createUnit": "", "inforCode": "",
        "startDate": start, "endDate": end, "pageNum": str(page), "projType": "",
        "createPeopUnit": "", "sortCondition": "",
    }
    req = urllib.request.Request(
        API, data=urllib.parse.urlencode(body).encode("utf-8"), method="POST",
        headers={"User-Agent": UA, "Accept": "application/json, text/plain, */*",
                 "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                 "Origin": "https://cg.95306.cn",
                 "Referer": "https://cg.95306.cn/baseinfor/notice/procurementNotice"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def fetch_detail(item_id, mhid, timeout=30):
    """调用页面同款公开 indexView 接口，返回正文/采购单位/项目号；无需 token。"""
    url = "https://cg.95306.cn/proxy/portal/elasticSearch/indexView"
    body = {"noticeId": item_id, "mhId": mhid, "Authorization": ""}
    req = urllib.request.Request(
        url, data=urllib.parse.urlencode(body).encode("utf-8"), method="POST",
        headers={"User-Agent": UA, "Accept": "application/json, text/plain, */*",
                 "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                 "Origin": "https://cg.95306.cn", "Referer": DETAIL.format(item_id)})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read().decode("utf-8", "ignore"))
    if not d.get("success"):
        raise RuntimeError(d.get("msg") or d.get("code") or "详情接口失败")
    content = ((d.get("data") or {}).get("noticeContent") or {})
    text = clean_text(content.get("notCont") or "")
    return text[:80000], content


def parse_buyer(text):
    for pat in [
        r"采购单位[：:\s]+([^，。；\n]{2,60})",
        r"采购人(?:为|[：:\s]+)([^，。；\n]{2,60})",
        r"招标人(?:为|[：:\s]+)([^，。；\n]{2,60})",
        r"采\s*购\s*人[：:\s]+([^，。；\n]{2,60})",
    ]:
        m = re.search(pat, text or "")
        if m:
            v = m.group(1).strip()
            # 竞价公告常把“采购单位、地址、报名截止”挤在同一行，二次截断尾部元数据。
            v = re.split(r"(?:详细)?地址[：:]|报名截止时间[：:]|邮政编码[：:]|电\s*话[：:]|联系人[：:]", v)[0].strip()
            return v
    return ""


def parse_deadline(text, fallback=""):
    pats = [
        r"(?:报价文件|投标文件).*?截止时间[^0-9]{0,20}(20\d{2})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})[:：](\d{2})",
        r"截止时间[^0-9]{0,20}(20\d{2})[-年](\d{1,2})[-月](\d{1,2})日?\s*(\d{1,2})[:：](\d{2})",
    ]
    for pat in pats:
        m = re.search(pat, text or "", re.S)
        if m:
            return "%04d-%02d-%02d %02d:%02d:00" % tuple(int(x) for x in m.groups())
    return fallback or ""


def brand_scope(text):
    found = []
    low = text or ""
    for b in BRANDS:
        if re.search(re.escape(b), low, re.I) and b not in found:
            found.append(b)
    if found:
        return "涉及品牌：" + "、".join(found)
    if BRAND_LIMIT.search(low):
        return "存在品牌/原厂授权条件（品牌待附件核验）"
    return "公开正文未限定品牌（附件需登录核验）"


def fetch_all(days=120, delay=6.0, detail_limit=0, max_pages=3, verbose=True):
    end = dt.date.today()
    start = end - dt.timedelta(days=days)
    start_s, end_s = start.isoformat(), end.isoformat()
    mhid = uuid.uuid4().hex
    rows = {}
    requests = 0
    for kw in KEYWORDS:
        page = 1
        while True:
            if requests:
                time.sleep(delay + random.random())
            for attempt in range(3):
                try:
                    d = post_list(kw, page, start_s, end_s, mhid)
                    if d.get("code") == "0-0203":
                        if verbose:
                            print("  [限流] %s p%d，退避25秒" % (kw, page))
                        time.sleep(25)
                        continue
                    break
                except Exception as e:
                    if attempt == 2:
                        if verbose:
                            print("  [失败] %s p%d: %s" % (kw, page, e))
                        d = {}
                    else:
                        time.sleep(10)
            requests += 1
            rd = ((d.get("data") or {}).get("resultData") or {})
            result = rd.get("result") or []
            if verbose:
                print("  %-8s p%-2d -> %d/%s" % (kw, page, len(result), rd.get("totalCount", 0)))
            for r in result:
                iid = str(r.get("id") or "")
                if not iid:
                    continue
                title = clean_text(r.get("notTitle"))
                digest = clean_text(r.get("digest"))
                cat = classify(title + " " + digest)
                if cat:
                    old = rows.get(iid)
                    x = {
                        "id": iid, "platform": "rail", "source": "cg.95306.cn公开采购公告",
                        "title": title, "category": cat,
                        "publish_date": r.get("checkTime") or "",
                        "bid_end_time": r.get("latestDocumentSaleEndTime") or r.get("documentSaleEndTime") or "",
                        "notice_type_name": r.get("noticeTypeName") or "",
                        "bid_type_name": r.get("bidTypeName") or "",
                        "project_type_name": r.get("projTypeName") or "",
                        "digest": digest, "buyer": "", "detail_text": "",
                        "detail_url": DETAIL.format(iid), "brand_scope": "",
                        "source_access": "公开采集·无需Key·无需登录（附件需登录）",
                        "matched_keywords": sorted(set((old or {}).get("matched_keywords", []) + [kw])),
                    }
                    rows[iid] = x
            if not result or page >= int(rd.get("totalPageCount") or 1) or page >= max_pages:
                break
            page += 1

    items = list(rows.values())
    items.sort(key=lambda x: (x["publish_date"], x["id"]), reverse=True)
    limit = detail_limit or len(items)
    if verbose:
        print("相关公告去重后 %d 条，抓详情 %d 条" % (len(items), min(limit, len(items))))
    for i, it in enumerate(items[:limit]):
        if requests or i:
            time.sleep(delay + random.random())
        try:
            text, content = fetch_detail(it["id"], mhid)
            it["detail_text"] = text
            it["buyer"] = parse_buyer(text)
            it["project_code"] = content.get("biddingProjCode") or content.get("projCode") or ""
            it["bid_end_time"] = parse_deadline(text, it["bid_end_time"])
            it["brand_scope"] = brand_scope(it["title"] + " " + it["digest"] + " " + text)
        except Exception as e:
            it["detail_error"] = str(e)
            it["brand_scope"] = brand_scope(it["title"] + " " + it["digest"])
    now_s = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for it in items:
        it["is_open"] = 1 if it.get("bid_end_time") and it["bid_end_time"] >= now_s else 0
        if not it.get("brand_scope"):
            it["brand_scope"] = brand_scope(it["title"] + " " + it["digest"])
    return items, {"start": start_s, "end": end_s, "request_count": requests}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=120)
    ap.add_argument("--delay", type=float, default=6.0)
    ap.add_argument("--detail-limit", type=int, default=0)
    ap.add_argument("--max-pages", type=int, default=3)
    ap.add_argument("--quick", action="store_true", help="仅抓台式机关键词，用于接口测试")
    args = ap.parse_args()
    global KEYWORDS
    if args.quick:
        KEYWORDS = ["台式机"]
    os.makedirs(DATA, exist_ok=True)
    items, meta = fetch_all(args.days, args.delay, args.detail_limit, args.max_pages)
    out = {
        "updated_at": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source_status": {
            "cg95306": "公开可采集：无需key、无需登录；附件下载需登录",
            "mall95306_batch": "批量采购专区需SSO登录态（serviceTicket/Authorization）；无需API key",
        },
        "filter_scope": "店铺相关PC+软通华方/清华同方+无明确品牌限制+IT行业相关；排除会议平板等商显",
        "meta": meta, "count": len(items), "items": items,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("写入 %s：%d 条" % (OUT, len(items)))


if __name__ == "__main__":
    main()
