# -*- coding: utf-8 -*-
import re, subprocess, io, os, tempfile

path = r"C:\Users\MXyuan\Doubao\chats\2026-09-22\new-chat\study-tracker-fullstack\frontend\index.html"
with io.open(path, "r", encoding="utf-8") as f:
    html = f.read()

scripts = re.findall(r'<script(?![^>]*type=["\']module["\'])[^>]*>([\s\S]*?)</script>', html)
print(f"Found {len(scripts)} inline script blocks")
ok = 0
for i, s in enumerate(scripts):
    if not s.strip():
        ok += 1
        continue
    tmp = os.path.join(tempfile.gettempdir(), f"st_check_{i}.js")
    with io.open(tmp, "w", encoding="utf-8") as f:
        f.write(s)
    r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    if r.returncode == 0:
        ok += 1
    else:
        print(f"Script {i} ERROR: {r.stderr[:200]}")
    os.remove(tmp)
print(f"OK: {ok}/{len(scripts)}")
