/**
 * database.js — SQLite 初始化与幂等迁移
 *
 * 表结构演进：
 *   v1 (初版): users(username, password_hash, avatar)
 *              user_data(user_id PK, store_json, updated_at)
 *   v2:        users 新增 email / is_admin / status；新增 invite_codes 表
 *   v3:        email 改为 UNIQUE 成为登录账号（username 仅展示可重名）
 *   v4:        users 新增 password_changed_at（重置 token 一次性失效）
 *   v5 (当前): 安全/合规/可观测性一批改造——
 *                users        新增 ban_reason/ban_until（临时封禁）、
 *                             failed_login_count/locked_until（登录爆破锁定）、
 *                             token_version（JWT 强制下线）、
 *                             last_login_ip/last_login_at、deleted_at（软删除/回收站）
 *                invite_codes 新增 note/channel（渠道归因）、revoked_at（软作废）
 *                user_data    新增 project_count（admin 列表免 JSON.parse 全表）
 *                新增 login_logs（登录审计）、audit_logs（管理员操作审计）
 *
 * 升级策略（铁律：只加列/加表，不改列不删列，迁移幂等）：
 *   - 新库：CREATE TABLE IF NOT EXISTS 直接带上新列。
 *   - 老库：runMigrations 内 ensureColumn 逐列幂等补列，重复执行不报错。
 *   - 未来加字段时：① 在 CREATE TABLE 里加新列；② 调 ensureColumn('table','col','def')。
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { config } = require('./config');

const DATA_DIR = path.dirname(config.dbFile);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * 在给定连接上执行全部建表 + 幂等补列迁移。
 * 抽成函数便于：① 启动时在主库跑一次；② 迁移自测脚本对临时库连跑两次验证幂等。
 * @param {import('better-sqlite3').Database} db
 */
