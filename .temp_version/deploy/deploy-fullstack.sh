#!/bin/bash
# Study Tracker 全栈部署脚本
# 用法: bash deploy-fullstack.sh
# 前置: 已安装 Nginx、Node.js 18+、已放行 80/443 端口

set -e

echo "=== Study Tracker 全栈部署 ==="
echo "时间: $(date)"

# === 配置变量 ===
FRONTEND_URL="https://aka.doubaocdn.com/s/Vk6Jc1nipV"
BACKEND_URL="https://aka.doubaocdn.com/s/93QfTWmUkw"
WEB_ROOT="/var/www/yystudy"
BACKEND_DIR="/opt/study-tracker"
BACKEND_PORT=3001
DOMAIN="yystudy.top"
APP_URL="https://${DOMAIN}"

# === 1. 部署前端 ===
echo ""
echo "[1/6] 部署前端静态文件..."
mkdir -p ${WEB_ROOT}
cd /tmp
rm -rf frontend-deploy && mkdir frontend-deploy && cd frontend-deploy
curl -sL "${FRONTEND_URL}" -o frontend.zip
unzip -o frontend.zip -d ${WEB_ROOT}/
echo "前端文件已部署到 ${WEB_ROOT}"
ls -la ${WEB_ROOT}/

# === 2. 部署后端 ===
echo ""
echo "[2/6] 部署后端服务..."
mkdir -p ${BACKEND_DIR}
cd /tmp
rm -rf backend-deploy && mkdir backend-deploy && cd backend-deploy
curl -sL "${BACKEND_URL}" -o backend.zip
unzip -o backend.zip -d ${BACKEND_DIR}/
cd ${BACKEND_DIR}

# 安装依赖
echo "安装 npm 依赖 (better-sqlite3 需要编译，可能需要1-2分钟)..."
npm install --production 2>&1 | tail -5

# === 3. 配置后端环境变量 ===
echo ""
echo "[3/6] 配置后端环境变量..."
if [ ! -f ${BACKEND_DIR}/.env ]; then
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > ${BACKEND_DIR}/.env << EOF
PORT=${BACKEND_PORT}
JWT_SECRET=${JWT_SECRET}
APP_URL=${APP_URL}
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=2719752623@qq.com
SMTP_PASS=
SMTP_FROM=Study Tracker <2719752623@qq.com>
EOF
  echo "已生成 .env (JWT_SECRET 已随机生成)"
else
  echo ".env 已存在，跳过生成"
fi
cat ${BACKEND_DIR}/.env | grep -v SMTP_PASS

# === 4. 创建 systemd 服务 ===
echo ""
echo "[4/6] 创建 systemd 服务..."
cat > /etc/systemd/system/study-tracker.service << EOF
[Unit]
Description=Study Tracker Backend API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${BACKEND_DIR}
ExecStart=/usr/bin/node ${BACKEND_DIR}/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable study-tracker
systemctl restart study-tracker
sleep 2
systemctl status study-tracker --no-pager | head -10

# === 5. 配置 Nginx 反代 ===
echo ""
echo "[5/6] 配置 Nginx 反代 /api -> 后端..."
cat > /etc/nginx/conf.d/yystudy.conf << 'NGINX_CONF'
server {
    listen 80 default_server;
    server_name yystudy.top www.yystudy.top;
    root /var/www/yystudy;
    index index.html;

    # gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;
    gzip_min_length 1024;

    # 隐藏版本号
    server_tokens off;

    # 上传大小限制（头像+数据同步）
    client_max_body_size 10m;

    # 安全头
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;

    # index.html 不缓存（保证更新即时生效）
    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # API 反代到后端
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    # SPA 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX_CONF

nginx -t && systemctl reload nginx
echo "Nginx 配置已更新并重载"

# === 6. 验证 ===
echo ""
echo "[6/6] 验证部署..."
echo "后端健康检查:"
curl -s http://127.0.0.1:3001/api/health 2>/dev/null || echo "  (后端可能需要更多时间启动)"
echo ""
echo "前端首页检查:"
curl -sI http://127.0.0.1/ | head -3
echo ""
echo "=== 部署完成 ==="
echo "前端: http://43.142.72.50/ (待DNS解析后用 https://yystudy.top)"
echo "后端: http://127.0.0.1:3001"
echo "日志: journalctl -u study-tracker -f"
echo "注意: SMTP_PASS 需要在 .env 中填写QQ邮箱授权码才能使用密码重置功能"
