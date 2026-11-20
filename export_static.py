# -*- coding: utf-8 -*-
"""把央采（board.db）+ 保利（poly_items.json）导出成双平台纯静态站点。

产物：
    index.html / style.css / extra.css / app.js
    data/zycg/{list,status,categories}.json, data/zycg/detail/<id>.json
    data/poly/{list,status,categories}.json, data/poly/detail/<id>.json
    pdf/zycg/*.pdf, pdf/poly/*.pdf
    manifest.json

用法： python export_static.py [输出目录]
"""
import datetime
import hashlib
import json
import os
import shutil
import sqlite3
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE, "data", "board.db")
ZYCG_PDF = os.path.join(BASE, "data", "pdfs")
POLY_JSON = os.path.join(BASE, "data", "poly_items.json")
POLY_PDF = os.path.join(BASE, "data", "poly_pdfs")
RAIL_JSON = os.path.join(BASE, "data", "rail_items.json")
WEB = os.path.join(BASE, "web")
STATIC_SRC = os.path.join(BASE, "static_src")

LIST_FIELDS = ["id", "title", "enquiry_name", "org_name", "purchase_company",
               "budget_amount", "budget_num", "end_time", "publish_date",
               "category", "brands", "is_end", "enquiry_no", "platform"]


def money(v):
    try:
        return round(float(v), 2)
    except Exception:
        return None


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def build_index_html():
    """静态化模板：相对路径 + 资源加版本号（避免旧缓存） + 去掉手动刷新按钮。"""
    stamp = datetime.datetime.now().strftime("%Y%m%d%H%M")
    with open(os.path.join(WEB, "index.html"), "r", encoding="utf-8") as f:
        html = f.read()
    html = html.replace('href="/style.css"', 'href="style.css?v=%s"' % stamp)
    html = html.replace('href="/extra.css"', 'href="extra.css?v=%s"' % stamp)
    html = html.replace('src="/app.js"', 'src="app.js?v=%s"' % stamp)
    for js in ("jszip.min.js", "docs.js", "docs_v3.js"):
        html = html.replace('src="/%s"' % js, 'src="%s?v=%s"' % (js, stamp))
    lines = [ln for ln in html.splitlines() if 'id="f-refresh"' not in ln]
    return "\n".join(lines) + "\n"


HEADERS = """/index.html
  Cache-Control: no-store, no-cache, must-revalidate, max-age=0
  CDN-Cache-Control: no-store
  Cloudflare-CDN-Cache-Control: no-store
  Pragma: no-cache
  Expires: 0

/
  Cache-Control: no-store, no-cache, must-revalidate, max-age=0
  CDN-Cache-Control: no-store
  Cloudflare-CDN-Cache-Control: no-store
  Pragma: no-cache
  Expires: 0

/data/*
  Cache-Control: no-cache, must-revalidate, max-age=0

/pdf/*
  Cache-Control: public, max-age=86400

/ocr/*
  Cache-Control: public, max-age=604800

"""


# ---------------- 央采 ----------------
_WT_CATS = [
    ("服务器", ("服务器", "算力", "小型机", "刀片")),
    ("台式机", ("台式", "计算机", "电脑", "PC", "终端", "工作站")),
    ("笔记本", ("笔记本", "便携")),
    ("网络", ("交换机", "路由器", "网关", "网络设备")),
    ("网络安全", ("防火墙", "入侵", "安全网关", "堡垒机", "日志审计", "上网行为")),
    ("存储", ("存储", "磁盘阵列", "NAS", "硬盘", "备份一体机", "磁带库")),
    ("视频会议", ("视频会议", "会议系统", "音视频")),
]


def _weituo_category(title):
    for cat, words in _WT_CATS:
        if any(w in title for w in words):
            return cat
    return "信息技术"


