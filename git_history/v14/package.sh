#!/bin/bash
# 打包前端和后端为 zip，准备上传到服务器
# 在本地项目根目录运行

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$PROJECT_DIR/dist"
mkdir -p "$OUT_DIR"

echo "=== 打包 Study Tracker ==="
echo "项目目录: $PROJECT_DIR"

# 打包前端
echo "[1/2] 打包前端..."
cd "$PROJECT_DIR/frontend"
zip -r "$OUT_DIR/frontend.zip" . -x "*.DS_Store"
echo "  生成: $OUT_DIR/frontend.zip ($(du -h "$OUT_DIR/frontend.zip" | cut -f1))"

# 打包后端（不含 node_modules 和 data）
echo "[2/2] 打包后端..."
cd "$PROJECT_DIR/backend"
zip -r "$OUT_DIR/backend.zip" . -x "node_modules/*" "data/*" "uploads/*" ".env" "*.DS_Store"
echo "  生成: $OUT_DIR/backend.zip ($(du -h "$OUT_DIR/backend.zip" | cut -f1))"

echo ""
echo "=== 打包完成 ==="
echo "上传命令:"
echo "  scp $OUT_DIR/frontend.zip root@43.142.72.50:/tmp/"
echo "  scp $OUT_DIR/backend.zip root@43.142.72.50:/tmp/"
echo "  scp $PROJECT_DIR/deploy/deploy.sh root@43.142.72.50:/tmp/"
echo "然后在服务器运行: bash /tmp/deploy.sh /tmp/frontend.zip /tmp/backend.zip"
