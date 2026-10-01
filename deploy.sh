#!/bin/bash
# Study Tracker 全栈部署脚本
# 在腾讯云轻量服务器 OpenCloudOS 9.6 上执行
# 用法: bash deploy.sh [前端zip路径] [后端zip路径]

set -e

FRONTEND_ZIP="${1:-/tmp/frontend.zip}"
BACKEND_ZIP="${2:-/tmp/backend.zip}"

echo "=== Study Tracker 全栈部署 ==="
echo "前端包: $FRONTEND_ZIP"
echo "后端包: $BACKEND_ZIP"

# 1. 安装 Node.js 18（如果未安装）
if ! command -v node &> /dev/null; then
    echo "[1/7] 安装 Node.js 18..."
    curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
    dnf install -y nodejs
else
    echo "[1/7] Node.js 已安装: $(node -v)"
fi

# 2. 创建目录结构
echo "[2/7] 创建目录结构..."
mkdir -p /opt/study-tracker/backend
mkdir -p /opt/study-tracker/backend/uploads
mkdir -p /opt/study-tracker/backend/data
mkdir -p /var/www/yystudy
mkdir -p /var/www/certbot
mkdir -p /etc/nginx/ssl/yystudy.top

# 3. 部署前端
echo "[3/7] 部署前端静态文件..."
if [ -f "$FRONTEND_ZIP" ]; then
    rm -rf /var/www/yystudy/*
    unzip -o "$FRONTEND_ZIP" -d /var/www/yystudy/
    # 如果 zip 内有子目录，把文件移出来
    if [ -d /var/www/yystudy/frontend ]; then
        mv /var/www/yystudy/frontend/* /var/www/yystudy/
        rmdir /var/www/yystudy/frontend
    fi
    chown -R nginx:nginx /var/www/yystudy/
    echo "  前端文件:"
    ls -la /var/www/yystudy/
else
    echo "  ⚠️ 前端包不存在，跳过"
fi

# 4. 部署后端
echo "[4/7] 部署后端服务..."
if [ -f "$BACKEND_ZIP" ]; then
    rm -rf /opt/study-tracker/backend/*
    unzip -o "$BACKEND_ZIP" -d /opt/study-tracker/backend/
    # 如果 zip 内有子目录
    if [ -d /opt/study-tracker/backend/backend ]; then
        mv /opt/study-tracker/backend/backend/* /opt/study-tracker/backend/
        rmdir /opt/study-tracker/backend/backend
    fi
    cd /opt/study-tracker/backend
    # 安装依赖
    if [ -f package.json ]; then
        npm install --production
    fi
    mkdir -p uploads data
    echo "  后端文件:"
    ls -la /opt/study-tracker/backend/
else
    echo "  ⚠️ 后端包不存在，跳过"
fi

# 5. 配置 systemd 服务
echo "[5/7] 配置 systemd 服务..."
if [ -f /opt/study-tracker/backend/server.js ]; then
    cp /opt/study-tracker/backend/study-tracker.service /etc/systemd/system/study-tracker.service 2>/dev/null || true
    # 确保服务文件存在（如果包内没有则从已知位置复制）
    if [ ! -f /etc/systemd/system/study-tracker.service ]; then
        cat > /etc/systemd/system/study-tracker.service << 'EOF'
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

[Install]
WantedBy=multi-user.target
EOF
    fi
    systemctl daemon-reload
    systemctl enable study-tracker
    systemctl restart study-tracker
    sleep 2
    systemctl status study-tracker --no-pager | head -10
else
    echo "  ⚠️ 后端 server.js 不存在，跳过服务配置"
fi

# 6. 配置 Nginx
echo "[6/7] 配置 Nginx..."
# 先配置 HTTP 版本用于证书申请
cat > /etc/nginx/conf.d/yystudy.conf << 'NGINX_EOF'
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
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX_EOF

nginx -t && systemctl reload nginx
echo "  Nginx HTTP 配置已加载"

# 7. 申请 SSL 证书（需要 DNS 已解析）
echo "[7/7] SSL 证书配置..."
if command -v certbot &> /dev/null; then
    echo "  certbot 已安装"
else
    echo "  安装 certbot..."
    dnf install -y certbot
fi

echo ""
echo "=== 部署完成 ==="
echo "下一步:"
echo "  1. 确认 DNS 已解析 yystudy.top → 43.142.72.50"
echo "  2. 运行: certbot certonly --webroot -w /var/www/certbot -d yystudy.top -d www.yystudy.top --email your@email.com --agree-tos --no-eff-email"
echo "  3. 证书生成后运行: bash /opt/study-tracker/enable-https.sh"
echo "  4. 验证: https://yystudy.top"
echo ""
echo "后端服务状态: systemctl status study-tracker"
echo "后端日志: journalctl -u study-tracker -f"