def _load_weituo_items():
    """单独委托项目：来自 data/zycgmain_items.json（zycgmain_fetcher.py 已筛 IT 硬件）。"""
    p = os.path.join(BASE, "data", "zycgmain_items.json")
    if not os.path.isfile(p):
        return []
    try:
        d = json.load(open(p, encoding="utf-8"))
    except Exception:
        return []
    out = []
    for it in d.get("items") or []:
        title = it.get("title") or ""
        if not title:
            continue
        out.append({
            "id": "wt-%s" % it.get("id", md5hex(it.get("url") or "")[:16]),
            "platform": "zycg", "source": "委托",
            "title": title,
            "org_name": it.get("buyer") or "",
            "purchase_company": it.get("buyer") or "",
            "budget_amount": None, "budget_num": None,
            "end_time": "", "publish_date": (it.get("date") or "").replace(".", "-"),
            "pub_date": (it.get("date") or "").replace(".", "-"),
            "category": _weituo_category(title),
            "brands": "", "is_end": 0,
            "enquiry_no": "", "has_pdf": False, "pdf_path": None,
            "url": it.get("url") or "",
            "notice_type": it.get("notice_type") or "",
            "is_new": False,
        })
    return out


def export_zycg(out):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM announcements ORDER BY id DESC").fetchall()
    meta = {}
    try:
        for r in conn.execute("SELECT key, value FROM meta"):
            meta[r["key"]] = r["value"]
    except Exception:
        pass
    items = []
    raw = {}
    for r in rows:
        d = dict(r)
        budget = money(d.get("budget_amount"))
        local = d.get("pdf_local")
        has_pdf = bool(local) and os.path.isfile(os.path.join(ZYCG_PDF, local))
        try:
            products = json.loads(d.get("products_json") or "[]")
        except Exception:
            products = []
        # 发布门禁：有品目的央采公告必须已由 PDF 回填完整技术要求。
        # 任何一项不完整时立即阻断构建，禁止把缺失商品属性的站点发布出去。
        incomplete = [p for p in products if not p.get("requirements_complete") or
                      not p.get("technical_requirements_full")]
        if incomplete:
            names = ", ".join((p.get("productName") or "未命名") for p in incomplete[:3])
            raise RuntimeError("公告 %s 技术要求未完整采集（%d项）：%s；请先运行 backfill_pdf_requirements.py --strict" %
                               (d["id"], len(incomplete), names))
        raw[d["id"]] = {"d": d, "products": products,
                        "pdf_local": local if has_pdf else None,
                        "pdf_path": ("pdf/zycg/" + local) if has_pdf else None}
        items.append({
            "id": d["id"], "platform": "zycg", "source": "询价",
            "title": d["title"], "enquiry_name": d["enquiry_name"],
            "org_name": d["org_name"], "purchase_company": d["purchase_company"],
            "budget_amount": d["budget_amount"], "budget_num": budget,
            "end_time": d["end_time"], "publish_date": d["publish_date"],
            "pub_date": (d.get("pub_date") or ""),
            "category": d["category"], "brands": d["brands"],
            "is_end": d["is_end"], "enquiry_no": d["enquiry_no"],
            "has_pdf": has_pdf,
            "pdf_path": ("pdf/zycg/" + local) if has_pdf else None,
        })
    # 只保留最近 3 个发布日期的全部条目，更早的不上网页（2026-11-17 用户要求，随同步滚动）
    days = sorted({(it["pub_date"] or it["publish_date"] or "")[:10] for it in items if (it["pub_date"] or it["publish_date"])},
                  reverse=True)
    keep_days = set(days[:3])
    items = [it for it in items
             if (it["pub_date"] or it["publish_date"] or "")[:10] in keep_days]

    # 「新」标注：发布日期 = 今天（北京时间）的条目整天标新，次日导出自动取消
    today_bj = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).strftime("%Y-%m-%d")

    def day_of(it):
        return (it["pub_date"] or it["publish_date"] or "")[:10]

    new_ids = {it["id"] for it in items if day_of(it) == today_bj}
    for it in items:
        it["is_new"] = it["id"] in new_ids
    new_days = sorted({day_of(it) for it in items if it["id"] in new_ids}, reverse=True)

    # 单独委托项目（央采主站 www.zycg.gov.cn 招标采购公告，IT 硬件已筛）并入央采子来源。
    items.extend(_load_weituo_items())

    for it in items:
        if it.get("source") == "委托":
            continue  # 单独委托项目无富详情/PDF，仅列表+原文链接
        rr = raw[it["id"]]
        d = rr["d"]
        write_json(os.path.join(out, "data", "zycg", "detail", "%s.json" % d["id"]), {
            "id": d["id"], "platform": "zycg",
            "title": d["title"], "enquiry_name": d["enquiry_name"],
            "org_name": d["org_name"], "purchase_company": d["purchase_company"],
            "budget_amount": d["budget_amount"], "budget_num": it["budget_num"],
            "end_time": d["end_time"], "publish_date": d["publish_date"],
            "pub_date": (d.get("pub_date") or ""),
            "category": d["category"], "brands": d["brands"], "is_end": d["is_end"],
            "enquiry_no": d["enquiry_no"], "pdf_url": d["pdf_url"],
            "pdf_path": rr["pdf_path"], "products": rr["products"],
        })
    conn.close()

    cats = []
    for it in items:
        if it["category"] and it["category"] not in cats:
            cats.append(it["category"])
    latest = max(((it["pub_date"] or it["publish_date"] or "") for it in items), default="")
    active = sum(1 for it in items if it["is_end"] == 0)

    write_json(os.path.join(out, "data", "zycg", "list.json"),
               {"total": len(items), "items": items})
    write_json(os.path.join(out, "data", "zycg", "categories.json"), {"categories": cats})
    date_counts = {}
    for it in items:
        dd = day_of(it)
        if dd:
            date_counts[dd] = date_counts.get(dd, 0) + 1
    write_json(os.path.join(out, "data", "zycg", "status.json"), {
        "platform": "zycg", "total": len(items), "active": active,
        "latest_date": latest[:10], "available_dates": date_counts,
        "new_count": len(new_ids), "new_days": new_days,
        "last_fetch": meta.get("last_fetch") or "",
        "refresh_seconds": 1800,
    })

    n = 0
    if os.path.isdir(ZYCG_PDF):
        dst = os.path.join(out, "pdf", "zycg")
        os.makedirs(dst, exist_ok=True)
        for it in items:
            if it.get("source") == "委托":
                continue
            name = raw[it["id"]]["pdf_local"]
            if name:
                shutil.copy2(os.path.join(ZYCG_PDF, name), os.path.join(dst, name))
                n += 1
    return len(items), n


