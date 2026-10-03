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
    echo "[1/8] 安装 Node.js 18..."
    curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
    dnf install -y nodejs
else
    echo "[1/8] Node.js 已安装: $(node -v)"
fi

# 2. 创建目录结构
echo "[2/8] 创建目录结构..."
mkdir -p /opt/study-tracker/backend
mkdir -p /opt/study-tracker/backend/uploads
mkdir -p /opt/study-tracker/backend/data
mkdir -p /var/www/yystudy
mkdir -p /var/www/certbot
mkdir -p /etc/nginx/ssl/yystudy.top

# 3. 部署前端
echo "[3/8] 部署前端静态文件..."
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

# 4. 部署后端（保留 uploads/ 与 data/：升级不丢用户头像和数据库）
echo "[4/8] 部署后端服务..."
if [ -f "$BACKEND_ZIP" ]; then
    # 解压到临时暂存目录，避免直接清空目标目录导致运行期数据被删
    STAGING_DIR=$(mktemp -d)
    unzip -o "$BACKEND_ZIP" -d "$STAGING_DIR"
    # 如果 zip 内有 backend/ 子目录，把内容提升到暂存根（兼容旧打包结构）
    # 与 pack_deploy.py 对齐：正式打包文件在 zip 根，此分支仅为防御
    if [ -d "$STAGING_DIR/backend" ]; then
        mv "$STAGING_DIR/backend/"* "$STAGING_DIR/"
        rmdir "$STAGING_DIR/backend"
    fi
    # 确保目标目录存在
    mkdir -p /opt/study-tracker/backend
    # 覆盖代码文件到目标，但跳过运行期目录 uploads/ 和 data/
    # （暂存目录里即使有同名条目也不复制，保留生产环境已有头像与数据库）
    for entry in "$STAGING_DIR"/*; do
        name=$(basename "$entry")
        if [ "$name" = "uploads" ] || [ "$name" = "data" ]; then
            continue
        fi
        cp -r "$entry" /opt/study-tracker/backend/
    done
    # 处理隐藏文件（如 .env.example 等）
    for entry in "$STAGING_DIR"/.[!.]*; do
        [ -e "$entry" ] || continue
        cp -r "$entry" /opt/study-tracker/backend/
    done
    rm -rf "$STAGING_DIR"

    cd /opt/study-tracker/backend
    # 安装依赖
    if [ -f package.json ]; then
        npm install --production
    fi
    # 确保运行期目录存在（首次部署时创建；重部署时已存在则保留原内容）
    mkdir -p uploads data
    echo "  后端文件:"
    ls -la /opt/study-tracker/backend/
else
    echo "  ⚠️ 后端包不存在，跳过"
fi

# 5. 配置 systemd 服务
echo "[5/8] 配置 systemd 服务..."
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

# 6. 权限收敛：nginx 经 alias 直接发头像，需要能穿透目录树读到 uploads/
#    服务按 root 运行（与 systemd unit 一致），owner 权限保留即可。
#    本步骤幂等，重复执行不产生副作用。
echo "[6/8] 收敛文件权限..."

# 6.1 源码硬化：对 backend 整个目录递归关闭 group/other 的 rwx
#     覆盖 routes/、utils/、middleware/、scripts/、node_modules/ 及散落的 *.js/*.json
#     等所有源码与依赖；.env.example 等隐藏文件一并收紧。
#     owner(root) 权限完全保留——服务按 root 运行，读源码/依赖不受影响。
#     uploads/、data/、.env 是运行期例外，下面 6.2~6.5 逐一重新放开。
chmod -R go-rwx /opt/study-tracker/backend

# 6.2 例外：父目录仅给 other 遍历权（x），不给读（r）
#     nginx 需要穿过 /opt/study-tracker 和 backend 两层才能到达 uploads/
#     注意：6.1 的递归会把 backend 目录本身也 go-rwx 掉，这里必须补回 o+x
chmod o+x /opt/study-tracker /opt/study-tracker/backend

# 6.3 例外：uploads 目录及内容 go+rX
#     目录可遍历（X = 已有执行位才加，即目录天然有 x）、文件可读（r），
#     nginx 经 alias 能发出头像图片
chmod -R go+rX /opt/study-tracker/backend/uploads

# 6.4 例外：data 目录保持 700
#     SQLite 数据库文件仅 root 可读写，nginx 无权访问
chmod 700 /opt/study-tracker/backend/data

# 6.5 例外：.env 保持 600
#     含 JWT_SECRET / SMTP 密码等敏感配置，仅 root 可读
chmod 600 /opt/study-tracker/backend/.env 2>/dev/null || true

echo "  权限收敛完成"

# 7. 配置 Nginx
echo "[7/8] 配置 Nginx..."
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

# 8. 申请 SSL 证书（需要 DNS 已解析）
echo "[8/8] SSL 证书配置..."
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
