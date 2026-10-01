#!/bin/bash
# 启用 HTTPS：证书申请成功后运行
# 将 Nginx 配置切换为 HTTPS 版本，80 端口自动跳转 443

set -e

CERT_DIR="/etc/letsencrypt/live/yystudy.top"
SSL_DIR="/etc/nginx/ssl/yystudy.top"

echo "=== 启用 HTTPS ==="

# 检查证书
if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
    echo "❌ 证书不存在: $CERT_DIR/fullchain.pem"
    echo "请先运行: certbot certonly --webroot -w /var/www/certbot -d yystudy.top -d www.yystudy.top"
    exit 1
fi

# 复制证书到 Nginx 目录（方便管理）
mkdir -p "$SSL_DIR"
cp "$CERT_DIR/fullchain.pem" "$SSL_DIR/fullchain.pem"
cp "$CERT_DIR/privkey.pem" "$SSL_DIR/privkey.pem"
chmod 600 "$SSL_DIR/privkey.pem"

# 写入 HTTPS 版 Nginx 配置
cat > /etc/nginx/conf.d/yystudy.conf << 'NGINX_EOF'
# HTTP → HTTPS 跳转
server {
    listen 80;
    listen [::]:80;
    server_name yystudy.top www.yystudy.top;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS 主配置
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name yystudy.top www.yystudy.top;

    ssl_certificate     /etc/nginx/ssl/yystudy.top/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/yystudy.top/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    server_tokens off;
    root /var/www/yystudy;
    index index.html;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml image/svg+xml;
    gzip_comp_level 6;

    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
        try_files $uri =404;
    }

    location ~* \.(png|jpg|jpeg|gif|ico|svg|webp)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    location = /manifest.json {
        expires 1d;
        add_header Cache-Control "public";
        try_files $uri =404;
    }

    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        try_files $uri =404;
    }

    location /uploads/ {
        alias /opt/study-tracker/backend/uploads/;
        expires 7d;
        add_header Cache-Control "public";
        try_files $uri =404;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        client_max_body_size 10m;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~ /\.(?!well-known) {
        deny all;
    }
}
NGINX_EOF

# 测试并重载
nginx -t
systemctl reload nginx

echo ""
echo "✅ HTTPS 已启用！"
echo "   验证: curl -I https://yystudy.top"
echo "   证书续期: certbot renew --dry-run"

# 设置自动续期 cron
if ! crontab -l 2>/dev/null | grep -q certbot; then
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --deploy-hook 'cp /etc/letsencrypt/live/yystudy.top/fullchain.pem /etc/nginx/ssl/yystudy.top/fullchain.pem && cp /etc/letsencrypt/live/yystudy.top/privkey.pem /etc/nginx/ssl/yystudy.top/privkey.pem && chmod 600 /etc/nginx/ssl/yystudy.top/privkey.pem && systemctl reload nginx'") | crontab -
    echo "   已添加证书自动续期定时任务"
fi
