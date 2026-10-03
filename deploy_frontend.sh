#!/bin/bash
# 部署前端文件
set -e

echo "=== 移动前端文件 ==="
cp -f /tmp/deploy_frontend/index.html /var/www/yystudy/
cp -f /tmp/deploy_frontend/sw.js /var/www/yystudy/
cp -f /tmp/deploy_frontend/manifest.json /var/www/yystudy/
cp -f /tmp/deploy_frontend/icon-192.png /var/www/yystudy/
cp -f /tmp/deploy_frontend/icon-512.png /var/www/yystudy/
cp -f /tmp/deploy_frontend/apple-touch-icon.png /var/www/yystudy/
cp -f /tmp/deploy_frontend/favicon-64.png /var/www/yystudy/
echo "文件移动完成"

echo "=== 生成 gzip 预压缩 ==="
cd /var/www/yystudy/
for f in index.html sw.js manifest.json; do
    gzip -c -9 "$f" > "${f}.gz"
    echo "Generated ${f}.gz ($(wc -c < ${f}.gz) bytes)"
done

echo "=== 设置权限 ==="
chown -R study:study /var/www/yystudy/
chmod -R go+rX /var/www/yystudy/
echo "权限设置完成"

echo "=== 部署结果 ==="
ls -la /var/www/yystudy/index.html /var/www/yystudy/sw.js /var/www/yystudy/manifest.json
ls -la /var/www/yystudy/*.gz

echo "FRONTEND_DEPLOY_DONE"