# ---------------- 保利 ----------------
def classify_poly(d):
    """为保利项目补齐品类。数据源绝大多数 category 为空，按标题/采购范围/目录归类。"""
    original = (d.get("category") or "").strip()
    if original:
        return original
    text = " ".join(str(d.get(k) or "") for k in (
        "title", "scope", "catalog", "project_type", "pattern", "organize_form"
    ))
    rules = [
        ("信息技术", ("服务器", "台式机", "笔记本", "计算机", "网络设备", "交换机", "路由器",
                    "信息系统", "软件", "硬件", "等保", "网络安全", "数据中心", "在网运行设备")),
        ("工程施工", ("工程", "施工", "改造", "防水", "硬化", "拆除", "开采", "采剥", "爆破",
                    "销纳", "矿区", "装修", "建设")),
        ("运维维保", ("维保", "维修", "保养", "清洗", "运维")),
        ("租赁服务", ("租赁", "车辆租用", "用车", "大巴车")),
        ("宣传印刷", ("宣传", "推广", "图文", "印刷", "会刊", "海报", "新媒体")),
        ("设备物资", ("设备", "系统", "仪器", "工服", "工作服", "服装", "耗材", "物资", "锅炉")),
        ("专业服务", ("体检", "造价", "测评", "咨询", "采购代理", "劳务外包", "安保", "消防",
                    "餐饮", "工作餐", "酒店", "住宿", "会务", "票务", "综合服务包")),
    ]
    for category, words in rules:
        if any(w in text for w in words):
            return category
    return "其他服务"


