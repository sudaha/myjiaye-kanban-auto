# -*- coding: utf-8 -*-
"""央采电子询价 · 招投标商机看板 服务端（纯标准库，免第三方依赖）。
- HTTP 服务（ThreadingHTTPServer），绑定 0.0.0.0 供内网手机/电脑访问
- 后台线程每 REFRESH_SECONDS 自动抓取新增公告
- SQLite 存储；静态前端 + JSON API + PDF 附件
启动:  python server.py  [端口]   (默认 8000)
"""
import os
import re
import base64
import json
import time
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import db
import fetcher

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
DATA = os.path.join(HERE, "data")
PDF_DIR = os.path.join(DATA, "pdfs")
DB_FILE = os.path.join(DATA, "board.db")

HOST = "0.0.0.0"
PORT = int(os.environ.get("ZB_PORT", "8000"))
REFRESH_SECONDS = int(os.environ.get("ZB_REFRESH", "1800"))   # 30 分钟
SEED_DAYS = int(os.environ.get("ZB_SEED_DAYS", "14"))

# 可选访问口令：ZB_USER / ZB_PASS 都设置时才生效，未设置则保持原来的免登录行为。
# 主要用于把看板挂到公网后防止被随意访问。
AUTH_USER = os.environ.get("ZB_USER", "").strip()
AUTH_PASS = os.environ.get("ZB_PASS", "").strip()

STATE = {"fetching": False, "last_fetch": None, "last_error": None}


def bg_loop():
    while True:
        try:
            if not STATE["fetching"]:
                STATE["fetching"] = True
                fetcher.run_fetch(DB_FILE, PDF_DIR, seed_days=SEED_DAYS, verbose=True)
                STATE["last_fetch"] = time.strftime("%Y-%m-%d %H:%M:%S")
                STATE["last_error"] = None
        except Exception as e:  # noqa
            STATE["last_error"] = str(e)
            print("[bg] fetch error:", e)
        finally:
            STATE["fetching"] = False
        time.sleep(REFRESH_SECONDS)


def trigger_fetch():
    """手动触发一次抓取（后台线程执行，避免阻塞请求）。"""
    if STATE["fetching"]:
        return False

    def _run():
        STATE["fetching"] = True
        try:
            fetcher.run_fetch(DB_FILE, PDF_DIR, seed_days=SEED_DAYS, verbose=True)
            STATE["last_fetch"] = time.strftime("%Y-%m-%d %H:%M:%S")
            STATE["last_error"] = None
        except Exception as e:  # noqa
            STATE["last_error"] = str(e)
        finally:
            STATE["fetching"] = False

    threading.Thread(target=_run, daemon=True).start()
    return True


MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".pdf": "application/pdf",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "ZYCGBoard/1.0"

    def log_message(self, fmt, *args):
        pass  # 静默访问日志

    # ---------- helpers ----------
    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, obj)

    def _file(self, path, download=False):
        if not os.path.isfile(path):
            self._json({"error": "not found"}, 404)
            return
        ext = os.path.splitext(path)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if download:
            self.send_header("Content-Disposition",
                             'attachment; filename="%s"' % os.path.basename(path))
        self.end_headers()
        self.wfile.write(body)

    # ---------- auth ----------
    def _authed(self):
        if not (AUTH_USER and AUTH_PASS):
            return True
        h = self.headers.get("Authorization", "")
        if not h.startswith("Basic "):
            return False
        try:
            raw = base64.b64decode(h[6:]).decode("utf-8", "ignore")
            u, p = raw.split(":", 1)
        except Exception:
            return False
        return u == AUTH_USER and p == AUTH_PASS

    def _deny(self):
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="ZYCG Board"')
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---------- GET ----------
    def do_GET(self):
        if not self._authed():
            return self._deny()
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            if path == "/" or path == "/index.html":
                return self._file(os.path.join(WEB, "index.html"))
            if path in ("/style.css", "/app.js", "/app.css"):
                name = os.path.basename(path)
                return self._file(os.path.join(WEB, name))
            if path == "/api/announcements":
                return self._api_list(qs)
            m = re.match(r"^/api/announcement/(\d+)$", path)
            if m:
                return self._api_detail(int(m.group(1)))
            if path == "/api/categories":
                return self._json({"categories": db.categories(DB_FILE)})
            if path == "/api/status":
                st = db.stats(DB_FILE)
                st["fetching"] = STATE["fetching"]
                st["last_fetch"] = STATE["last_fetch"] or db.get_meta(DB_FILE, "last_fetch")
                st["last_error"] = STATE["last_error"]
                st["refresh_seconds"] = REFRESH_SECONDS
                st["seed_days"] = SEED_DAYS
                return self._json(st)
            m = re.match(r"^/pdf/([^/]+)$", path)
            if m:
                name = os.path.basename(urllib.parse.unquote(m.group(1)))
                return self._file(os.path.join(PDF_DIR, name))
            self._json({"error": "not found"}, 404)
        except Exception as e:  # noqa
            self._json({"error": str(e)}, 500)

    def _api_list(self, qs):
        g = lambda k, d=None: (qs.get(k, [d])[0] or d)
        total, items = db.query_announcements(
            DB_FILE,
            keyword=g("keyword"),
            category=g("category"),
            brand=g("brand"),
            date_from=g("date_from"),
            date_to=g("date_to"),
            status=g("status"),
            page=int(g("page", 1) or 1),
            page_size=int(g("page_size", 20) or 20),
        )
        for it in items:
            it["budget_num"] = self._money(it.get("budget_amount"))
        return self._json({"total": total, "page": int(g("page", 1) or 1), "items": items})

    @staticmethod
    def _money(v):
        try:
            return round(float(v), 2)
        except Exception:
            return None

    def _api_detail(self, nid):
        d = db.get_announcement(DB_FILE, nid)
        if not d:
            return self._json({"error": "not found"}, 404)
        d["budget_num"] = self._money(d.get("budget_amount"))
        if d.get("pdf_local"):
            d["pdf_path"] = "/pdf/" + d["pdf_local"]
        return self._json(d)

    # ---------- POST ----------
    def do_POST(self):
        if not self._authed():
            return self._deny()
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/refresh":
            ok = trigger_fetch()
            return self._json({"ok": ok, "msg": "已触发抓取" if ok else "正在抓取中"})
        self._json({"error": "not found"}, 404)


def main():
    os.makedirs(PDF_DIR, exist_ok=True)
    db.init_db(DB_FILE)
    threading.Thread(target=bg_loop, daemon=True).start()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    ips = _lan_ips()
    print("=" * 60)
    print("  央采电子询价 · 招投标商机看板")
    print("  本机访问:  http://127.0.0.1:%d" % PORT)
    for ip in ips:
        print("  内网访问:  http://%s:%d" % (ip, PORT))
    print("  自动抓取间隔: %d 秒；首次抓取近 %d 天" % (REFRESH_SECONDS, SEED_DAYS))
    print("=" * 60)
    httpd.serve_forever()


def _lan_ips():
    import socket
    out = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        out.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        out.append(socket.gethostbyname(socket.gethostname()))
    except Exception:
        pass
    seen, res = set(), []
    for ip in out:
        if ip and ip not in seen and not ip.startswith("127."):
            seen.add(ip)
            res.append(ip)
    return res


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        PORT = int(sys.argv[1])
    main()