function runMigrations(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -20000'); // 约 20MB 页缓存（负数表示 KB）
  db.pragma('temp_store = MEMORY');

  db.exec(`
    -- users 表。username 仅作展示昵称可重名；email 是唯一登录账号（存小写）
    CREATE TABLE IF NOT EXISTS users (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      username           TEXT NOT NULL,
      password_hash      TEXT NOT NULL,
      avatar             TEXT,
      email              TEXT NOT NULL UNIQUE,
      is_admin           INTEGER NOT NULL DEFAULT 0,
      status             TEXT NOT NULL DEFAULT 'active',
      ban_reason         TEXT,
      ban_until          TEXT,
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until       TEXT,
      token_version      INTEGER NOT NULL DEFAULT 0,
      last_login_ip      TEXT,
      last_login_at      TEXT,
      deleted_at         TEXT,
      created_at         TEXT DEFAULT (datetime('now')),
      updated_at         TEXT DEFAULT (datetime('now'))
    );

    -- 每个用户一份全量 store 快照；project_count 由 PUT /api/data 合并后维护，
    -- 供 admin 列表直接读取，避免 JSON.parse 全表。
    CREATE TABLE IF NOT EXISTS user_data (
      user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      store_json   TEXT NOT NULL,
      project_count INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT DEFAULT (datetime('now'))
    );

    -- 邀请码注册制；note/channel 用于分发渠道归因；revoked_at 软作废（已使用码保留历史）
    -- max_uses 最大使用次数（默认1，即一次性）；used_count 已使用次数（冗余列，便于原子递增和查询）
    -- used_by 存储 JSON 数组（如 [1,2,3]），记录所有使用过该邀请码的用户 ID
    CREATE TABLE IF NOT EXISTS invite_codes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      code       TEXT UNIQUE NOT NULL,
      created_by INTEGER REFERENCES users(id),
      used_by    TEXT DEFAULT '[]',
      used_at    TEXT DEFAULT NULL,
      expires_at TEXT DEFAULT NULL,
      note       TEXT,
      channel    TEXT,
      revoked_at TEXT DEFAULT NULL,
      max_uses   INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 登录审计：每次登录成功/失败/锁定/注册/重置密码都写一条（不分库，够用级追溯）
    CREATE TABLE IF NOT EXISTS login_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER,
      username   TEXT,
      ip         TEXT,
      ua         TEXT,
      result     TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- 管理员操作审计：谁在何时对谁做了什么（仅超管可查）
    CREATE TABLE IF NOT EXISTS audit_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id    INTEGER,
      action      TEXT,
      target_type TEXT,
      target_id   TEXT,
      detail_json TEXT,
      ip          TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
  `);

  // ---- 幂等补列：老库缺哪列补哪列（重复执行安全）----
  // 注意：必须先补列、再建索引（老库 users 表已存在，CREATE TABLE IF NOT EXISTS 不补列，
  // 若在补列前就建 idx_users_deleted 会因列不存在而报错）。
  ensureColumn(db, 'users', 'email', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'status', "TEXT NOT NULL DEFAULT 'active'");
  // v4: 密码修改时间，用于让旧的重置 token 立即失效
  ensureColumn(db, 'users', 'password_changed_at', 'TEXT');
  // v5: 风控 / 强制下线 / 登录审计 / 软删除
  ensureColumn(db, 'users', 'ban_reason', 'TEXT');
  ensureColumn(db, 'users', 'ban_until', 'TEXT');
  ensureColumn(db, 'users', 'failed_login_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'locked_until', 'TEXT');
  ensureColumn(db, 'users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'last_login_ip', 'TEXT');
  ensureColumn(db, 'users', 'last_login_at', 'TEXT');
  ensureColumn(db, 'users', 'deleted_at', 'TEXT');
  // v6: 注销原因（self=用户自助注销，admin=管理员软删除），用于管理员面板区分
  ensureColumn(db, 'users', 'delete_reason', 'TEXT');
  // v5: user_data 项目数冗余列
  ensureColumn(db, 'user_data', 'project_count', 'INTEGER NOT NULL DEFAULT 0');
  // v5: 邀请码渠道 / 软作废
  ensureColumn(db, 'invite_codes', 'note', 'TEXT');
  ensureColumn(db, 'invite_codes', 'channel', 'TEXT');
  ensureColumn(db, 'invite_codes', 'revoked_at', 'TEXT');
  // v7: 多用户邀请码——max_uses 最大使用次数（默认1=一次性），used_count 已使用次数
  ensureColumn(db, 'invite_codes', 'max_uses', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'invite_codes', 'used_count', 'INTEGER NOT NULL DEFAULT 0');

  // 索引在补列之后创建，确保老库所需列已存在；IF NOT EXISTS 保证幂等
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
    CREATE INDEX IF NOT EXISTS idx_invite_codes_used_by ON invite_codes(used_by);
    CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by ON invite_codes(created_by);
    CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_login_logs_created ON login_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON audit_logs(admin_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
  `);
}

/**
 * 幂等补列：若老库缺某列则 ALTER TABLE 加上。
 * @param {import('better-sqlite3').Database} db
 * @param {string} table 表名
 * @param {string} column 列名
 * @param {string} def 列定义，如 "TEXT NOT NULL DEFAULT ''"
 */
function ensureColumn(db, table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

const db = new Database(config.dbFile);
runMigrations(db);

// 一次性数据归一化：将 invite_codes.expires_at 从旧的 toISOString() 格式（含 T/Z）
// 统一为 datetime('now') 兼容的 'YYYY-MM-DD HH:MM:SS' 格式，确保过期判断正确。
// 幂等：只处理含 'T' 的行，执行一次后不再匹配。
try {
  db.prepare("UPDATE invite_codes SET expires_at = datetime(expires_at) WHERE expires_at LIKE '%T%'").run();
} catch (e) {
  console.warn('normalize invite_codes.expires_at skipped:', e.message);
}

// v7 数据迁移：将旧格式 used_by（单用户 INTEGER 或 NULL）统一为 JSON 数组字符串，
// 并根据是否被使用设置 used_count。幂等：只处理纯数字或 NULL 的行，已是 '[' 开头则跳过。
try {
  const rows = db.prepare("SELECT id, used_by FROM invite_codes").all();
  const upd = db.prepare("UPDATE invite_codes SET used_by = ?, used_count = ? WHERE id = ?");
  for (const row of rows) {
    const ub = row.used_by;
    if (ub === null || ub === undefined || ub === '') {
      upd.run('[]', 0, row.id);
    } else if (typeof ub === 'number' || /^\d+$/.test(String(ub))) {
      // 旧格式：单用户 ID → JSON 数组，已使用 1 次
      upd.run('[' + Number(ub) + ']', 1, row.id);
    }
    // 已是 '[' 开头的 JSON 数组格式，不处理
  }
} catch (e) {
  console.warn('migrate invite_codes.used_by to JSON array skipped:', e.message);
}

module.exports = db;
module.exports.runMigrations = runMigrations;
module.exports.ensureColumn = ensureColumn;