def export_poly(out):
    if not os.path.isfile(POLY_JSON):
        return 0, 0
    with open(POLY_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)
    raw = data.get("items") or []
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    items = []
    for d in raw:
        # 网页只保留进行中项目，已截止的不上线（用户 2026-11-18 要求；数据源仍存全量）
        if (d.get("bid_end_time") or "") < now:
            continue
        pdf_files = [a for a in (d.get("attachments") or []) if a.get("local")]
        pdf_path = ("pdf/poly/" + pdf_files[0]["local"]) if pdf_files else None
        it = {
            "id": d["id"], "platform": "poly",
            "title": d.get("title") or "",
            "enquiry_name": d.get("title") or "",
            "org_name": d.get("tenderer") or "",
            "purchase_company": d.get("tenderer") or "",
            "budget_amount": d.get("budget"),
            "budget_num": money(d.get("budget")),
            "end_time": d.get("bid_end_time") or "",
            "publish_date": d.get("publish_date") or "",
            "category": classify_poly(d),
            "brands": "",
            "is_end": 0 if (d.get("bid_end_time") or "") >= now else 1,
            "enquiry_no": d.get("code") or "",
            "has_pdf": bool(pdf_path),
            "pdf_path": pdf_path,
            "it_hint": bool(d.get("it_hint")),
            "notice_type_name": d.get("notice_type_name") or "",
        }
        items.append(it)
        write_json(os.path.join(out, "data", "poly", "detail", "%s.json" % d["id"]), dict(
            it,
            scope=d.get("scope") or "",
            contact_person=d.get("contact_person") or "",
            contact_phone=d.get("contact_phone") or "",
            catalog=d.get("catalog") or "",
            pattern=d.get("pattern") or "",
            organize_form=d.get("organize_form") or "",
            project_type=d.get("project_type") or "",
            pdf_path=pdf_path,
            attachments=[{"name": a.get("name"), "local": a.get("local"),
                          "size": a.get("size"), "url": a.get("url")}
                         for a in (d.get("attachments") or [])],
            source_url="https://gyl.poly.com.cn/web-portal/#/trade-info-detail?id=%s&noticeType=%s"
                       % (d["id"], d.get("notice_type") or 1),
        ))

    cats = sorted({x["category"] for x in items if x["category"]})
    active = len([x for x in items if x["is_end"] == 0])
    latest = max([x["publish_date"] for x in items if x["publish_date"]] or [""])

    # 「新」标注：与央采同规则（发布日期 = 今天北京时间 整天标新）
    today_bj_p = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).strftime("%Y-%m-%d")

    def pday(it):
        return (it["publish_date"] or "")[:10]

    new_poly = {it["id"] for it in items if pday(it) == today_bj_p}
    for it in items:
        it["is_new"] = it["id"] in new_poly
    new_days_p = sorted({pday(it) for it in items if it["id"] in new_poly}, reverse=True)

    write_json(os.path.join(out, "data", "poly", "list.json"),
               {"total": len(items), "items": items})
    write_json(os.path.join(out, "data", "poly", "categories.json"), {"categories": cats})
    date_counts_p = {}
    for it in items:
        dd = pday(it)
        if dd:
            date_counts_p[dd] = date_counts_p.get(dd, 0) + 1
    write_json(os.path.join(out, "data", "poly", "status.json"), {
        "platform": "poly", "total": len(items), "active": active,
        "latest_date": latest, "available_dates": date_counts_p,
        "new_count": len(new_poly), "new_days": new_days_p,
        "last_fetch": data.get("updated_at") or "",
        "refresh_seconds": 3600,
    })

    n = 0
    if os.path.isdir(POLY_PDF):
        dst = os.path.join(out, "pdf", "poly")
        os.makedirs(dst, exist_ok=True)
        for name in sorted(os.listdir(POLY_PDF)):
            if name.lower().endswith(".pdf"):
                shutil.copy2(os.path.join(POLY_PDF, name), os.path.join(dst, name))
                n += 1
    return len(items), n


