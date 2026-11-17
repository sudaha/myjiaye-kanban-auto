# -*- coding: utf-8 -*-
"""dump 第一条 li 全文，确认 <br/> 后的字段。"""
import io
import re

html = io.open("ccgp_kw_1.html", encoding="utf-8", errors="ignore").read()
lis = re.findall(r"<li[^>]*>(?:(?!</li>).)*?/cggg/(?:(?!</li>).)*?</li>", html, re.S)
print(lis[0])
