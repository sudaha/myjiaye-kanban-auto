# -*- coding: utf-8 -*-
"""把 dist/ 静态站增量同步到阿里云 OSS（纯标准库，OSS V1 签名，连接复用）。

优化点（相比 v1）：
  - HTTPS 连接复用（keep-alive），不再每个文件重建 TLS
  - 用 OSS 上的 _state.json 比对 sha1，只上传真正变化的文件
  - 首次全量上传后，日常更新通常只需上传 2~4 个文件

配置文件 oss_config.json：
{
  "endpoint": "oss-cn-hongkong.aliyuncs.com",
  "bucket":   "myjiaye-kanban",
  "access_key_id":     "LTAI...",
  "access_key_secret": "..."
}

用法：
    python sync_oss.py                # 增量同步 ./dist
    python sync_oss.py --full         # 强制全量重传
    python sync_oss.py --dry-run      # 只列出将要上传的文件
"""
import argparse
import base64
import hashlib
import hmac
import http.client
import json
import os
import sys
import time
import urllib.parse
from email.utils import formatdate

BASE = os.path.dirname(os.path.abspath(__file__))
STATE_KEY = "_state.json"

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".pdf": "application/pdf",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}


class OSS(object):
    def __init__(self, cfg):
        self.cfg = cfg
        self.endpoint = cfg["endpoint"]
        self.bucket = cfg["bucket"]
        self.conn = None

    # ---------- 底层 ----------
    def _socket(self):
        if self.conn is None:
            self.conn = http.client.HTTPSConnection(self.endpoint, timeout=90)
        return self.conn

    def _reset(self):
        try:
            if self.conn:
                self.conn.close()
        except Exception:
            pass
        self.conn = None

    def _do(self, verb, key, body=None, ctype=""):
        resource = "/%s/%s" % (self.bucket, key) if key else "/%s/" % self.bucket
        date = formatdate(usegmt=True)
        md5 = base64.b64encode(hashlib.md5(body).digest()).decode("ascii") if body else ""
        to_sign = "\n".join([verb, md5, ctype, date, resource])
        sig = base64.b64encode(
            hmac.new(self.cfg["access_key_secret"].encode("utf-8"),
                     to_sign.encode("utf-8"), hashlib.sha1).digest()
        ).decode("ascii")
        headers = {
            "Date": date,
            "Authorization": "OSS %s:%s" % (self.cfg["access_key_id"], sig),
            "Host": "%s.%s" % (self.bucket, self.endpoint),
        }
        if ctype:
            headers["Content-Type"] = ctype
        if md5:
            headers["Content-MD5"] = md5
        path = "/" + urllib.parse.quote(key)
        conn = self._socket()
        conn.request(verb, path, body=body, headers=headers)
        resp = conn.getresponse()
        data = resp.read()
        hdr = dict((k.lower(), v) for k, v in resp.getheaders())
        return resp.status, hdr, data

    def request(self, verb, key, body=None, ctype="", retries=2):
        last = None
        for _ in range(retries + 1):
            try:
                return self._do(verb, key, body, ctype)
            except Exception as e:  # 连接被回收/超时，重建一次
                last = e
                self._reset()
                time.sleep(1)
        raise last

    # ---------- 语义 ----------
    def get_json(self, key):
        try:
            st, _h, data = self.request("GET", key)
            if st == 200:
                return json.loads(data.decode("utf-8"))
        except Exception:
            pass
        return None

    def put(self, key, data, ctype):
        st, _h, body = self.request("PUT", key, body=data, ctype=ctype)
        if st not in (200, 201):
            raise RuntimeError("PUT %s -> %s %s" % (key, st, body[:200]))
        return st


def load_config(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(BASE, "dist"))
    ap.add_argument("--config", default=os.path.join(BASE, "oss_config.json"))
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = load_config(args.config)
    root = args.dir
    man_path = os.path.join(root, "manifest.json")
    if not os.path.isfile(man_path):
        print("缺少 %s，请先运行 export_static.py" % man_path)
        return 2
    with open(man_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)["files"]

    client = OSS(cfg)
    remote = {} if args.full else (client.get_json(STATE_KEY) or {}).get("files", {})

    todo = [p for p, meta in sorted(manifest.items())
            if remote.get(p, {}).get("sha1") != meta["sha1"]]
    total_bytes = sum(manifest[p]["size"] for p in todo)
    print("本地 %d 个文件 / 远端已知 %d 个 / 需要上传 %d 个 (%.2f MB)"
          % (len(manifest), len(remote), len(todo), total_bytes / 1048576.0))

    if not todo:
        print("已是最新，无需上传。")
        return 0
    if args.dry_run:
        for p in todo:
            print("  [dry] %s (%.1f KB)" % (p, manifest[p]["size"] / 1024.0))
        return 0

    t0 = time.time()
    done = failed = 0
    sent = 0
    for p in todo:
        path = os.path.join(root, p.replace("/", os.sep))
        with open(path, "rb") as f:
            data = f.read()
        ctype = MIME.get(os.path.splitext(p)[1].lower(), "application/octet-stream")
        try:
            client.put(p, data, ctype)
            done += 1
            sent += len(data)
            if done % 10 == 0 or done == len(todo):
                print("  %d/%d  %s" % (done, len(todo), p))
        except Exception as e:
            failed += 1
            print("  [FAIL] %s -> %s" % (p, e))

    state = {"generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
             "files": {p: {"sha1": m["sha1"], "size": m["size"]} for p, m in manifest.items()}}
    if not failed:
        try:
            client.put(STATE_KEY, json.dumps(state, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")
        except Exception as e:
            print("  [warn] 状态文件写入失败: %s" % e)

    dt = time.time() - t0
    print("-" * 46)
    print("上传 %d / 失败 %d，共 %.2f MB，用时 %.1f 秒（%.0f KB/s）"
          % (done, failed, sent / 1048576.0, dt, (sent / 1024.0 / dt) if dt else 0))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
