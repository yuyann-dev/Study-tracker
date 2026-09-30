/**
 * database.js — SQLite 初始化与幂等迁移
 *
 * 表结构：
 *   v1 (初版): users(username, username_lower, password_hash, avatar)
 *              user_data(user_id PK, store_json, updated_at)
 *   v2:        users 新增 email / is_admin / status；新增 invite_codes 表
 *   v3 (当前): 去掉 username_lower（昵称可重名），email 改为 UNIQUE 成为登录账号
 *   v4:        users 新增 password_changed_at，用于重置 token 一次性失效
 *
 * 升级策略：CREATE TABLE IF NOT EXISTS 建新库；老库用 ensureColumn 幂等补列。
 * 未来加字段时：
 *   1) 在 CREATE TABLE 语句里加上新列（新库直接有）
 *   2) 调 ensureColumn('users', 'new_col', 'TEXT NOT NULL DEFAULT ...')（老库补列）
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { config } = require('./config');

const DATA_DIR = path.dirname(config.dbFile);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(config.dbFile);

// WAL：读写并发更好；外键约束打开
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- v3: users 表。username 仅作展示昵称可重名；email 是唯一登录账号（存小写）
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar        TEXT,
    email         TEXT NOT NULL UNIQUE,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  );

  -- 每个用户一份全量 store 快照
  CREATE TABLE IF NOT EXISTS user_data (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    store_json TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- v2: 邀请码注册制
  CREATE TABLE IF NOT EXISTS invite_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT UNIQUE NOT NULL,
    created_by INTEGER REFERENCES users(id),
    used_by    INTEGER REFERENCES users(id) DEFAULT NULL,
    used_at    TEXT DEFAULT NULL,
    expires_at TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
`);

/**
 * 幂等补列：若老库缺某列则 ALTER TABLE 加上。
 * @param {string} table 表名
 * @param {string} column 列名
 * @param {string} def 列定义，如 "TEXT NOT NULL DEFAULT ''"
 */
function ensureColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}
ensureColumn('users', 'email', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'status', "TEXT NOT NULL DEFAULT 'active'");
// v4: 密码修改时间（TEXT, SQLite datetime 字符串），用于让旧的重置 token 立即失效
ensureColumn('users', 'password_changed_at', "TEXT");

module.exports = db;