# ---------------- 国铁商城批采 / 国铁采购平台 ----------------
def export_rail(out):
    data = {"items": [], "updated_at": "", "source_status": {}}
    if os.path.isfile(RAIL_JSON):
        with open(RAIL_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
    # 合并已登录UKey/SSO后抓到的国铁商城批量采购专区数据。
    mall_path = os.path.join(BASE, "data", "rail_mall_items.json")
    mall_data = {"items": [], "updated_at": ""}
    if os.path.isfile(mall_path):
        with open(mall_path, "r", encoding="utf-8") as f:
            mall_data = json.load(f)
    merged = list(data.get("items") or []) + list(mall_data.get("items") or [])
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    items = []
    excluded_categories = {"一体机", "打印机", "打印扫描", "扫描仪"}
    for d in merged:
        end = d.get("bid_end_time") or ""
        is_mall = "mall.95306.cn" in (d.get("source") or "")
        # 国铁模块只展示当前可参与的核心IT硬件；已截止及打印扫描/一体机不导出到前端。
        if (d.get("category") or "") in excluded_categories:
            continue
        # 公开源 is_open 是采集时点的标记，导出时再按当前时间复核一次，防止快照里混入已截止项目
        end_ok = bool(end) and end >= now
        is_open = (is_mall and end_ok) or (not is_mall and d.get("is_open") == 1 and (not end or end_ok))
        if not is_open:
            continue
        # 两个来源 id 空间不同，加来源前缀避免碰撞；详情与卡片仍使用同一前缀ID。
        raw_id = str(d.get("uuid") or d.get("id") or "")
        source_prefix = "mall_" if "mall.95306.cn" in (d.get("source") or "") else "cg_"
        rid = source_prefix + raw_id
        it = {
            "id": rid, "source_id": raw_id, "platform": "rail",
            "title": d.get("title") or "", "enquiry_name": d.get("title") or "",
            "org_name": d.get("buyer") or "国铁采购单位（正文待识别）", "purchase_company": d.get("buyer") or "国铁采购单位（正文待识别）",
            "budget_amount": money(d.get("estimated_amount") or d.get("budget_amount")),
            "budget_num": money(d.get("estimated_amount") or d.get("budget_amount")),
            "end_time": "" if end in ("null", "None", None) else end, "publish_date": d.get("publish_date") or "",
            "category": d.get("category") or "其他", "brands": d.get("brand_scope") or "",
            "is_end": 0,
            "enquiry_no": d.get("project_code") or "", "has_pdf": False,
            "notice_type_name": d.get("notice_type_name") or "",
            "bid_type_name": d.get("bid_type_name") or "",
            "source": d.get("source") or "国铁采购平台",
            "source_access": d.get("source_access") or "",
        }
        if it["id"]:
            items.append(it)
            write_json(os.path.join(out, "data", "rail", "detail", it["id"] + ".json"), dict(
                it, detail_text=d.get("detail_text") or d.get("digest") or "",
                digest=d.get("digest") or "", brand_scope=d.get("brand_scope") or "",
                matched_keywords=d.get("matched_keywords") or [],
                project_type_name=d.get("project_type_name") or "",
                source_url=d.get("detail_url") or "",
                attachment_status=("商城批采详情已在登录态采集；附件以源站为准" if is_mall else "附件下载需登录国铁采购平台"),
                mall_category=d.get("mall_category") or "",
                brand_name_list=d.get("brand_name_list") or [],
                rounds=d.get("rounds"), attachments=d.get("attachments") or [],
            ))
    items.sort(key=lambda x: (x["publish_date"], x["id"]), reverse=True)
    cats = sorted({x["category"] for x in items if x["category"]})
    active = sum(1 for x in items if x["is_end"] == 0)
    latest = max([x["publish_date"] for x in items if x["publish_date"]] or [""])
    date_counts = {}
    for x in items:
        dd = (x["publish_date"] or "")[:10]
        if dd:
            date_counts[dd] = date_counts.get(dd, 0) + 1
    write_json(os.path.join(out, "data", "rail", "list.json"), {"total": len(items), "items": items})
    write_json(os.path.join(out, "data", "rail", "categories.json"), {"categories": cats})
    write_json(os.path.join(out, "data", "rail", "status.json"), {
        "platform": "rail", "total": len(items), "active": active,
        "latest_date": latest, "available_dates": date_counts,
        "new_count": 0, "new_days": [], "last_fetch": max(data.get("updated_at") or "", mall_data.get("updated_at") or ""),
        "source_status": {
            "cg95306": "公开可采集：无需key、无需登录；附件下载需登录",
            "mall95306_batch": "已用UKey/SSO登录态采集：无需API key；登录失效时沿用上次数据",
        }, "refresh_seconds": 86400,
    })
    return len(items), 0


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, "dist")
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out, exist_ok=True)

    n_zycg, p_zycg = export_zycg(out)
    n_poly, p_poly = export_poly(out)
    n_rail, p_rail = export_rail(out)

    with open(os.path.join(out, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(build_index_html())
    # Cloudflare Pages 缓存策略：HTML/数据不长缓存，PDF 长缓存
    with open(os.path.join(out, "_headers"), "w", encoding="utf-8", newline="\n") as f:
        f.write(HEADERS)
    for name in ("style.css", "extra.css"):
        src = os.path.join(WEB, name)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(out, name))
    shutil.copy2(os.path.join(STATIC_SRC, "app.js"), os.path.join(out, "app.js"))
    logo = os.path.join(WEB, "jiaye_logo.jpg")
    if os.path.isfile(logo):
        shutil.copy2(logo, os.path.join(out, "jiaye_logo.jpg"))

    for extra in ("jszip.min.js", "docs.js", "docs_v3.js"):
        src = os.path.join(STATIC_SRC, extra)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(out, extra))
    tpl_dir = os.path.join(WEB, "templates")
    if os.path.isdir(tpl_dir):
        dst_tpl = os.path.join(out, "templates")
        os.makedirs(dst_tpl, exist_ok=True)
        for fn in os.listdir(tpl_dir):
            shutil.copy2(os.path.join(tpl_dir, fn), os.path.join(dst_tpl, fn))
    # OCR 自托管资产（tesseract 核心 + 中英文模型）
    ocr_dir = os.path.join(WEB, "ocr")
    if os.path.isdir(ocr_dir):
        dst_ocr = os.path.join(out, "ocr")
        os.makedirs(dst_ocr, exist_ok=True)
        for fn in os.listdir(ocr_dir):
            shutil.copy2(os.path.join(ocr_dir, fn), os.path.join(dst_ocr, fn))

    # 选型助手机型库（央采卖场成交公告聚合）
    products_src = os.path.join(BASE, "data", "products.json")
    if os.path.isfile(products_src):
        write_json(os.path.join(out, "data", "products.json"),
                   json.load(open(products_src, encoding="utf-8")))
    # 已核验的具体型号公开规格与来源（选型助手用）
    specs_src = os.path.join(BASE, "data", "model_specs.json")
    if os.path.isfile(specs_src):
        write_json(os.path.join(out, "data", "model_specs.json"),
                   json.load(open(specs_src, encoding="utf-8")))

    # 成交公告原文缓存（站内弹层展示；央采 WAF 对外部 Referer 跨站跳转返回 403，
    # 服务端缓存正文可离线可读，见 fetch_mall_notices.py）
    notices_src = os.path.join(BASE, "data", "mall_notices.json")
    if os.path.isfile(notices_src):
        write_json(os.path.join(out, "data", "mall_notices.json"),
                   json.load(open(notices_src, encoding="utf-8")))

    # 成交结果库（中标公司+品牌+型号+单价/金额；供「参与投标记录」中标率与查漏补缺）。
    # 直接使用已生成的 data/deals.json（由 build_deals.py 生成、随仓库提交），
    # 不在导出时重建，避免 CI 缺 mall_deals.json（.gitignore）导致失败。
    deals_src = os.path.join(BASE, "data", "deals.json")
    if os.path.isfile(deals_src):
        write_json(os.path.join(out, "data", "deals.json"),
                   json.load(open(deals_src, encoding="utf-8")))

    # 官方成交结果严格匹配我方工商全称后，自动生成全站滚动喜报。
    try:
        import build_wins
        build_wins.main()
    except Exception as e:
        print("[warn] 喜报生成失败，沿用上次数据: %s" % e)
    wins_src = os.path.join(BASE, "data", "wins.json")
    if os.path.isfile(wins_src):
        write_json(os.path.join(out, "data", "wins.json"),
                   json.load(open(wins_src, encoding="utf-8")))

    if BID_SECTION:
        out, manifest = export_bid(out)
    else:
        manifest = {}
    total_size = sum(v["size"] for v in manifest.values())
    print("输出目录 : %s" % out)
    print("央采     : %d 条公告 / %d 份 PDF" % (n_zycg, p_zycg))
    print("保利     : %d 个项目 / %d 份 PDF" % (n_poly, p_poly))
    print("国铁批采 : %d 个项目（公开公告；商城批采需登录）" % n_rail)
    print("文件总数 : %d，总体积 %.2f MB" % (len(manifest), total_size / 1048576.0))


