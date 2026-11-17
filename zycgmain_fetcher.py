# -*- coding: utf-8 -*-
"""央采主站（www.zycg.gov.cn）招标/征求/更正公告抓取器。

接口 selectInfoMore.do 有 WAF 防护（Python/curl/tls-client 均被拒），
实测可用配方：playwright channel="chrome"（真实 Chrome）+ headless + 页面加载后等 8 秒再调 API。

- 列表：selectInfoMore.do（noticeType=1,2,3,31,32,52,57,61，implementWay=1 必填）
- 条目：{title, addtimeStr, pageurl, id}
- IT 硬件标题过滤后输出 data/zycgmain_items.json（按 id 去重合并）

用法：
    python zycgmain_fetcher.py --days 45   # 首次播种（约38页x50条）
    python zycgmain_fetcher.py --days 3    # 日常增量
"""
import argparse
import datetime as dt
import io
import json
import os
import re
import time

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "data", "zycgmain_items.json")
SITE_ID = "6f5243ee-d4d9-4b69-abbd-1e40576ccd7d"
CHANNEL = "d0e7c5f4-b93e-4478-b7fe-61110bb47fd5"
PAGE_URL = "https://www.zycg.gov.cn/freecms/site/zygjjgzfcgzx/cggg/index.html"
API = ("https://www.zycg.gov.cn/freecms/rest/v1/notice/selectInfoMore.do?&siteId=%s"
       "&channel=%s&currPage=%%d&pageSize=50&title=&implementWay=1"
       "&noticeType=1,2,3,31,32,52,57,61" % (SITE_ID, CHANNEL))

IT_CTX = re.compile(
    r"服务器|台式|笔记本|计算机|电脑|PC|工作站|一体机|交换机|路由器|防火墙|网关|"
    r"存储|磁盘|NAS|GPU|算力|数据中心|信创|网络|终端|桌面|机房|云平台|虚拟化|IT|软硬件|信息化", re.I)
EXCLUDE = re.compile(
    r"液体|激光|探针|化学|生物|医学|医疗|实验|检测|仪器|食品|配送|保安|物业|空调|"
    r"电梯|装修|工程|设计|咨询|印刷|出版|运输|车辆|园林|绿化|清洁|劳务|保险|审计服务|"
    r"服装|家具|图书|教学设备|体育|艺术|美术|工作室")


def is_it(title):
    return bool(IT_CTX.search(title)) and not EXCLUDE.search(title)


def load_existing():
    if os.path.isfile(OUT):
        d = json.load(io.open(OUT, encoding="utf-8"))
        return d.get("items", [])
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3, help="回溯天数（首次 45，日常 3）")
    ap.add_argument("--max-pages", type=int, default=60)
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    existing = load_existing()
    known = set(it["id"] for it in existing)
    since = (dt.date.today() - dt.timedelta(days=args.days)).isoformat()
    print("央采主站抓取窗口: %s 起" % since)

    fresh = 0
    stopped = False
    with sync_playwright() as p:
        # channel=chrome：真实 Chrome 指纹；页面加载后必须等 8 秒（WAF 要求监控 JS 跑完）
        browser = p.chromium.launch(channel="chrome", headless=True)
        ctx = browser.new_context()
        page = ctx.new_page()

        def warmup():
            page.goto(PAGE_URL, timeout=60000)
            page.wait_for_timeout(8000)

        def api_call(n, tries=3):
            """调列表 API；WAF 偶发拒绝时重新开页预热再试。"""
            for t in range(tries):
                js = ("fetch(%s, {headers:{'X-Requested-With':'XMLHttpRequest'}})"
                      ".then(r=>r.text())" % json.dumps(API % n))
                try:
                    raw = page.evaluate(js)
                    d = json.loads(raw)
                    if d.get("code") == "200":
                        return d
                    print("第%d页 API 拒绝（%s），重新预热后重试 %d/3 …"
                          % (n, d.get("msg"), t + 1))
                except Exception as e:
                    print("第%d页 请求异常 %s，重试 %d/3 …" % (n, str(e)[:40], t + 1))
                time.sleep(15)
                warmup()
            return None

        warmup()
        time.sleep(20)  # 初始退避：避免触发/处于 WAF 冷却期
        for n in range(1, args.max_pages + 1):
            d = api_call(n)
            if d is None:
                print("第%d页 连续失败，停止" % n)
                break
            rows = d.get("data") or []
            if not rows:
                break
            page_fresh = 0
            oldest = rows[-1]["addtimeStr"][:10]
            for it in rows:
                aid = it.get("id")
                if aid in known:
                    continue
                title = it.get("title", "")
                if not is_it(title):
                    continue
                known.add(aid)
                existing.append({
                    "id": aid,
                    "title": title,
                    "date": it.get("addtimeStr", ""),
                    "url": "https://www.zycg.gov.cn" + it.get("pageurl", ""),
                    "source": "zycg-main",
                })
                page_fresh += 1
            fresh += page_fresh
            print("第%d页 %d 条（最旧 %s，新增IT %d，累计 %d）"
                  % (n, len(rows), oldest, page_fresh, fresh))
            if oldest < since:
                stopped = True
                break
            page.wait_for_timeout(800)
        browser.close()

    existing.sort(key=lambda x: x["date"], reverse=True)
    out = {
        "source": "zycg.gov.cn main site",
        "updated_at": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(existing),
        "items": existing,
    }
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("完成：库内共 %d 条（本次新增 %d）%s -> %s"
          % (len(existing), fresh, "（已到窗口边界）" if stopped else "",
             os.path.relpath(OUT, BASE)))


if __name__ == "__main__":
    main()
