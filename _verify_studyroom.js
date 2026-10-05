// 一次性迁移验证脚本：确认新表/索引/列存在，并在临时库上连跑两遍验证幂等
const db = require('./backend/database');

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'study_%' ORDER BY name")
  .all()
  .map((r) => r.name);
const indexes = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND (name LIKE 'idx_study%' OR name LIKE 'idx_members%') ORDER BY name"
  )
  .all()
  .map((r) => r.name);
const hasCol = db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'study_room_public');

console.log('real DB migrations load OK');
console.log('tables:', tables.join(','));
console.log('indexes:', indexes.join(','));
console.log('users.study_room_public column:', hasCol);

// 临时库连跑两遍 runMigrations，验证幂等（老库重复执行不报错）
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = path.join(os.tmpdir(), 'study_mig_idem_' + Date.now() + '.db');
process.env.DB_FILE = tmp;
const Database = require('better-sqlite3');
const tmpDb = new Database(tmp);
const { runMigrations } = require('./backend/database');
runMigrations(tmpDb);
runMigrations(tmpDb); // 第二遍：幂等
console.log('idempotent double-run on fresh DB OK');
tmpDb.close();
try { fs.unlinkSync(tmp); } catch (_) {}
