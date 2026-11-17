# -*- coding: utf-8 -*-
"""中国政府采购网（search.ccgp.gov.cn）招标/中标公告抓取器。

检索接口 bxsearch（bidType=1 含中央 /cggg/zygg/ 与地方 /cggg/dfgg/ 公告），
WAF 极严（本机 IP 实测约 9 次快速请求即锁 30 分钟+），请求间隔必须 45s 以上。
按 IT 关键词检索 + 标题二次过滤，输出 data/ccgp_items.json（按 url 去重合并）。

用法：
    python ccgp_fetcher.py --days 7 --max-pages 10   # 首次播种
    python ccgp_fetcher.py --days 1 --max-pages 4    # 日常增量
"""
import argparse
import datetime as dt
import io
import json
import os
import re
import time
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "data", "ccgp_items.json")

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

# 检索关键词（覆盖服务器/PC/存储/网络/安全/算力）
# ccgp WAF 很严（本机 IP 实测约 9 次快速请求即锁 30 分钟+），间隔必须 45s 以上
KEYWORDS = ["服务器", "台式", "笔记本", "计算机", "工作站", "一体机",
            "交换机", "存储", "GPU", "防火墙", "路由器"]
SLEEP_S = 45

IT_CTX = re.compile(
    r"服务器|台式|笔记本|计算机|电脑|PC|工作站|一体机|交换机|路由器|防火墙|网关|"
    r"存储|磁盘|NAS|GPU|算力|数据中心|信创|网络|终端|桌面|机房|云平台|虚拟化|IT|软硬件|信息化", re.I)
EXCLUDE = re.compile(
    r"液体|激光|探针|化学|生物|医学|医疗|实验|检测|仪器|食品|配送|保安|物业|空调|"
    r"电梯|装修|工程|设计|咨询|印刷|出版|运输|车辆|园林|绿化|清洁|劳务|保险|审计服务|"
    r"服装|家具|图书|教学设备|体育|艺术|美术|工作室")

# 关键词检索时标题会带 <font color=red>高亮</font>，title 用 (.*?) + 去标签
ITEM_RE = re.compile(
    r'<a href="(http://www\.ccgp\.gov\.cn/cggg/[^"]+)"[^>]*>(.*?)</a>'
    r'.*?<span>(\d{4}\.\d{1,2}\.\d{1,2} \d{2}:\d{2}(?::\d{2})?)\s*\|\s*采购人：([^|]+?)\s*\|\s*代理机构：([^|]*?)\s*<br/>\s*'
    r'<strong[^>]*>\s*([^<]*?)\s*</strong>\s*\|\s*([^|<]*?)\s*\|\s*<strong[^>]*>\s*([^<]*?)\s*</strong>',
    re.S)


def is_it(title):
    return bool(IT_CTX.search(title)) and not EXCLUDE.search(title)


def load_existing():
    if os.path.isfile(OUT):
        d = json.load(io.open(OUT, encoding="utf-8"))
        return d.get("items", [])
    return []


def fetch_page(kw, st, et, p):
    url = ("http://search.ccgp.gov.cn/bxsearch?searchtype=1&bidType=1&kw=%s&"
           "start_time=%s&end_time=%s&timeType=6&buyerRegion=&pinMu=0&dlbid=&p=%d"
           % (urllib.parse.quote(kw), st, et, p))
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "ignore")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=1)
    ap.add_argument("--max-pages", type=int, default=10, help="每关键词最大页数（20 条/页）")
    args = ap.parse_args()

    today = dt.date.today()
    st = (today - dt.timedelta(days=args.days)).strftime("%Y:%m:%d")
    et = today.strftime("%Y:%m:%d")
    since = (today - dt.timedelta(days=args.days)).isoformat()
    print("ccgp 抓取窗口: %s ~ %s" % (st, et))

    existing = load_existing()
    known = set(it["url"] for it in existing)
    fresh = 0

    for ki, kw in enumerate(KEYWORDS):
        print("== 关键词 %d/%d: %s ==" % (ki + 1, len(KEYWORDS), kw))
        for p in range(args.max_pages):
            page_html = None
            for _attempt in range(4):
                try:
                    page_html = fetch_page(kw, st, et, p)
                except Exception as e:
                    print("  第%d页 请求异常 %s，等 %ds 重试…" % (p + 1, str(e)[:40], SLEEP_S))
                    time.sleep(SLEEP_S)
                    continue
                if "频繁" in page_html:
                    print("  第%d页 被限流，等 90s 重试…" % (p + 1))
                    time.sleep(90)
                    continue
                break
            if page_html is None or "频繁" in page_html:
                print("  第%d页 连续失败，跳过该关键词" % (p + 1))
                break
            items = ITEM_RE.findall(page_html)
            if not items:
                break
            page_fresh = 0
            oldest = "9999-99-99"
            for u, t, d, buyer, ag, typ, region, cat in items:
                t = re.sub(r"<[^>]+>", "", t).strip()  # 去掉 <font> 高亮标签
                day = d[:10].replace(".", "-")
                if day < oldest:
                    oldest = day
                if day < since:
                    continue
                if not is_it(t):
                    continue
                if u in known:
                    continue
                known.add(u)
                existing.append({
                    "id": "ccgp-" + re.sub(r"\W+", "", u)[-12:],
                    "title": t,
                    "date": d,
                    "buyer": buyer.strip(),
                    "agent": ag.strip(),
                    "notice_type": typ.strip(),
                    "region": region.strip(),
                    "category": cat.strip(),
                    "url": u,
                    "source": "ccgp",
                })
                page_fresh += 1
            fresh += page_fresh
            print("  第%d页: %d 条（最旧 %s，新增IT %d，累计 %d）"
                  % (p + 1, len(items), oldest, page_fresh, fresh))
            if oldest < since:
                break
            time.sleep(SLEEP_S)
        time.sleep(SLEEP_S)

    existing.sort(key=lambda x: x["date"], reverse=True)
    out = {
        "source": "search.ccgp.gov.cn",
        "updated_at": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(existing),
        "items": existing,
    }
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("完成，新增IT %d 条，共 %d 条 -> %s" % (fresh, len(existing), OUT))


if __name__ == "__main__":
    main()