def md5hex(s):
    return hashlib.md5(s.encode("utf-8")).hexdigest()


# 「招标公告·新源」板块暂时下线（用户 2026-11-17 要求）；恢复时置 True
BID_SECTION = False


def export_bid(out):
    """招标公告（新源）：央采主站 + 中国政府采购网（央/地方），合并为一个板块。"""
    items = []
    for fname in ("zycgmain_items.json", "ccgp_items.json"):
        p = os.path.join(BASE, "data", fname)
        if not os.path.isfile(p):
            continue
        d = json.load(open(p, encoding="utf-8"))
        for it in d.get("items", []):
            if fname == "zycgmain_items.json":
                src = "央采主站"
            elif "/cggg/zygg/" in it.get("url", ""):
                src = "政采网·央"
            else:
                src = "政采网·地方"
            items.append({
                "id": "bid-%s" % it.get("id", md5hex(it.get("url", ""))[:16]),
                "title": it.get("title", ""),
                "org_name": it.get("buyer", ""),
                "agent": it.get("agent", ""),
                "notice_type": it.get("notice_type", ""),
                "region": it.get("region", ""),
                "publish_date": (it.get("date") or "").replace(".", "-"),
                "url": it.get("url", ""),
                "source": src,
                "it_hint": 1,
            })
    items.sort(key=lambda x: x["publish_date"], reverse=True)
    latest = items[0]["publish_date"][:10] if items else ""
    write_json(os.path.join(out, "data", "bid", "list.json"),
               {"total": len(items), "items": items})
    write_json(os.path.join(out, "data", "bid", "status.json"),
               {"total": len(items), "latest_date": latest,
                 "updated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
    print("data/bid: %d 条（央采主站+政采网）" % len(items))

    manifest = {}
    for root, _dirs, files in os.walk(out):
        for fn in files:
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, out).replace("\\", "/")
            if rel == "manifest.json":
                continue
            h = hashlib.sha1()
            with open(p, "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            manifest[rel] = {"size": os.path.getsize(p), "sha1": h.hexdigest()}
    write_json(os.path.join(out, "manifest.json"), {
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "files": manifest})

    return out, manifest


if __name__ == "__main__":
    main()
