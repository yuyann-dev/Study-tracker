#!/bin/bash
set -e

echo "=== 部署后端 data.js ==="
# 只替换修改的文件，绝不碰 .env 和 node_modules
cp -f /tmp/deploy_backend/routes/data.js /opt/study-tracker/backend/routes/data.js
echo "data.js 已更新"

echo "=== 设置权限 ==="
chown study:study /opt/study-tracker/backend/routes/data.js
chmod 640 /opt/study-tracker/backend/routes/data.js
echo "权限已设置"

echo "=== 验证 .env 和 node_modules 未被触碰 ==="
ls -la /opt/study-tracker/backend/.env
ls -d /opt/study-tracker/backend/node_modules
echo ".env 和 node_modules 完好"

echo "=== 重启 study-tracker 服务 ==="
systemctl restart study-tracker
sleep 2
systemctl status study-tracker --no-pager | head -15

echo "=== 验证健康检查 ==="
sleep 1
curl -s http://127.0.0.1:3001/api/health

echo ""
echo "BACKEND_DEPLOY_DONE"
