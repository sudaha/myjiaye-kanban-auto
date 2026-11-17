# -*- coding: utf-8 -*-
"""分析 ccgp_kw_1.html：定位结果列表容器与单条结构。"""
import io
import re

html = io.open("ccgp_kw_1.html", encoding="utf-8", errors="ignore").read()
print("总长:", len(html))

# 找所有含 /cggg/ 链接的 <li>
lis = re.findall(r"<li[^>]*>(?:(?!</li>).)*?/cggg/(?:(?!</li>).)*?</li>", html, re.S)
print("含 /cggg/ 链接的 li:", len(lis))
if lis:
    print("---- 第一条完整 ----")
    print(lis[0][:800])
    print("---- 第二条完整 ----")
    if len(lis) > 1:
        print(lis[1][:800])

# 结果容器线索
for m in re.finditer(r"<(ul|div)[^>]*(id|class)=\"([^\"]*(list|result|search)[^\"]*)\"", html, re.I):
    print("容器:", m.group(0)[:120])

# 总数
for m in re.finditer(r"(共\s*\d+\s*条|\d+\s*条结果|总共[^<]{0,20})", html):
    print("总数:", m.group(0))
