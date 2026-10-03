#!/bin/bash
set -e
echo "=== Study Tracker 全栈部署开始 ==="

# 1. 安装 Node.js 18（如果未安装）
if ! command -v node &> /dev/null; then
    echo "[1/6] 安装 Node.js 18..."
    curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
    dnf install -y nodejs
else
    echo "[1/6] Node.js 已安装: $(node -v)"
fi

# 2. 创建目录
echo "[2/6] 创建目录结构..."
mkdir -p /opt/study-tracker/backend/uploads
mkdir -p /opt/study-tracker/backend/data
mkdir -p /var/www/yystudy
mkdir -p /var/www/certbot
mkdir -p /etc/nginx/ssl/yystudy.top

# 3. 部署前端
echo "[3/6] 部署前端..."
if [ -f /tmp/fe.zip ]; then
    rm -rf /var/www/yystudy/*
    unzip -o /tmp/fe.zip -d /var/www/yystudy/
    if [ -d /var/www/yystudy/frontend ]; then
        mv /var/www/yystudy/frontend/* /var/www/yystudy/ 2>/dev/null || true
        rmdir /var/www/yystudy/frontend 2>/dev/null || true
    fi
    echo "  前端文件:"
    ls -la /var/www/yystudy/ | head -10
else
    echo "  ⚠️ /tmp/fe.zip 不存在"
fi

# 4. 部署后端
echo "[4/6] 部署后端..."
if [ -f /tmp/be.zip ]; then
    rm -rf /opt/study-tracker/backend/*
    unzip -o /tmp/be.zip -d /opt/study-tracker/backend/
    if [ -d /opt/study-tracker/backend/backend ]; then
        mv /opt/study-tracker/backend/backend/* /opt/study-tracker/backend/ 2>/dev/null || true
        rmdir /opt/study-tracker/backend/backend 2>/dev/null || true
    fi
    cd /opt/study-tracker/backend
    # 安装依赖
    if [ -f package.json ]; then
        npm install --production 2>&1 | tail -5
    fi
    mkdir -p uploads data
    echo "  后端文件:"
    ls -la /opt/study-tracker/backend/ | head -15
else
    echo "  ⚠️ /tmp/be.zip 不存在"
fi

# 5. 配置 .env
echo "[5/6] 配置环境变量..."
cat > /opt/study-tracker/backend/.env << 'ENVEOF'
PORT=3001
JWT_SECRET=st_prod_$(date +%s)_$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c 32)
APP_URL=https://yystudy.top
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=2719752623@qq.com
SMTP_PASS=
SMTP_FROM=Study Tracker <2719752623@qq.com>
ENVEOF

# 6. 配置 systemd 服务
echo "[6/6] 配置 systemd 服务..."
cat > /etc/systemd/system/study-tracker.service << 'SVCEOF'
[Unit]
Description=Study Tracker Backend API Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/study-tracker/backend
EnvironmentFile=/opt/study-tracker/backend/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=study-tracker

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable study-tracker
systemctl restart study-tracker
sleep 3
echo "  后端服务状态:"
systemctl status study-tracker --no-pager | head -8

# 7. 配置 Nginx（HTTP 版本，用于证书申请）
echo "[7/7] 配置 Nginx..."
cat > /etc/nginx/conf.d/yystudy.conf << 'NGINXEOF'
server {
    listen 80;
    server_name yystudy.top www.yystudy.top;
    root /var/www/yystudy;
    index index.html;
    server_tokens off;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 10m;
    }

    location /uploads/ {
        alias /opt/study-tracker/backend/uploads/;
        expires 7d;
    }

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/javascript application/javascript application/json image/svg+xml;

    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINXEOF

nginx -t 2>&1 && systemctl reload nginx
echo "  Nginx 配置已加载"

# 8. 测试 API
echo ""
echo "=== 部署完成 ==="
echo "后端 API 测试:"
curl -s http://localhost:3001/api/health 2>&1 || echo "  API 未响应（可能正在启动）"
echo ""
echo "下一步:"
echo "  1. 确认 DNS 已解析 yystudy.top → 43.142.72.50"
echo "  2. 申请 SSL 证书: certbot certonly --webroot -w /var/www/certbot -d yystudy.top -d www.yystudy.top"
echo "  3. 配置 HTTPS 后验证: https://yystudy.top"
echo ""
echo "后端日志: journalctl -u study-tracker -f"
echo "Nginx 日志: tail -f /var/log/nginx/access.log"
