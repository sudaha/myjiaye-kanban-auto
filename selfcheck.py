#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
selfcheck.py — 佳业采购雷达 · 每日只读自检
================================================
用途：每天自动核对「各平台每日抓取 / 公告更新口径 / 下载功能 / 部署同步 / Git 同步」
      是否正常，并输出结论。

红线（本脚本绝对不做的事）：
  * 不写、不改、不删除任何 data/ 或 dist/ 文件；
  * 不运行 export/部署/push；
  * 不登录、不抓取、不触发任何采集脚本；
  * 只做只读读取 + 少量对线上站点的只读 GET（带浏览器 UA，短超时，失败只告警不报错）。

运行：python selfcheck.py      （始终返回退出码 0；结论写在输出里）
"""
import os, re, json, sqlite3, datetime, subprocess, urllib.request
from collections import Counter

BASE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(BASE, "dist")
DATA = os.path.join(BASE, "data")
LIVE = "https://kanban.myjiaye.top"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

BJT = datetime.timezone(datetime.timedelta(hours=8))
NOW = datetime.datetime.now(BJT)
TODAY = NOW.strftime("%Y-%m-%d")
IS_WORKDAY = NOW.weekday() < 5

OK, WARN, FAIL = "OK", "WARN", "FAIL"
ICON = {OK: "✔", WARN: "△", FAIL: "✘"}
SECTION = None
ROWS = []          # (section, level, text)
COUNTS = {OK: 0, WARN: 0, FAIL: 0}

def sec(name):
    global SECTION
    SECTION = name

def add(level, text):
    COUNTS[level] += 1
    ROWS.append((SECTION, level, text))

def jload(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def age_days(date_str):
    if not date_str:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(date_str)[:10])
    if not m:
        return None
    try:
        dd = datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except Exception:
        return None
    return (NOW.date() - dd).days

def fresh(label, date_str, exception_text=None):
    """按北京日期判断某来源新鲜度。exception_text 非空时，≥2天降级为 WARN(附原因)而非 FAIL。"""
    a = age_days(date_str)
    if a is None:
        add(WARN, "%s：无法解析更新时间 %r" % (label, date_str))
        return
    if a < 0:
        add(FAIL, "%s：更新时间 %s 是未来时间（脏数据/时区错误）" % (label, date_str[:16]))
    elif a == 0:
        add(OK, "%s：今天(%s)已更新" % (label, date_str[:10]))
    elif a == 1:
        add(WARN, "%s：昨天(%s)更新，今天采集可能尚未完成" % (label, date_str[:10]))
    elif exception_text:
        add(WARN, "%s：已 %d 天未更新(最后 %s)——%s" % (label, a, date_str[:10], exception_text))
    else:
        add(FAIL, "%s：已 %d 天未更新(最后 %s)，疑似断更" % (label, a, date_str[:10]))

def http_json(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

def http_text(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")

# ---------------- 下载名生成逻辑（与 static_src/app.js 完全一致） ----------------
def safeName(s):
    return re.sub(r'[\\/:*?"<>|\r\n]', "_", (s or "")).strip()[:90]
def utf8len(s):
    return len(s.encode("utf-8"))
def cap_bytes(s, maxb):
    if utf8len(s) <= maxb:
        return s
    out, b = "", 0
    for ch in s:
        o = ord(ch); bl = 1 if o < 0x80 else 2 if o < 0x800 else 3 if o < 0x10000 else 4
        if b + bl > maxb:
            break
        out += ch; b += bl
    return out
def cap_zip_path(p, maxb):
    if utf8len(p) <= maxb:
        return p
    sl = p.rfind("/"); folder = p[:sl + 1]; file = p[sl + 1:]
    dot = file.rfind("."); stem = file[:dot] if dot > 0 else file; ext = file[dot:] if dot > 0 else ""
    return folder + cap_bytes(stem, maxb - utf8len(folder) - utf8len(ext)) + ext
def make_namer():
    used = {}
    def f(base):
        if not used.get(base):
            used[base] = True; return base
        dot = base.rfind("."); stem = base[:dot] if dot > 0 else base; ext = base[dot:] if dot > 0 else ""
        n = 2
        while True:
            cand = "%s_%d%s" % (stem, n, ext)
            if not used.get(cand):
                used[cand] = True; return cand
            n += 1
    return f
def zip_base_zycg(it):
    proj = it.get("enquiry_name") or it.get("title") or "未命名项目"
    org = it.get("purchase_company") or it.get("org_name") or "未知采购人"
    ext = ".pdf"; pp = it.get("pdf_path")
    if pp:
        m = re.search(r"(\.[A-Za-z0-9]{1,8})$", str(pp))
        if m: ext = m.group(1).lower()
    cat = safeName(it.get("category")) or "其他"
    return cap_zip_path(cat + "/" + safeName(proj) + "_" + safeName(org) + ext, 250)
def zip_base_poly(it):
    cat = safeName(it.get("category")) or "其他"
    return cap_zip_path(cat + "/" + safeName(it.get("title") or "保利项目") + ".html", 250)

# ================================================================
def main():
    print("=" * 60)
    print("佳业采购雷达 · 每日只读自检")
    print("时间: %s（%s，%s）" % (NOW.strftime("%Y-%m-%d %H:%M:%S %Z"),
                                 "工作日" if IS_WORKDAY else "周末", "本机自检"))
    print("=" * 60)

    lcs = jload(os.path.join(DATA, "local_collect_status.json")) or {}
    lcs_items = lcs.get("items", {}) or {}
    lcs_today = (lcs.get("date") == TODAY)

    # ---------- ① 各平台抓取新鲜度 ----------
    sec("① 各平台每日抓取")
    meta = {}
    ann_total = ann_inprog = None
    try:
        conn = sqlite3.connect(os.path.join(DATA, "board.db"))
        for r in conn.execute("SELECT key,value FROM meta"):
            meta[r[0]] = r[1]
        ann_total = conn.execute("SELECT COUNT(*) FROM announcements").fetchone()[0]
        ann_inprog = conn.execute("SELECT COUNT(*) FROM announcements WHERE is_end=0").fetchone()[0]
        conn.close()
    except Exception as e:
        add(WARN, "board.db 读取失败: %s" % e)
    fresh("央采电子询价", meta.get("last_fetch"),
          "与 GitHub CI(9/13/17/22) 双通道冗余，若 CI+本机皆停再升级排查")
    zycgmain = jload(os.path.join(DATA, "zycgmain_items.json")) or {}
    wt_exc = "WAF 窗口未开，待 15:00 浏览器通道补采" if lcs_items.get("zycgmain") == "partial" else None
    fresh("央采单独委托", zycgmain.get("updated_at"), wt_exc)
    poly = jload(os.path.join(DATA, "poly_items.json")) or {}
    fresh("保利集团招标", poly.get("updated_at"))
    rail = jload(os.path.join(DATA, "rail_items.json")) or {}
    fresh("国铁公开采购", rail.get("updated_at"))
    # 国铁商城批采（依赖 UKey）
    mall_p = os.path.join(DATA, "rail_mall_items.json")
    mall_dt = None
    if os.path.isfile(mall_p):
        mall_j = jload(mall_p) or {}
        mall_dt = mall_j.get("updated_at") or mall_j.get("last_fetch")
        if not mall_dt:
            mall_dt = datetime.datetime.fromtimestamp(os.path.getmtime(mall_p), BJT).strftime("%Y-%m-%d %H:%M:%S")
    mall_exc = None
    if lcs_items.get("rail_mall") in ("skipped_no_ukey",) or str(lcs_items.get("rail_mall","")).startswith("error"):
        mall_exc = "需插入 UKey 并在 Chrome 登录 mall.95306.cn（非系统故障）"
    fresh("国铁商城批采", mall_dt, mall_exc)
    # 中标喜报（每次导出重新生成，按存在性/数量核对，不按新鲜度）
    wins = jload(os.path.join(DATA, "wins.json")) or {}
    wc = wins.get("count")
    if wc is None and isinstance(wins.get("wins"), list):
        wc = len(wins["wins"])
    if wins:
        add(OK, "中标喜报：共 %s 条（我方中标主体精确匹配两公司全称口径）" % (wc if wc is not None else "?"))
    else:
        add(WARN, "中标喜报：wins.json 缺失或为空")

    # ---------- ② 晨抓 / 重试状态 ----------
    sec("② 晨抓(10:00)/重试(15:00)状态")
    expect_keys = ["rail_mall", "rail_public", "poly", "win_news", "zycg_mkt", "zycgmain"]
    if not lcs:
        add(WARN, "local_collect_status.json 不存在（今天 10:00 晨抓可能尚未运行）")
    elif not lcs_today:
        add(WARN, "状态文件日期=%s（非今天 %s）：今天 10:00 晨抓尚未写入状态" % (lcs.get("date"), TODAY))
    else:
        add(OK, "晨抓状态: slot=%s finished_at=%s deployed=%s" % (lcs.get("slot"), lcs.get("finished_at"), lcs.get("deployed")))
        need_retry = []
        for k in expect_keys:
            v = lcs_items.get(k)
            if v is None:
                add(WARN, "晨抓状态缺少 %s 键（口径未记录；数据是否更新见①）" % k)
                continue
            if v in ("ok", "none_new"):
                add(OK, "  %s = %s" % (k, v))
            elif v == "skipped_no_ukey":
                add(WARN, "  %s = skipped_no_ukey（需 UKey，15:00 重试）" % k); need_retry.append(k)
            elif v == "partial":
                add(WARN, "  %s = partial（断点/窗口未开，15:00 补采）" % k); need_retry.append(k)
            elif str(v).startswith("error"):
                add(FAIL, "  %s = %s（采集报错，需排查）" % (k, v)); need_retry.append(k)
            else:
                add(WARN, "  %s = %s（非常态值）" % (k, v)); need_retry.append(k)
        # zycg_mkt 数据实况 vs 状态口径
        if "zycg_mkt" not in lcs_items:
            lf = (meta.get("last_fetch") or "")[:10]
            if lf == TODAY:
                add(WARN, "zycg_mkt 数据今天已更新(%s)但晨抓状态未记录该项——状态统计口径缺失，建议修正 10:00 任务" % lf)
        if need_retry:
            add(WARN, "待 15:00 重试: " + ", ".join(need_retry))
        elif all(lcs_items.get(k) in ("ok", "none_new") for k in expect_keys):
            add(OK, "晨抓全部完成，无待重试项")

    # ---------- ③ 公告更新口径一致性（镜像 export 的 6 条不变量） ----------
    sec("③ 公告更新口径一致性（央采）")
    items = (jload(os.path.join(DIST, "data", "zycg", "list.json")) or {}).get("items", [])
    st = jload(os.path.join(DIST, "data", "zycg", "status.json")) or {}
    date_re = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    if not items:
        add(FAIL, "dist zycg list.json 无条目（导出异常或文件缺失）")
    else:
        bad = [i["id"] for i in items
               if (i.get("publish_date") and not date_re.match(i["publish_date"][:10]))
               or (i.get("pub_date") and not date_re.match(i["pub_date"][:10]))]
        add(FAIL if bad else OK, "日期格式: " + ("非法 %s" % bad[:5] if bad else "全部 YYYY-MM-DD"))
        nopub = [i["id"] for i in items if i.get("source") == "询价" and i.get("is_end") == 0 and not i.get("pub_date")]
        add(FAIL if nopub else OK, "进行中询价首次上架日: " + ("缺失 %s" % nopub[:5] if nopub else "齐备"))
        calc = Counter()
        for i in items:
            dd = (i.get("pub_date") or i.get("publish_date") or "")[:10]
            if dd:
                calc[dd] += 1
        avd = st.get("available_dates", {}) or {}
        cal_ok = (dict(calc) == avd)
        add(FAIL if not cal_ok else OK, "日历与条目逐日对齐: " + ("脱节" if not cal_ok else "一致"))
        item_max = max(calc, default="")
        ld = st.get("latest_date", "")
        add(FAIL if (ld and ld < item_max) else OK, "表头最新日期 %s >= 条目最大 %s" % (ld, item_max))
        fut_items = sorted({(i.get("pub_date") or i.get("publish_date") or "")[:10] for i in items
                            if date_re.match((i.get("pub_date") or i.get("publish_date") or "")[:10])
                            and (i.get("pub_date") or i.get("publish_date"))[:10] > TODAY})
        add(FAIL if (ld > TODAY or fut_items) else OK,
            "无未来日期: " + ("latest 未来 / 未来条目 %s" % fut_items[:5] if (ld > TODAY or fut_items) else "通过"))
        new_true = sum(1 for i in items if i.get("is_new"))
        add(FAIL if st.get("new_count") != new_true else OK,
            "新标注计数 new_count=%s vs is_new=%d" % (st.get("new_count"), new_true))
        add(FAIL if not any(i.get("source") == "询价" and i.get("is_end") == 0 for i in items) else OK,
            "进行中询价非空: " + ("空集！" if not any(i.get("source") == "询价" and i.get("is_end") == 0 for i in items) else "有"))
    # 汇总条数
    xj = sum(1 for i in items if i.get("source") != "委托")
    wt = sum(1 for i in items if i.get("source") == "委托")
    add(OK, "央采上线: 共 %d 条（询价 %d / 委托 %d），进行中 %s，今日新增 %s" % (
        len(items), xj, wt, st.get("active"), st.get("new_count")))

    # ---------- ④ 下载功能健康 ----------
    sec("④ 下载功能健康（打包 zip 有效性 + PDF 齐全）")
    # 4a 打包名去重 & ≤255 字节（央采询价 + 保利）
    namer = make_namer()
    finals = []
    for i in items:
        if i.get("source") != "委托" and i.get("has_pdf"):
            finals.append(namer(zip_base_zycg(i)))
    poly_items = (jload(os.path.join(DIST, "data", "poly", "list.json")) or {}).get("items", [])
    for i in poly_items:
        finals.append(namer(zip_base_poly(i)))
    seen = Counter(finals)
    dups = [k for k, v in seen.items() if v > 1]
    maxb = max((utf8len(f) for f in finals), default=0)
    add(FAIL if dups else OK, "打包条目名去重: " + ("%d 个重名 %s" % (len(dups), dups[:2]) if dups else "0 重复（共 %d 条目唯一名）" % len(finals)))
    add(FAIL if maxb > 255 else OK, "打包条目名最长 %d 字节（上限 255，Windows 资源管理器硬限制）" % maxb)
    # 4b PDF 文件齐全
    missing = []
    for i in items:
        if i.get("source") != "委托" and i.get("has_pdf"):
            pp = i.get("pdf_path") or ""
            if pp and not os.path.isfile(os.path.join(DIST, *pp.split("/"))):
                missing.append("%s(%s)" % (i.get("id"), pp))
    add(FAIL if missing else OK, "央采 PDF 齐全: " + ("缺失 %d 份 %s" % (len(missing), missing[:3]) if missing else "dist 内全部命中"))
    # 4c 打包修复代码在位（防回归）
    appjs = ""
    try:
        appjs = open(os.path.join(DIST, "app.js"), encoding="utf-8").read()
    except Exception:
        pass
    has_fix = all(k in appjs for k in ("makeZipNamer", "capZipPath", "MAX_ZIP_NAME_BYTES"))
    add(FAIL if not has_fix else OK, "打包去重+限长代码在位: " + ("齐备(makeZipNamer/capZipPath/MAX_ZIP_NAME_BYTES)" if has_fix else "缺失！打包 bug 可能回归"))
    # 4d dist/app.js 与源码一致
    try:
        src = open(os.path.join(BASE, "static_src", "app.js"), encoding="utf-8").read()
        add(OK if src == appjs else WARN, "dist/app.js 与 static_src 一致: " + ("是" if src == appjs else "否（dist 未随源码重新 export，可能不同步）"))
    except Exception as e:
        add(WARN, "无法对比 app.js: %s" % e)

    # ---------- ⑤ 部署同步 / 线上 ----------
    sec("⑤ 部署同步（线上 vs 本地）")
    local_st = st
    try:
        live_st = http_json(LIVE + "/data/zycg/status.json")
        lf_l, lf_v = (local_st.get("last_fetch") or "")[:19], (live_st.get("last_fetch") or "")[:19]
        if lf_l and lf_v and lf_v < lf_l:
            add(WARN, "线上 last_fetch=%s 落后本地=%s（部署未同步，或被 CI 旧代码覆盖）" % (lf_v, lf_l))
        elif lf_l and lf_v:
            add(OK, "线上 last_fetch=%s（与本地一致），线上 total=%s / 本地 total=%s" % (lf_v, live_st.get("total"), local_st.get("total")))
        else:
            add(WARN, "线上 status 可读但字段异常: live=%s" % live_st.get("last_fetch"))
        if (live_st.get("total") or -1) != (local_st.get("total") or -2):
            add(WARN, "线上 total=%s ≠ 本地 total=%s（版本差异）" % (live_st.get("total"), local_st.get("total")))
    except Exception as e:
        add(WARN, "无法访问线上 status.json（网络/UA/站点异常）: %s" % e)
    try:
        live_html = http_text(LIVE + "/")
        m = re.search(r'app\.js\?v=([0-9]+)', live_html)
        live_stamp = m.group(1) if m else "?"
        local_html = open(os.path.join(DIST, "index.html"), encoding="utf-8").read()
        lm = re.search(r'app\.js\?v=([0-9]+)', local_html)
        local_stamp = lm.group(1) if lm else "?"
        add(OK if live_stamp == local_stamp else WARN,
            "线上 app.js 版本戳 %s vs 本地构建 %s: %s" % (live_stamp, local_stamp, "一致" if live_stamp == local_stamp else "不一致（线上未更新到最新构建）"))
    except Exception as e:
        add(WARN, "无法核对线上版本戳: %s" % e)

    # ---------- ⑥ Git 同步（只读；远端用 ls-remote 取真值，避免本地 tracking ref 陈旧误报） ----------
    sec("⑥ Git 同步")
    def git(*args, env=None):
        try:
            r = subprocess.run(["git", "-C", BASE] + list(args),
                               capture_output=True, text=True, timeout=25, env=env)
            return r.stdout.strip(), r.returncode
        except Exception:
            return None, -1
    status, _ = git("status", "--porcelain")
    if status is None:
        add(WARN, "无法运行 git（非仓库/权限）")
    else:
        tracked = [ln for ln in status.splitlines() if ln and not ln.startswith("??")]
        key = [ln for ln in tracked if re.search(
            r"static_src/|export_static\.py|fetcher\.py|zycgmain_hunter\.py|poly_fetcher\.py|selfcheck\.py|\.github/", ln)]
        if key:
            add(WARN, "有未提交的关键代码改动（CI 会用远端旧代码覆盖）:\n     " + "\n     ".join(key[:6]))
        else:
            add(OK, "无未提交的关键代码改动")
    head, _ = git("rev-parse", "HEAD")
    tok = None
    tokp = os.path.join(BASE, "..", "_transfer", "gh_token.txt")
    try:
        tok = open(os.path.normpath(tokp), encoding="utf-8").read().strip()
    except Exception:
        pass
    if head and tok:
        env = dict(os.environ)
        env["http_proxy"] = env["https_proxy"] = "http://127.0.0.1:7890"
        out, rc = git("ls-remote",
                      "https://x-access-token:%s@github.com/sudaha/myjiaye-kanban-auto.git" % tok,
                      "refs/heads/main", env=env)
        remote_sha = out.split()[0] if (out and rc == 0) else None
        if remote_sha == head:
            add(OK, "本地 HEAD 与远端 main 一致(%s…)" % head[:7])
        elif remote_sha:
            add(WARN, "本地 HEAD(%s…) ≠ 远端 main(%s…)——若本地更新请 push，否则 CI 会用远端覆盖" % (head[:7], remote_sha[:7]))
        else:
            add(WARN, "无法核对远端（代理/网络受限）——请确认今天的改动已 push")
    elif head:
        add(WARN, "未找到 GitHub token，跳过远端核对（请确认已 push）")

    # ================================================================
    verdict = FAIL if COUNTS[FAIL] else (WARN if COUNTS[WARN] else OK)
    vtext = {OK: "PASS（全部正常）", WARN: "PASS_WITH_WARN（无阻断故障，有需确认项）", FAIL: "FAIL（存在阻断性故障）"}[verdict]

    print()
    for s, lv, tx in ROWS:
        # 打印 section 标题（首次出现时）
        pass
    last_sec = None
    for s, lv, tx in ROWS:
        if s != last_sec:
            print("\n%s" % s)
            last_sec = s
        print("  [%s] %s" % (ICON[lv], tx))

    print("\n" + "=" * 60)
    print("结论: %s   (✔OK=%d  △WARN=%d  ✘FAIL=%d)" % (vtext, COUNTS[OK], COUNTS[WARN], COUNTS[FAIL]))
    watch = [(s, lv, tx) for s, lv, tx in ROWS if lv in (WARN, FAIL)]
    if watch:
        print("需关注项：")
        for s, lv, tx in watch:
            print("  [%s] (%s) %s" % (ICON[lv], s, tx.splitlines()[0]))
    else:
        print("全部通过，无异常。")
    print("=" * 60)
    # 机器可读摘要（供定时任务/汇报直接引用）
    print()
    print("## SELF-CHECK SUMMARY")
    print("VERDICT=%s OK=%d WARN=%d FAIL=%d TIME=%s WORKDAY=%s" % (
        vtext.split("（")[0], COUNTS[OK], COUNTS[WARN], COUNTS[FAIL],
        NOW.strftime("%Y-%m-%d %H:%M"), IS_WORKDAY))
    for s, lv, tx in watch:
        print("  %s :: %s :: %s" % (lv, s, tx.replace("\n", " ")))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
