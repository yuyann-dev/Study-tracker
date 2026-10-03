# -*- coding: utf-8 -*-
import zipfile, os, io, gzip

# 自动以本脚本所在目录为项目根，解压到任意位置都能直接打包，无需手改路径
base = os.path.dirname(os.path.abspath(__file__))
dist = os.path.join(base, "dist")
os.makedirs(dist, exist_ok=True)

# 需要 gzip_static 预压缩的文本资源（离线 level9 压缩，部署后 Nginx 直接发送 .gz，
# 免去每次请求实时压缩的 CPU 开销，显著降低 TTFB）
PRECOMPRESS = {'index.html', 'sw.js', 'manifest.json'}

# 前端包
frontend_zip = os.path.join(dist, "frontend.zip")
with zipfile.ZipFile(frontend_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    frontend_dir = os.path.join(base, "frontend")
    for root, dirs, files in os.walk(frontend_dir):
        for f in files:
            fp = os.path.join(root, f)
            arcname = os.path.relpath(fp, frontend_dir)
            zf.write(fp, arcname)
            if f in PRECOMPRESS:
                with open(fp, 'rb') as fh:
                    raw = fh.read()
                gz = gzip.compress(raw, compresslevel=9, mtime=0)
                zf.writestr(arcname + '.gz', gz)
print("Frontend zip:", frontend_zip, os.path.getsize(frontend_zip), "bytes")

# 后端包（排除 node_modules、.env、运行期 data/logs、数据库文件）
backend_zip = os.path.join(dist, "backend.zip")
with zipfile.ZipFile(backend_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    backend_dir = os.path.join(base, "backend")
    for root, dirs, files in os.walk(backend_dir):
        # 排除运行期目录：node_modules（依赖）、data（数据库+备份）、logs（日志）
        if 'node_modules' in root or os.sep + 'data' in root or root.endswith(os.sep + 'data') or os.sep + 'logs' in root or root.endswith(os.sep + 'logs'):
            continue
        for f in files:
            if f == '.env':
                continue
            # 排除 SQLite 数据库及其 WAL/SHM 临时文件
            if f.endswith('.db') or f.endswith('.sqlite') or f.endswith('.db-wal') or f.endswith('.db-shm'):
                continue
            if f.startswith('test_') and f.endswith('.js'):
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
