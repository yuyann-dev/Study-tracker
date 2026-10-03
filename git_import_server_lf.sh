#!/bin/bash
set -e

echo "=== 在服务器上导入 Git 历史 ==="

cd /opt/study-tracker

# 如果已有 .git 先备份
if [ -d .git ]; then
    mv .git .git.bak.$(date +%s)
    echo "已备份旧 .git"
else
    echo "无旧 .git，直接初始化"
fi

# 初始化并从 bundle 恢复
git init
git config user.name "Yu Yan"
git config user.email "yuyan@yystudy.top"
git config core.autocrlf input

# 从 bundle 拉取所有历史和标签
git fetch /tmp/study-tracker.bundle --tags
git reset --hard FETCH_HEAD

# 恢复标签
for tag in $(git bundle list-heads /tmp/study-tracker.bundle | grep refs/tags | awk '{print $2}'); do
    tagname=$(echo $tag | sed 's|refs/tags/||')
    git tag -f "$tagname" "$tag" 2>/dev/null || true
done

echo ""
echo "=== 导入完成，当前状态 ==="
git log --oneline -5
echo ""
echo "标签列表:"
git tag -l
echo ""
echo "当前文件状态:"
git status --short | head -10

echo ""
echo "GIT_IMPORT_DONE"
