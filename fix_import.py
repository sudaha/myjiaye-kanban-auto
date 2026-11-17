# -*- coding: utf-8 -*-
"""补上 base64 导入并去掉 Set-Content 写入的 BOM。"""
s = open("server.py", encoding="utf-8-sig").read()
if "\nimport base64" not in s:
    s = s.replace("import os\nimport re\n", "import os\nimport re\nimport base64\n", 1)
open("server.py", "w", encoding="utf-8", newline="\n").write(s.lstrip("\ufeff"))
t = open("server.py", encoding="utf-8").read()
print("bom:", t.startswith("\ufeff"), "| base64:", "\nimport base64\n" in t)
