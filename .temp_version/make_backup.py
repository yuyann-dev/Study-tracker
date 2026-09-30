# -*- coding: utf-8 -*-
import zipfile, os

base = r"C:\Users\MXyuan\Doubao\chats\2026-09-22\new-chat\study-tracker-fullstack"
out = r"D:\喻颜资料\大学资料\Studytracker项目\源代码\Study-tracker-v13-fullstack.zip"

count = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(base):
        if "node_modules" in root:
            continue
        if os.sep + "dist" + os.sep in root + os.sep:
            continue
        for f in files:
            fp = os.path.join(root, f)
            arc = os.path.relpath(fp, base)
            zf.write(fp, arc)
            count += 1
print("Backup:", out)
print("Size:", os.path.getsize(out), "bytes, files:", count)
