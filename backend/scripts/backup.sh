#!/usr/bin/env bash
# backend/scripts/backup.sh — SQLite 在线热备
#
# 用 sqlite3 ".backup" 做在线一致性热备（WAL 下安全，不锁库、不影响在线读写）。
# 输出：/opt/study-tracker/backend/data/backups/study-YYYY-MM-DD.db
# 保留策略：近 7 天的每日备份 + 每月 1 号的一份（月度归档，长期保留）。
# 失败时通过 utils/alert.js 复用 SMTP 发邮件告警（1 小时去重，避免轰炸）。
#
# 异地备份（rsync/scp 到另一台机器 / 对象存储）默认注释，按需取消注释填值：
#   OFFSITE_DIR=user@other:/path/study-backups/
#
# 由 systemd study-backup.timer 每日 03:00 调用；也可手动 bash scripts/backup.sh。
set -euo pipefail

# ── 路径（部署基准 /opt/study-tracker/backend）──
APP_DIR="/opt/study-tracker/backend"
DB_FILE="$APP_DIR/data/study.db"
BACKUP_DIR="$APP_DIR/data/backups"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%F)"
OUT="$BACKUP_DIR/study-$STAMP.db"

alert() {
  # $1=类别 $2=标题 $3=正文；await 异步发信，告警失败绝不影响备份退出码
  cd "$APP_DIR"
  node -e "(async()=>{ await require('./utils/alert').alert(process.argv[1], process.argv[2], process.argv[3]); process.exit(0); })().catch(e=>{console.error(e);process.exit(0)})" "$1" "$2" "$3" \
    >/dev/null 2>&1 || echo "[backup] alert 发送失败(忽略): $1"
}

echo "[backup] $(date -Is) 开始热备 $DB_FILE -> $OUT"

# 在线一致性备份（优先 sqlite3 .backup；无 sqlite3 CLI 时回退 cp）
if command -v sqlite3 >/dev/null 2>&1; then
  if ! sqlite3 "$DB_FILE" ".backup '$OUT'"; then
    echo "[backup] sqlite3 .backup 失败"
    alert backup_failed "数据库热备失败" "sqlite3 .backup 失败于 $(date -Is)，DB=$DB_FILE"
    exit 1
  fi
else
  echo "[backup] 未找到 sqlite3 CLI，回退 cp 热备"
  if ! cp "$DB_FILE" "$OUT"; then
    echo "[backup] cp 备份失败"
    alert backup_failed "数据库热备失败" "cp 备份失败于 $(date -Is)，DB=$DB_FILE"
    exit 1
  fi
fi

# 简单校验备份文件非空
if [ ! -s "$OUT" ]; then
  echo "[backup] 备份文件为空，判失败"
  alert backup_failed "数据库热备失败" "生成的备份文件为空: $OUT"
  exit 1
fi

# ── 保留策略：删除 7 天前的每日备份，但保留每月 1 号的月度归档 ──
find "$BACKUP_DIR" -name 'study-*.db' -mtime +7 \
  ! -name '*-01.db' -delete || true

echo "[backup] 完成: $OUT ($(du -h "$OUT" | cut -f1))"

# ── 可选异地备份：取消注释并填 OFFSITE_DIR ──
# OFFSITE_DIR=""
# if [ -n "$OFFSITE_DIR" ]; then
#   echo "[backup] rsync 到 $OFFSITE_DIR"
#   rsync -az --timeout=60 "$OUT" "$OFFSITE_DIR/" \
#     || alert backup_failed "异地备份失败" "rsync 到 $OFFSITE_DIR 失败"
# fi
