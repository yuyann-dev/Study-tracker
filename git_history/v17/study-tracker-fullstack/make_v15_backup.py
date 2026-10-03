# -*- coding: utf-8 -*-
import os, zipfile, datetime

ROOT = r"C:\Users\MXyuan\Doubao\chats\2026-09-22\new-chat\study-tracker-fullstack"
OUT  = r"C:\Users\MXyuan\Doubao\chats\2026-09-22\new-chat\Study-tracker-v15-fullstack.zip"

EXCLUDE_DIRS = {"node_modules", ".git", "data"}
EXCLUDE_FILES = {".env"}
EXCLUDE_EXT = {".db", ".log"}

def should_skip_dir(rel_dir):
    parts = rel_dir.replace("\\", "/").split("/")
    return any(p in EXCLUDE_DIRS for p in parts)

count = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        if rel_dir != "." and should_skip_dir(rel_dir):
            continue
        # prune excluded dirs in-place
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            if fn in EXCLUDE_FILES:
                continue
            ext = os.path.splitext(fn)[1].lower()
            if ext in EXCLUDE_EXT:
                continue
            full = os.path.join(dirpath, fn)
            arc = os.path.join("study-tracker-fullstack", os.path.relpath(full, ROOT))
            z.write(full, arc)
            count += 1

size = os.path.getsize(OUT)
print("Files:", count)
print("Backup:", OUT)
print("Size: %.2f MB" % (size/1024/1024))
