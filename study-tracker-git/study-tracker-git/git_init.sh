#!/bin/bash
set -e

cd /opt/study-tracker

echo "=== 创建 .gitignore ==="
cat > .gitignore << 'EOF'
# 依赖
node_modules/

# 环境变量（含密钥，绝不提交）
.env
.env.*

# 数据库
backend/data/
*.db
*.db-journal
*.db-wal
*.db-shm

# 日志
backend/logs/
*.log
npm-debug.log*

# 上传文件
backend/uploads/

# 备份
backups/
*.bak
*.backup

# 预压缩文件（部署时生成）
*.gz

# 系统文件
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# 临时文件
tmp/
temp/
*.tmp
EOF

echo ".gitignore 已创建"

echo "=== 初始化 Git 仓库 ==="
git init
git config user.name "Study Tracker Deploy"
git config user.email "deploy@yystudy.top"
git config core.autocrlf input
git config push.default simple

echo "=== 添加文件并提交初始版本 ==="
git add -A
git status --short | head -30
echo "..."
echo "共 $(git status --short | wc -l) 个文件待提交"

git commit -m "chore: 初始化 Study Tracker 项目仓库

- 前端：单文件 index.html + PWA (manifest + service worker v20)
- 后端：Node.js Express + better-sqlite3
- 功能：刷题本、错题本、背书模块
- 图标 cache-busting (?v=2)，修复安卓 PWA 图标不更新
- ETag 304 增量同步，syncPending 防丢同步机制
- shimmer 骨架条美化加载状态
- 生产环境部署版本"

echo "=== 提交完成 ==="
git log --oneline -5
echo ""
echo "GIT_INIT_DONE"
