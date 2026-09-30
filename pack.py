# -*- coding: utf-8 -*-
import zipfile, os, io

base = r"C:\Users\MXyuan\Doubao\chats\2026-09-22\new-chat\study-tracker-fullstack"
dist = os.path.join(base, "dist")
os.makedirs(dist, exist_ok=True)

# 打包前端
frontend_zip = os.path.join(dist, "frontend.zip")
with zipfile.ZipFile(frontend_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    frontend_dir = os.path.join(base, "frontend")
    for root, dirs, files in os.walk(frontend_dir):
        for f in files:
            full = os.path.join(root, f)
            arc = os.path.relpath(full, frontend_dir)
            zf.write(full, arc)
print(f"前端: {frontend_zip} ({os.path.getsize(frontend_zip)} bytes)")

# 打包后端（排除node_modules）
backend_zip = os.path.join(dist, "backend.zip")
with zipfile.ZipFile(backend_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    backend_dir = os.path.join(base, "backend")
    for root, dirs, files in os.walk(backend_dir):
        # 排除node_modules
        dirs[:] = [d for d in dirs if d != 'node_modules']
        for f in files:
            full = os.path.join(root, f)
            arc = os.path.relpath(full, backend_dir)
            zf.write(full, arc)
    # 把部署脚本也打进去
    deploy_dir = os.path.join(base, "deploy")
    for f in os.listdir(deploy_dir):
        full = os.path.join(deploy_dir, f)
        if os.path.isfile(full):
            zf.write(full, os.path.join("deploy", f))
print(f"后端: {backend_zip} ({os.path.getsize(backend_zip)} bytes)")

print("打包完成")
