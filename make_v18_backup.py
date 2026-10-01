# -*- coding: utf-8 -*-
import os, zipfile

ROOT = r"C:\Users\MXyuan\Doubao\chats\2026-10-01\new-chat\study-tracker-fullstack"
OUT  = r"D:\喻颜资料\大学资料\Studytracker项目\源代码\Study-tracker-v15-fullstack.zip"

# 任意层级出现这些目录名即排除
EXCLUDE_DIR_PARTS = {"node_modules", ".git", "data", "dist", "uploads", "logs", "__pycache__", ".cache"}
EXCLUDE_FILES = {".env"}
EXCLUDE_ENDS = (".db", ".log", ".db-wal", ".db-shm", "-wal", "-shm")

count = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIR_PARTS]
        for fn in filenames:
            low = fn.lower()
            if fn in EXCLUDE_FILES:
                continue
            if low.endswith(EXCLUDE_ENDS):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            z.write(full, "study-tracker-fullstack/" + rel)
            count += 1

print("Files:", count)
print("Out:", OUT)
print("Size: %.2f KB" % (os.path.getsize(OUT)/1024))
