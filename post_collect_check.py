# -*- coding: utf-8 -*-
"""下载打包功能修复命令（每次采集后运行，2026-11-27 用户要求常设）。

职责：
  1. PDF/附件完整性：dist 中所有 list.json 引用文件必须存在且 >10KB；
     缺失时按 data/pdfs -> data/poly_pdfs -> 源站 pdf_url 三级修复。
  2. 打包命名预检：按前端同款规则（safeName->250字节截断->去重）计算全部
     可打包条目最终 zip 路径，报告超长/同名隐患（Windows 资源管理器硬限制）。
  3. 前端打包代码体检：dist/app.js 必须含三通道兜底与限长去重标记。
  4. 发生过修复时自动 re-export + wrangler 部署 + git commit/push。
  5. 写 data/download_check_status.json 留痕。
用法：python post_collect_check.py [--no-deploy]
"""
import os, sys, json, glob, shutil, sqlite3, hashlib, subprocess, datetime, re

BASE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(BASE, "dist")
DATA = os.path.join(BASE, "data")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
MAX_BYTES = 250  # 与 app.js MAX_ZIP_NAME_BYTES 一致

os.chdir(BASE)
sys.path.insert(0, BASE)


def now_bj():
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).strftime("%Y-%m-%d %H:%M:%S")


def safe_name(s):
    """与 app.js safeName 一致：非法字符->_，trim，前90字符。"""
    s = re.sub(r'[\\/:*?"<>|\r\n]', "_", str(s or "")).strip()
    return s[:90]


def utf8_len(s):
    return len(s.encode("utf-8"))


def cap_bytes(s, max_bytes):
    out, n = "", 0
    for ch in s:
        b = len(ch.encode("utf-8"))
        if n + b > max_bytes:
            break
        out += ch
        n += b
    return out


def cap_zip_path(path, max_bytes=MAX_BYTES):
    """与 app.js capZipPath 一致：只对文件名截断，保留文件夹与扩展名。"""
    if utf8_len(path) <= max_bytes:
        return path
    slash = path.rfind("/")
    folder = path[:slash + 1]
    file_ = path[slash + 1:]
    dot = file_.rfind(".")
    stem = file_[:dot] if dot > 0 else file_
    ext = file_[dot:] if dot > 0 else ""
    budget = max_bytes - utf8_len(folder) - utf8_len(ext)
    return folder + cap_bytes(stem, budget) + ext


def zip_base_name(it, plat):
    cat = safe_name(it.get("category")) or "其他"
    if plat == "poly":
        base = cat + "/" + safe_name(it.get("title") or "保利项目") + ".html"
    else:
        proj = it.get("enquiry_name") or it.get("title") or "未命名项目"
        org = it.get("purchase_company") or it.get("org_name") or "未知采购人"
        ext = ".pdf"
        if it.get("pdf_path"):
            m = re.search(r"(\.[A-Za-z0-9]{1,8})$", str(it["pdf_path"]))
            if m:
                ext = m.group(1).lower()
        base = cat + "/" + safe_name(proj) + "_" + safe_name(org) + ext
    return cap_zip_path(base)


def make_namer():
    used = {}

    def f(base):
        if base not in used:
            used[base] = True
            return base
        dot = base.rfind(".")
        stem = base[:dot] if dot > 0 else base
        ext = base[dot:] if dot > 0 else ""
        n = 2
        while True:
            cand = "%s_%d%s" % (stem, n, ext)
            if cand not in used:
                used[cand] = True
                return cand
            n += 1
    return f


def load_items(rel):
    p = os.path.join(DIST, "data", rel)
    if not os.path.exists(p):
        return []
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh).get("items") or []
    except Exception:
        return []


def magic_ok(fp):
    if not os.path.exists(fp) or os.path.getsize(fp) < 10240:
        return False
    with open(fp, "rb") as fh:
        return fh.read(5) == b"%PDF-"


def repair_zycg_pdf(nid):
    """data/pdfs -> 源站 pdf_url 三级修复。返回 (ok, how)。"""
    dst = os.path.join(DATA, "pdfs", "%d.pdf" % nid)
    if magic_ok(dst):
        return True, "data已有"
    con = sqlite3.connect(os.path.join(DATA, "board.db"))
    row = con.execute("SELECT pdf_url FROM announcements WHERE id=?", (nid,)).fetchone()
    con.close()
    url = (row[0] if row else "") or ""
    if url:
        if url.startswith("//"):
            url = "https:" + url
        import urllib.request
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                buf = urllib.request.urlopen(req, timeout=60).read()
                if len(buf) > 10240 and buf[:5] == b"%PDF-":
                    with open(dst, "wb") as fh:
                        fh.write(buf)
                    return True, "源站重下"
            except Exception:
                pass
    return False, "修复失败"


