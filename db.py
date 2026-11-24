# -*- coding: utf-8 -*-
"""SQLite 数据层：央采电子询价公告的存储与查询（纯标准库）。"""
import os
import json
import sqlite3
import threading

_lock = threading.Lock()


def _path(db_file):
    return db_file


SCHEMA = """
CREATE TABLE IF NOT EXISTS announcements (
    id               INTEGER PRIMARY KEY,
    enquiry_no       TEXT,
    title            TEXT,
    enquiry_name     TEXT,
    org_name         TEXT,
    purchase_company TEXT,
    budget_amount    TEXT,
    end_time         TEXT,
    publish_date     TEXT,
    enquriy_state    INTEGER,
    is_end           INTEGER DEFAULT 0,
    category         TEXT,
    brands           TEXT,
    products_json    TEXT,
    pdf_url          TEXT,
    pdf_local        TEXT,
    detail_fetched   INTEGER DEFAULT 0,
    created_at       TEXT,
    updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_ann_date ON announcements(publish_date);
CREATE INDEX IF NOT EXISTS idx_ann_id ON announcements(id);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""


def connect(db_file):
    os.makedirs(os.path.dirname(db_file) or ".", exist_ok=True)
    conn = sqlite3.connect(db_file, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_file):
    with _lock, connect(db_file) as conn:
        conn.executescript(SCHEMA)
        conn.commit()


def get_meta(db_file, key, default=None):
    with _lock, connect(db_file) as conn:
        row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default


def set_meta(db_file, key, value):
    with _lock, connect(db_file) as conn:
        conn.execute(
            "INSERT INTO meta(key,value) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value)),
        )
        conn.commit()


def max_notice_id(db_file):
    v = get_meta(db_file, "max_notice_id", "0")
    try:
        return int(v)
    except Exception:
        return 0


def upsert_announcement(db_file, a):
    """a: dict with keys matching columns. Upsert by id."""
    cols = [
        "id", "enquiry_no", "title", "enquiry_name", "org_name", "purchase_company",
        "budget_amount", "end_time", "publish_date", "pub_date", "enquriy_state", "is_end",
        "category", "brands", "products_json", "pdf_url", "pdf_local", "detail_fetched",
        "created_at", "updated_at",
    ]
    now = a.get("updated_at") or _now()
    a["updated_at"] = now
    a.setdefault("created_at", now)
    with _lock, connect(db_file) as conn:
        placeholders = ", ".join("?" for _ in cols)
        # pub_date=首次上架日，只在插入时写入；冲突更新不得覆盖（否则每日抓取会把日期刷成当天）
        updates = ", ".join("%s=excluded.%s" % (c, c) for c in cols if c not in ("id", "pub_date"))
        sql = (
            "INSERT INTO announcements(%s) VALUES(%s) "
            "ON CONFLICT(id) DO UPDATE SET %s" % (", ".join(cols), placeholders, updates)
        )
        conn.execute(sql, [a.get(c) for c in cols])
        conn.commit()


def list_ids(db_file):
    with _lock, connect(db_file) as conn:
        return {r["id"] for r in conn.execute("SELECT id FROM announcements")}


def query_announcements(db_file, keyword=None, category=None, brand=None,
                        date_from=None, date_to=None, status=None,
                        page=1, page_size=20):
    where, params = [], []
    if keyword:
        where.append("(title LIKE ? OR enquiry_name LIKE ? OR org_name LIKE ? "
                     "OR purchase_company LIKE ? OR brands LIKE ?)")
        kw = "%" + keyword + "%"
        params += [kw, kw, kw, kw, kw]
    if category and category != "全部":
        where.append("category = ?")
        params.append(category)
    if brand:
        where.append("brands LIKE ?")
        params.append("%" + brand + "%")
    if date_from:
        where.append("publish_date >= ?")
        params.append(date_from)
    if date_to:
        where.append("publish_date <= ?")
        params.append(date_to)
    if status == "进行中":
        where.append("is_end = 0")
    elif status == "已截止":
        where.append("is_end = 1")
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    offset = (max(1, page) - 1) * page_size
    with _lock, connect(db_file) as conn:
        total = conn.execute(
            "SELECT COUNT(*) c FROM announcements %s" % where_sql, params
        ).fetchone()["c"]
        rows = conn.execute(
            "SELECT id,title,org_name,purchase_company,budget_amount,end_time,"
            "publish_date,category,brands,is_end,enquiry_no FROM announcements %s "
            "ORDER BY id DESC LIMIT ? OFFSET ?" % where_sql,
            params + [page_size, offset],
        ).fetchall()
    return total, [dict(r) for r in rows]


def get_announcement(db_file, nid):
    with _lock, connect(db_file) as conn:
        r = conn.execute("SELECT * FROM announcements WHERE id=?", (nid,)).fetchone()
        if not r:
            return None
        d = dict(r)
        try:
            d["products"] = json.loads(d.get("products_json") or "[]")
        except Exception:
            d["products"] = []
        return d


def categories(db_file):
    with _lock, connect(db_file) as conn:
        rows = conn.execute(
            "SELECT category, COUNT(*) c FROM announcements "
            "WHERE category IS NOT NULL AND category<>'' GROUP BY category ORDER BY c DESC"
        ).fetchall()
        return [r["category"] for r in rows]


def stats(db_file):
    with _lock, connect(db_file) as conn:
        total = conn.execute("SELECT COUNT(*) c FROM announcements").fetchone()["c"]
        active = conn.execute("SELECT COUNT(*) c FROM announcements WHERE is_end=0").fetchone()["c"]
        latest = conn.execute("SELECT MAX(publish_date) d FROM announcements").fetchone()["d"]
    return {"total": total, "active": active, "latest_date": latest}


def _now():
    import datetime
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
