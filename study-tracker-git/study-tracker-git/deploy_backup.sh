#!/bin/bash
set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 1. 备份当前前端
echo "=== 备份前端 ==="
cp -a /var/www/yystudy /var/www/yystudy.bak.${TIMESTAMP}
echo "前端已备份到 /var/www/yystudy.bak.${TIMESTAMP}"

# 2. 备份当前后端
echo "=== 备份后端 ==="
BACKUP_DIR=/opt/study-tracker/backend.bak.${TIMESTAMP}
mkdir -p ${BACKUP_DIR}/routes ${BACKUP_DIR}/utils ${BACKUP_DIR}/middleware
cp /opt/study-tracker/backend/routes/data.js ${BACKUP_DIR}/routes/ 2>/dev/null || true
cp /opt/study-tracker/backend/server.js ${BACKUP_DIR}/ 2>/dev/null || true
echo "后端已备份到 ${BACKUP_DIR}"

# 3. 检查当前 git 状态
echo "=== Git 状态检查 ==="
cd /opt/study-tracker
if [ -d .git ]; then
    echo "Git 仓库已存在"
    git log --oneline -5 2>/dev/null || echo "暂无提交"
else
    echo "Git 仓库不存在，需要初始化"
fi

echo "=== 备份完成 ==="
