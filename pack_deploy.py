# -*- coding: utf-8 -*-
import zipfile, os, io

base = r"C:\Users\MXyuan\Doubao\chats\2026-09-22\new-chat\study-tracker-fullstack"
dist = os.path.join(base, "dist")
os.makedirs(dist, exist_ok=True)

# 前端包
frontend_zip = os.path.join(dist, "frontend.zip")
with zipfile.ZipFile(frontend_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    frontend_dir = os.path.join(base, "frontend")
    for root, dirs, files in os.walk(frontend_dir):
        for f in files:
            fp = os.path.join(root, f)
            arcname = os.path.relpath(fp, frontend_dir)
            zf.write(fp, arcname)
print("Frontend zip:", frontend_zip, os.path.getsize(frontend_zip), "bytes")

# 后端包（排除node_modules和.env）
backend_zip = os.path.join(dist, "backend.zip")
with zipfile.ZipFile(backend_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    backend_dir = os.path.join(base, "backend")
    for root, dirs, files in os.walk(backend_dir):
        if 'node_modules' in root:
            continue
        for f in files:
            if f == '.env':
                continue
            if f.endswith('.db') or f.endswith('.sqlite'):
                continue
            fp = os.path.join(root, f)
            arcname = os.path.relpath(fp, backend_dir)
            zf.write(fp, arcname)
print("Backend zip:", backend_zip, os.path.getsize(backend_zip), "bytes")

# 列出包内容
with zipfile.ZipFile(frontend_zip) as zf:
    print("Frontend contents:", zf.namelist())
with zipfile.ZipFile(backend_zip) as zf:
    print("Backend contents:", zf.namelist())
