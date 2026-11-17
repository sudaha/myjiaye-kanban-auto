# -*- coding: utf-8 -*-
import io, os
src = open("server.py", encoding="utf-8").read()
needle = '        h = self.headers.get("Authorization", "")'
dbg = needle + '\n        open(os.path.join(os.environ.get("TEMP", "."), "authdbg.txt"), "a", encoding="utf-8").write("HDR=%r U=%r P=%r\\n" % (h, AUTH_USER, AUTH_PASS))'
assert needle in src
out = src.replace(needle, dbg, 1)
open("server_dbg.py", "w", encoding="utf-8").write(out)
print("written server_dbg.py")