def main():
    no_deploy = "--no-deploy" in sys.argv
    repaired, failed = [], []

    # --- 1. 央采询价 PDF 完整性 ---
    zycg = load_items("zycg/list.json")
    n_with_pdf = 0
    for it in zycg:
        if it.get("source") != "询价" or not it.get("pdf_path"):
            continue
        n_with_pdf += 1
        dst = os.path.join(DIST, it["pdf_path"].replace("/", os.sep))
        if not magic_ok(dst):
            ok, how = repair_zycg_pdf(int(it["id"]))
            if ok:
                repaired.append("zycg %s (%s)" % (it["id"], how))
            else:
                failed.append("zycg %s %s" % (it["id"], it.get("title", "")[:30]))

    # --- 2. 保利附件完整性 ---
    poly = load_items("poly/list.json")
    n_att = 0
    for it in poly:
        for a in it.get("attachments") or []:
            if not a.get("local"):
                continue
            n_att += 1
            dst = os.path.join(DIST, "pdf", "poly", a["local"])
            if not os.path.exists(dst) or os.path.getsize(dst) < 10240:
                src = os.path.join(DATA, "poly_pdfs", a["local"])
                if os.path.exists(src) and os.path.getsize(src) >= 10240:
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copy2(src, dst)
                    repaired.append("poly %s" % a["local"])
                else:
                    failed.append("poly %s (%s)" % (a["local"], (it.get("title") or "")[:30]))

    # --- 3. 打包命名预检（前端同款规则） ---
    naming = []
    for plat, items, only_pdf in (("zycg", zycg, True), ("poly", poly, False)):
        namer = make_namer()
        over = 0
        for it in items:
            if plat == "zycg" and (not it.get("has_pdf") or it.get("source") != "询价"):
                continue
            if plat == "poly" and not any(a.get("local") for a in (it.get("attachments") or [])):
                continue
            name = namer(zip_base_name(it, plat))
            if utf8_len(name) > 250:
                over += 1
        if over:
            naming.append("%s 平台 %d 条超250字节" % (plat, over))

    # --- 4. 前端打包代码体检 ---
    appjs = os.path.join(DIST, "app.js")
    with open(appjs, encoding="utf-8") as fh:
        js = fh.read()
    for mark in ("capZipPath", "makeZipNamer", "fetchPdfXhr"):
        if mark not in js:
            naming.append("app.js 缺失打包修复标记 %s（前端回退！）" % mark)

    print("[post-collect] 央采PDF引用 %d，保利附件引用 %d" % (n_with_pdf, n_att))
    print("[post-collect] 修复 %d 项: %s" % (len(repaired), repaired[:10]))
    print("[post-collect] 失败 %d 项: %s" % (len(failed), failed[:10]))
    print("[post-collect] 命名/代码隐患 %d 项: %s" % (len(naming), naming[:5]))

    # --- 5. 有修复则重导出+部署+推送 ---
    redeployed = False
    if repaired and not no_deploy:
        r = subprocess.run([sys.executable, "export_static.py", "dist"])
        if r.returncode != 0:
            print("[post-collect] 重导出失败，跳过部署")
        else:
            env = os.environ.copy()
            tok_f = os.path.join("..", "_transfer", "cf_api_token.txt")
            if os.path.exists(tok_f):
                env["CLOUDFLARE_API_TOKEN"] = open(tok_f, encoding="utf-8").read().strip()
            r2 = subprocess.run(["npx", "-y", "wrangler", "pages", "deploy",
                                 "--project-name=myjiaye-kanban"],
                                env=env, cwd=BASE, capture_output=True, text=True)
            redeployed = r2.returncode == 0
            print("[post-collect] 重部署:", "成功" if redeployed else "失败")
            if redeployed:
                gh = os.path.join("..", "_transfer", "gh_token.txt")
                if os.path.exists(gh):
                    tok = open(gh, encoding="utf-8").read().strip()
                    for arg in (["git", "add", "data/"],
                                ["git", "-c", "user.name=kanban-sync-bot",
                                 "-c", "user.email=sync@users.noreply.github.com",
                                 "commit", "-m", "fix(post-collect): 下载打包修复 %d 项" % len(repaired)],
                                ["git", "-c", "http.curloptResolve=github.com:443:140.82.112.3",
                                 "push", "https://x-access-token:%s@github.com/sudaha/myjiaye-kanban-auto.git" % tok, "main"]):
                        subprocess.run(arg, cwd=BASE, capture_output=True, text=True)

    status = {"date": now_bj(), "checked": {"zycg_pdf": n_with_pdf, "poly_att": n_att},
              "repaired": repaired, "failed": failed, "naming_issues": naming,
              "redeployed": redeployed}
    with open(os.path.join(DATA, "download_check_status.json"), "w", encoding="utf-8") as fh:
        json.dump(status, fh, ensure_ascii=False, indent=1)
    verdict = "PASS" if not failed and not naming else "FAIL"
    print("VERDICT=%s" % verdict)
    sys.exit(0 if verdict == "PASS" else 1)


if __name__ == "__main__":
    main()
