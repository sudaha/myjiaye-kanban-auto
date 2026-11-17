# -*- coding: utf-8 -*-
"""央采主站「WAF 窗口猎手」：每 3 分钟探一次 API，窗口一开就连续抓页，
窗口关闭则保存进度等下一窗口；支持断点续抓（cursor 文件）。总上限 2 小时。

接口 WAF 只开短暂放行窗口（单发探测能过、连发被拒），
所以策略 = 慢探测 + 快收割 + 每页落盘。
"""
import datetime as dt
import io
import json
import os
import re
import time

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "data", "zycgmain_items.json")
CURSOR = os.path.join(BASE, "data", "zycgmain_cursor.json")
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


def save(existing):
    existing.sort(key=lambda x: x["date"], reverse=True)
    out = {
        "source": "zycg.gov.cn main site",
        "updated_at": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(existing),
        "items": existing,
    }
    tmp = OUT + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    os.replace(tmp, OUT)


def load_cursor():
    if os.path.isfile(CURSOR):
        return json.load(io.open(CURSOR, encoding="utf-8")).get("last_page", 0)
    return 0


def save_cursor(n):
    with io.open(CURSOR, "w", encoding="utf-8") as f:
        json.dump({"last_page": n}, f)


def main():
    days = 45
    since = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    existing = load_existing()
    known = set(it["id"] for it in existing)
    deadline = time.time() + 2 * 3600
    print("窗口: %s 起，库内已有 %d 条，断点 %d 页，上限 %s"
          % (since, len(existing), load_cursor(),
             dt.datetime.fromtimestamp(deadline).strftime("%H:%M")))

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        ctx = browser.new_context()
        page = ctx.new_page()

        def warmup():
            page.goto(PAGE_URL, timeout=60000)
            page.wait_for_timeout(8000)

        def api_page(n):
            try:
                raw = page.evaluate(
                    "(u)=>fetch(u,{headers:{'X-Requested-With':'XMLHttpRequest'}}).then(r=>r.text())",
                    API % n)
                d = json.loads(raw)
                if d.get("code") == "200":
                    return d
            except Exception:
                pass
            return None

        done = False
        while not done and time.time() < deadline:
            start_n = load_cursor() + 1
            warmup()
            d = api_page(start_n)
            if d is None:
                print("%s 窗口未开（第%d页探测被拒），等 3 分钟…"
                      % (dt.datetime.now().strftime("%H:%M:%S"), start_n))
                time.sleep(180)
                continue
            print("%s 窗口开了！total=%s，从第 %d 页连抓…"
                  % (dt.datetime.now().strftime("%H:%M:%S"), d.get("total"), start_n))
            n = start_n
            while time.time() < deadline:
                rows = d.get("data") or []
                if not rows:
                    break
                oldest = rows[-1]["addtimeStr"][:10]
                fresh_n = 0
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
                    fresh_n += 1
                print("  第%d页: %d 条（最旧 %s，新增IT %d，累计 %d）"
                      % (n, len(rows), oldest, fresh_n, len(existing)))
                save(existing)
                save_cursor(n)
                if oldest < since:
                    done = True
                    break
                n += 1
                time.sleep(3)
                d = api_page(n)
                if d is None:
                    print("  窗口在第 %d 页关闭，进度已存（断点 %d 页），等 3 分钟再探"
                          % (n, load_cursor()))
                    time.sleep(180)
                    break
            else:
                # 到时间上限
                break
        save(existing)
        browser.close()
    print("结束：库内共 %d 条 -> %s" % (len(existing), OUT))


if __name__ == "__main__":
    main()
