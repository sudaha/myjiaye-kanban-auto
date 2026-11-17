# -*- coding: utf-8 -*-
"""央采主站播种重试：WAF 冷却期每 5 分钟探一次，恢复后立即跑 45 天播种。"""
import subprocess
import sys

MAX_TRIES = 14  # 14 x 5min = 70 分钟上限
for i in range(1, MAX_TRIES + 1):
    r = subprocess.run([sys.executable, "test_pw_headless8.py"],
                       capture_output=True, text=True, encoding="utf-8", errors="ignore")
    out = (r.stdout or "") + (r.stderr or "")
    if "code=200" in out:
        print("WAF 已恢复（第 %d 次探测），开始播种…" % i)
        subprocess.run([sys.executable, "zycgmain_fetcher.py", "--days", "45"])
        sys.exit(0)
    print("第 %d/%d 次探测仍被拒，等 5 分钟：%s" % (i, MAX_TRIES, out.strip()[:60]))
    if i < MAX_TRIES:
        import time
        time.sleep(300)
print("全部探测失败，稍后人工重跑 python zycgmain_fetcher.py --days 45")
