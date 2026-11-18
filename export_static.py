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
    for js in ("jszip.min.js", "docs.js"):
        html = html.replace('src="/%s"' % js, 'src="%s?v=%s"' % (js, stamp))
    lines = [ln for ln in html.splitlines() if 'id="f-refresh"' not in ln]
    return "\n".join(lines) + "\n"


HEADERS = """/index.html
  Cache-Control: no-cache

/
  Cache-Control: no-cache

/data/*
  Cache-Control: no-cache

/pdf/*
  Cache-Control: public, max-age=86400

/*
  Cache-Control: public, max-age=600
"""


# ---------------- 央采 ----------------
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
        raw[d["id"]] = {"d": d, "products": products,
                        "pdf_local": local if has_pdf else None,
                        "pdf_path": ("pdf/zycg/" + local) if has_pdf else None}
        items.append({
            "id": d["id"], "platform": "zycg",
            "title": d["title"], "enquiry_name": d["enquiry_name"],
            "org_name": d["org_name"], "purchase_company": d["purchase_company"],
            "budget_amount": d["budget_amount"], "budget_num": budget,
            "end_time": d["end_time"], "publish_date": d["publish_date"],
            "pub_date": (d.get("pub_date") or ""),
            "category": d["category"], "brands": d["brands"],
            "is_end": d["is_end"], "enquiry_no": d["enquiry_no"],
            "has_pdf": has_pdf,
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

    for it in items:
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
    write_json(os.path.join(out, "data", "zycg", "status.json"), {
        "platform": "zycg", "total": len(items), "active": active,
        "latest_date": latest[:10],
        "new_count": len(new_ids), "new_days": new_days,
        "last_fetch": meta.get("last_fetch") or "",
        "refresh_seconds": 1800,
    })

    n = 0
    if os.path.isdir(ZYCG_PDF):
        dst = os.path.join(out, "pdf", "zycg")
        os.makedirs(dst, exist_ok=True)
        for it in items:
            name = raw[it["id"]]["pdf_local"]
            if name:
                shutil.copy2(os.path.join(ZYCG_PDF, name), os.path.join(dst, name))
                n += 1
    return len(items), n


# ---------------- 保利 ----------------
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
            "category": d.get("category") or "",
            "brands": "",
            "is_end": 0 if (d.get("bid_end_time") or "") >= now else 1,
            "enquiry_no": d.get("code") or "",
            "has_pdf": bool(pdf_path),
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
    write_json(os.path.join(out, "data", "poly", "status.json"), {
        "platform": "poly", "total": len(items), "active": active,
        "latest_date": latest,
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


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, "dist")
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out, exist_ok=True)

    n_zycg, p_zycg = export_zycg(out)
    n_poly, p_poly = export_poly(out)

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
    for extra in ("jszip.min.js", "docs.js"):
        src = os.path.join(STATIC_SRC, extra)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(out, extra))
    tpl_dir = os.path.join(WEB, "templates")
    if os.path.isdir(tpl_dir):
        dst_tpl = os.path.join(out, "templates")
        os.makedirs(dst_tpl, exist_ok=True)
        for fn in os.listdir(tpl_dir):
            shutil.copy2(os.path.join(tpl_dir, fn), os.path.join(dst_tpl, fn))

    # 选型助手机型库（央采卖场成交公告聚合）
    products_src = os.path.join(BASE, "data", "products.json")
    if os.path.isfile(products_src):
        write_json(os.path.join(out, "data", "products.json"),
                   json.load(open(products_src, encoding="utf-8")))

    if BID_SECTION:
        out, manifest = export_bid(out)
    else:
        manifest = {}
    total_size = sum(v["size"] for v in manifest.values())
    print("输出目录 : %s" % out)
    print("央采     : %d 条公告 / %d 份 PDF" % (n_zycg, p_zycg))
    print("保利     : %d 个项目 / %d 份 PDF" % (n_poly, p_poly))
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
