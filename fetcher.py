# -*- coding: utf-8 -*-
"""央采电子询价抓取器（纯标准库，免登录 HTTP）。
列表: queryEnquiryOnlineAndNoticePageList (queryFlag=0 需求公告)
详情: queryMallNoticeById
PDF : zycgdzmc-pro.obs.cn-north1.ctyun.cn (公网, 不限IP)
"""
import os
import re
import json
import time
import urllib.request
import urllib.error

import db

BASE = "https://mkt.zycg.gov.cn"
LIST_URL = (BASE + "/proxy/platform-service/platform/notice/"
            "queryEnquiryOnlineAndNoticePageList?platformId=20&queryFlag={flag}"
            "&yn=1&publish=1&pageSize={ps}&pageNum={pn}")
DETAIL_URL = BASE + "/proxy/platform-service/platform/notice/queryMallNoticeById?platformId=20&id={nid}"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
TIMEOUT = 25


def _norm_pub_date(v):
    """接口对部分公告把发布日期返回为 unix 时间戳（10 位），统一转成北京时间 'YYYY-MM-DD HH:MM'，
    否则 3 日期窗口/日历/排序全部错乱（'179...' 字符串排序永远排在 '2026...' 前）。"""
    s = str(v or "").strip()
    if s.isdigit() and len(s) in (9, 10, 13):
        import datetime
        ts = int(s[:10])
        return datetime.datetime.fromtimestamp(
            ts, datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
    return s


def http_get_json(url, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA,
                                                       "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                raw = r.read().decode("utf-8", "ignore")
            return json.loads(raw)
        except Exception as e:  # noqa
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def list_page(flag, page_num, page_size=200):
    """取一页列表。

    注意：该接口忽略 pageNum（永远从第 1 条开始返回），totalCount 恒为 0，
    只按 pageSize 截断。因此必须用足够大的 pageSize 一次取全，
    不能靠翻页拿第二页（pageNum=2 会返回空数组）。
    """
    d = http_get_json(LIST_URL.format(flag=flag, ps=page_size, pn=page_num))
    data = d.get("data") or {}
    return data.get("result") or []


def _as_list(v):
    """brands/models 可能是 list 或 str，统一成去空字符串列表。"""
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        return [str(x).strip() for x in v if str(x).strip()]
    s = str(v).strip()
    return [s] if s else []


def _is_end(end_time):
    """按截止时间与当前时间比较判定 是否已截止。"""
    if not end_time:
        return 0
    import datetime
    try:
        et = datetime.datetime.strptime(str(end_time)[:19], "%Y-%m-%d %H:%M:%S")
        return 1 if et < datetime.datetime.now() else 0
    except Exception:
        return 0


def fetch_detail(nid):
    d = http_get_json(DETAIL_URL.format(nid=nid))
    data = d.get("data") or {}
    obj = data.get("contentObj") or {}
    atts = obj.get("attchList") or []
    pdf_url = None
    pdf_created = None  # 询价通知书 PDF 的生成日期 = 标书落款发标日期（已验证 82/82 与 PDF 印刷日期一致）
    for a in atts:
        fu = a.get("fileUrl") or ""
        if fu.lower().endswith(".pdf"):
            pdf_url = fu if fu.startswith("http") else ("https:" + fu if fu.startswith("//") else fu)
            pdf_created = str(a.get("created") or "")[:10]
            break
    prods_raw = obj.get("productNoticeVoList") or []
    prods = []
    all_brands = []
    for p in prods_raw:
        bp = _as_list(p.get("brands"))
        mp = _as_list(p.get("models"))
        for b in bp:
            if b not in all_brands:
                all_brands.append(b)
        np = dict(p)
        np["brands"] = ",".join(bp)
        np["models"] = ",".join(mp)
        prods.append(np)
    return {
        "id": int(nid),
        "enquiry_no": obj.get("enquiryNo") or obj.get("billCode") or data.get("enquiryNo"),
        "title": data.get("noticeTitle") or obj.get("noticeTitle"),
        "enquiry_name": obj.get("enquiryName") or data.get("enquiryName"),
        "org_name": obj.get("orgName") or obj.get("purchaseCompany") or data.get("orgName"),
        "purchase_company": obj.get("purchaseCompany") or obj.get("orgName") or data.get("orgName"),
        "budget_amount": obj.get("budgetAmount"),
        "end_time": obj.get("endTimeStr") or obj.get("endTime"),
        # 发标日期优先取询价通知书 PDF 落款日（attchList.created），缺省才退回平台上架时间
        "publish_date": _norm_pub_date(pdf_created or data.get("shortPublistTime") or obj.get("shortPublistTime")),
        "is_end": None,  # run_fetch 依据 end_time 计算
        "products": prods,
        "brands": ",".join(all_brands),
        "pdf_url": pdf_url,
    }


def categorize(title, prods):
    """按标题 + 首个品目品类归类。与既有口径一致。"""
    t = title or ""
    c0 = (prods[0].get("categoryName") or "") if prods else ""
    c1 = (prods[0].get("productName") or "") if prods else ""
    text = t + c0 + c1
    if "服务器" in text:
        return "服务器"
    if any(k in text for k in ("存储", "NAS", "对象存储", "磁盘阵列", "SAN")):
        return "存储"
    if "视频会议" in text or "音频系统" in text:
        return "视频会议"
    if "打印" in text or "复印" in text or "多功能一体机" in text:
        return "打印机"
    if any(k in text for k in ("防火墙", "WAF", "零信任", "堡垒机", "安全网关", "入侵", "态势感知")):
        return "网络安全"
    if any(k in text for k in ("交换机", "路由器", "计算机网络设备", "无线AP", "负载均衡", "网络存储", "网关", "DNS")):
        return "网络"
    if any(k in text for k in ("台式计算机", "台式电脑", "笔记本", "便携式", "一体机", "云桌面", "计算机")):
        return "计算机"
    return "其他"


def download_pdf(url, save_dir, nid, retries=3):
    if not url:
        return None
    os.makedirs(save_dir, exist_ok=True)
    dst = os.path.join(save_dir, "%s.pdf" % nid)
    if os.path.exists(dst) and os.path.getsize(dst) > 20000:
        return dst
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            if data[:4] == b"%PDF" and len(data) > 5000:
                with open(dst, "wb") as f:
                    f.write(data)
                return dst
            last = "bad pdf (%d bytes)" % len(data)
        except Exception as e:  # noqa
            last = str(e)
        time.sleep(2 * (i + 1))
    if last:
        print("  [warn] pdf %s: %s" % (nid, last))
    return dst if (os.path.exists(dst) and os.path.getsize(dst) > 20000) else None


def _iter_new_items(db_file, flag, seed_days, max_pages=6, page_size=500):
    """产出候选列表条目。

    原实现按 id > max_notice_id 增量，会永久漏掉"同日更晚发布但 id 更小"的公告
    （例如 11-16 当天发布了 26 条，只入库了 id 最大的 15 条，剩下 11 条再也补不回来）。
    现改为：按发布日期窗口取全量，再由 run_fetch 用"是否已在库"过滤。
    接口本身不翻页（pageNum 无效），所以第一次用大 pageSize 一次取全。
    """
    import datetime
    cutoff = (datetime.date.today() - datetime.timedelta(days=seed_days)).isoformat()
    first_run = db.max_notice_id(db_file) == 0
    items, seen = [], set()
    for pn in range(1, max_pages + 1):
        rows = list_page(flag, pn, page_size)
        if not rows:
            break
        for r in rows:
            try:
                rid = int(r.get("id"))
            except Exception:
                continue
            pub = (r.get("shortPublistTime") or "")[:10]
            if pub and pub < cutoff:
                continue
            if rid in seen:
                continue
            seen.add(rid)
            items.append(r)
        # 接口不认 pageNum：拿到的条数不足 pageSize 说明已经到底
        if len(rows) < page_size:
            break
    return items, first_run


def run_fetch(db_file, pdf_dir, flag=0, seed_days=14, verbose=True):
    """一次抓取：列出新增 -> 详情 -> 分类 -> 下PDF -> 入库。返回新增条数。"""
    new_items, first_run = _iter_new_items(db_file, flag, seed_days)
    existing = db.list_ids(db_file)
    todo = [r for r in new_items if int(r.get("id", 0)) not in existing]
    if verbose:
        print("[fetch] %s, 列表候选 %d, 新增待抓详情 %d" %
              ("首抓%d天" % seed_days if first_run else "增量", len(new_items), len(todo)))
    added = 0
    max_id = db.max_notice_id(db_file)
    for r in todo:
        nid = r.get("id")
        try:
            d = fetch_detail(nid)
        except Exception as e:  # noqa
            print("  [warn] detail %s: %s" % (nid, e))
            # 仅用列表信息兜底入库
            d = {
                "id": int(nid), "enquiry_no": r.get("enquiryNo"), "title": r.get("noticeTitle"),
                "enquiry_name": r.get("enquiryName"), "org_name": r.get("orgName"),
                "purchase_company": r.get("orgName"), "budget_amount": r.get("budgetAmount"),
                "end_time": r.get("endTime"), "publish_date": _norm_pub_date(r.get("shortPublistTime")),
                "is_end": 1 if r.get("end") in (True, "true", 1) else 0,
                "products": [], "brands": "", "pdf_url": None,
            }
        # 用列表行字段兜底/补全（列表的 enquiry_no/org/end 更可靠）
        d["enquiry_no"] = d.get("enquiry_no") or r.get("enquiryNo")
        d["title"] = d.get("title") or r.get("noticeTitle")
        d["enquiry_name"] = d.get("enquiry_name") or r.get("enquiryName")
        d["org_name"] = d.get("org_name") or r.get("orgName")
        d["purchase_company"] = d.get("purchase_company") or r.get("orgName")
        d["budget_amount"] = d.get("budget_amount") or r.get("budgetAmount")
        d["end_time"] = d.get("end_time") or r.get("endTime")
        d["publish_date"] = d.get("publish_date") or _norm_pub_date(r.get("shortPublistTime"))
        # 状态：优先按截止时间；无时间则回退列表 end 字段
        if d.get("is_end") in (None,):
            d["is_end"] = _is_end(d.get("end_time")) if d.get("end_time") else (
                1 if r.get("end") in (True, "true", 1) else 0)
        prods = d.get("products") or []
        d["category"] = categorize(d.get("title"), prods)
        pdf_local = None
        if d.get("pdf_url"):
            pdf_local = download_pdf(d["pdf_url"], pdf_dir, nid)
            d["pdf_local"] = os.path.basename(pdf_local) if pdf_local else None
        # API 的 specification 只含“其他技术指标要求”，会漏掉 PDF 表格中的“商品属性要求”。
        # 新公告入库前必须用 PDF 完整技术要求回填；有品目但 PDF 不可用/不一致时不允许伪装完整。
        if prods and pdf_local:
            from pdf_requirements import enrich_products_from_pdf, extract_pdf_requirements
            pdf_items = extract_pdf_requirements(pdf_local)
            prods, req_audit = enrich_products_from_pdf(prods, pdf_items)
            if len(pdf_items) != len(prods) or any(not x.get("complete") for x in req_audit):
                raise RuntimeError("PDF技术要求回填失败: API品目%d/PDF品目%d" % (len(prods), len(pdf_items)))
        elif prods:
            for p in prods:
                p["specification_api"] = p.get("specification") or ""
                p["requirements_source"] = "api_only"
                p["requirements_complete"] = False
        d["products"] = prods
        d["products_json"] = json.dumps(prods, ensure_ascii=False)
        d["detail_fetched"] = 1
        db.upsert_announcement(db_file, d)
        if int(nid) > max_id:
            max_id = int(nid)
        added += 1
        if verbose:
            print("  + %s | %s | %s | %s" % (nid, d.get("publish_date"),
                                              d.get("category"), (d.get("title") or "")[:30]))
        time.sleep(0.6)
    # 官网列表 = 当前进行中询价集合（2026-11-23 接口语义）：成功抓到非空列表时，
    # 库内仍标进行中但已不在列表的条目判为已结束/撤项，保证站点与官网口径一致。
    # 首抓或列表为空（接口异常）不动状态，防误标。
    if new_items and not first_run:
        live_ids = {int(r["id"]) for r in new_items if r.get("id") is not None}
        if live_ids:
            con = db.connect(db_file)
            cur = con.cursor()
            ph = ",".join("?" * len(live_ids))
            res = cur.execute(
                "UPDATE announcements SET is_end = 1 WHERE is_end = 0 AND id NOT IN (%s)" % ph,
                sorted(live_ids))
            con.commit()
            con.close()
            if verbose and res.rowcount:
                print("[fetch] 复核结束/撤项 %d 条（已不在官网进行中列表）" % res.rowcount)
    # 官网列表 shortPublistTime = 进行中集合的上架日期（2026-11-23 起接口语义，通常=抓取当天）。
    # 落 meta 供导出"最新日期"用，站点口径与官网页面显示一致（条目本身仍保留原始发标日期）。
    if new_items:
        dates = [(_norm_pub_date(r.get("shortPublistTime")) or "")[:10] for r in new_items]
        dates = [d for d in dates if d]
        if dates:
            db.set_meta(db_file, "mkt_list_latest", max(dates))
    # 「新项目」标注：当前进行中集合 vs 上次快照 → 新出现的项目；首次运行（无快照）视为
    # 当前列表整体为新（相对用户上次看到的冻结看板）。当日结果累积写 data/new_ids.json，
    # 导出按 date=当天 读取，「新」标整天有效、次日自动清除。
    if new_items:
        cur_ids = {str(r["id"]) for r in new_items if r.get("id") is not None}
        prev_snap = None
        try:
            c2 = db.connect(db_file)
            row = c2.execute("SELECT v FROM meta WHERE k = 'in_prog_ids'").fetchone()
            c2.close()
            if row and row[0]:
                prev_snap = set(json.loads(row[0]))
        except Exception:
            prev_snap = None
        diff = cur_ids - prev_snap if prev_snap is not None else cur_ids
        db.set_meta(db_file, "in_prog_ids", json.dumps(sorted(cur_ids)))
        nd_file = os.path.join(os.path.dirname(db_file) or ".", "new_ids.json")
        today_s = time.strftime("%Y-%m-%d")
        try:
            with open(nd_file, encoding="utf-8") as fh:
                nd = json.load(fh)
        except Exception:
            nd = {}
        if isinstance(nd, dict) and nd.get("date") == today_s:
            nd["ids"] = sorted(set(nd.get("ids") or []) | diff)
        else:
            nd = {"date": today_s, "ids": sorted(diff)}
        with open(nd_file, "w", encoding="utf-8") as fh:
            json.dump(nd, fh, ensure_ascii=False)
        if verbose and diff:
            shown = ", ".join(sorted(diff)[:8]) + ("..." if len(diff) > 8 else "")
            print("[fetch] 新增进行中 %d 条: %s" % (len(diff), shown))
    db.set_meta(db_file, "max_notice_id", max_id)
    db.set_meta(db_file, "last_fetch", time.strftime("%Y-%m-%d %H:%M:%S"))
    if verbose:
        print("[fetch] 完成，新增入库 %d 条" % added)
    return added


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    db_file = os.path.join(here, "data", "board.db")
    pdf_dir = os.path.join(here, "data", "pdfs")
    db.init_db(db_file)
    run_fetch(db_file, pdf_dir)
