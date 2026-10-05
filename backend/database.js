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

    -- 自习室（轻量学习小组）：一个用户同时只能在 1 个房间；房间没人时物理删除，不留空房
    CREATE TABLE IF NOT EXISTS study_rooms (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code   TEXT NOT NULL UNIQUE,               -- 6 位房间号（大写，去除 I/L/O/0/1 易混淆字符）
      name        TEXT NOT NULL,                      -- 房间名（≤20 字）
      owner_id    INTEGER NOT NULL REFERENCES users(id),
      is_public   INTEGER NOT NULL DEFAULT 0,        -- 0=私有（默认，只能凭房间号加入），1=公开（进入公开广场）
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS study_room_members (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id     INTEGER NOT NULL REFERENCES study_rooms(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at   TEXT DEFAULT (datetime('now')),    -- 房主退出时按此升序选最早加入者继承
      UNIQUE(room_id, user_id),                 -- 一个用户在一个房间只有一条记录
      UNIQUE(user_id)                           -- 全表唯一：一个用户同时只能加入一个自习室
    );

    -- ══════════════ AI 助手相关表（M1+M2，全部幂等新建，只加表不改老表）══════════════
    -- AI 配置：每用户一行。encrypted_api_key 为 AES-256-GCM 密文（见 utils/aiCrypto.js），
    -- key_salt 为该用户专属随机 salt（base64），key_preview 仅末 4 位用于回显，绝不存明文。
    CREATE TABLE IF NOT EXISTS ai_configs (
      user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider           TEXT NOT NULL DEFAULT 'deepseek',
      base_url           TEXT,
      model              TEXT,
      encrypted_api_key  TEXT,
      key_salt           TEXT,
      key_preview        TEXT,
      mode               TEXT NOT NULL DEFAULT 'quick',
      preference         TEXT NOT NULL DEFAULT 'budget',
      quick_model        TEXT,
      deep_model         TEXT,
      daily_token_budget INTEGER NOT NULL DEFAULT 100000,
      enabled            INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT DEFAULT (datetime('now')),
      updated_at         TEXT DEFAULT (datetime('now'))
    );

    -- 会话：一个用户多个对话；last_at 用于列表倒序
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT,
      last_at    TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- 消息：属于某会话；user_id 冗余便于按人清理；actions_json 为该条回复附带的结构化动作
    CREATE TABLE IF NOT EXISTS ai_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL,
      role            TEXT NOT NULL,                 -- user / assistant
      content         TEXT NOT NULL,
      intent          TEXT,
      actions_json    TEXT,
      tokens_in       INTEGER NOT NULL DEFAULT 0,
      tokens_out      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    -- 用户画像：每用户一行；profile_json 为归纳后画像，edited_fields_json 为用户手改、
    -- 大模型不得覆盖的字段名数组
    CREATE TABLE IF NOT EXISTS ai_profile (
      user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      profile_json      TEXT,
      edited_fields_json TEXT NOT NULL DEFAULT '[]',
      built_at          TEXT,
      updated_at        TEXT DEFAULT (datetime('now'))
    );

    -- 长期记忆：用户随口的偏好/目标/事实，按 strength 排序注入 prompt
    CREATE TABLE IF NOT EXISTS ai_memory (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind              TEXT NOT NULL,             -- preference / goal / fact
      content           TEXT NOT NULL,
      strength          INTEGER NOT NULL DEFAULT 1,
      source_message_id INTEGER,
      created_at        TEXT DEFAULT (datetime('now')),
      last_used_at      TEXT
    );

    -- 建议应用与撤销日志：前端真正落库后上报，服务端记录逆操作 inverse_json 供 op 级回滚
    CREATE TABLE IF NOT EXISTS ai_action_logs (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL,
      conversation_id  INTEGER,
      message_id       INTEGER,
      action_type      TEXT,
      actions_json     TEXT,
      selected_json    TEXT,
      inverse_json     TEXT,
      store_sig_before TEXT,
      store_sig_after  TEXT,
      status           TEXT NOT NULL DEFAULT 'applied',  -- applied / undone / partial
      applied_at       TEXT DEFAULT (datetime('now')),
      undone_at        TEXT
    );

    -- 每日 token 用量：按 (user_id, date) 累计，用于每日预算 enforcement
    CREATE TABLE IF NOT EXISTS ai_usage_daily (
      user_id    INTEGER NOT NULL,
      date       TEXT NOT NULL,                   -- YYYY-MM-DD
      tokens_in  INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      calls      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, date)
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
  // v8: 自习室隐私开关——0=未公开（默认），1=公开今日打卡状态+学习图表给同房间成员
  ensureColumn(db, 'users', 'study_room_public', 'INTEGER NOT NULL DEFAULT 0');
  // v1.1: 自习室是否公开到广场——0=私有（默认，只能凭房间号加入），1=公开（广场可见可加入）
  ensureColumn(db, 'study_rooms', 'is_public', 'INTEGER NOT NULL DEFAULT 0');
  // v5: user_data 项目数冗余列
  ensureColumn(db, 'user_data', 'project_count', 'INTEGER NOT NULL DEFAULT 0');
  // AI 助手：mode（quick/deep）列老库幂等补列
  ensureColumn(db, 'ai_configs', 'mode', "TEXT NOT NULL DEFAULT 'quick'");
  // AI 助手：用户模型偏好 budget/quality（老库幂等补列）
  ensureColumn(db, 'ai_configs', 'preference', "TEXT NOT NULL DEFAULT 'budget'");
  // AI 助手：用户自定义的 quick/deep 模型名（未自定义时由 PUT 时写入服务商默认推荐模型）
  ensureColumn(db, 'ai_configs', 'quick_model', 'TEXT');
  ensureColumn(db, 'ai_configs', 'deep_model', 'TEXT');
  // AI 助手：用户默认每日可学分钟数（0.5h-16h），chat 未传 budgetMin 时作默认
  ensureColumn(db, 'ai_configs', 'daily_study_minutes', 'INTEGER NOT NULL DEFAULT 240');
  // AI 助手：是否允许AI读取长期记忆（默认开启）
  ensureColumn(db, 'ai_configs', 'memory_enabled', 'INTEGER NOT NULL DEFAULT 1');
  // AI 助手：会话置顶
  ensureColumn(db, 'ai_conversations', 'is_pinned', 'INTEGER NOT NULL DEFAULT 0');
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
    CREATE INDEX IF NOT EXISTS idx_study_rooms_code ON study_rooms(room_code);
    CREATE INDEX IF NOT EXISTS idx_study_rooms_owner ON study_rooms(owner_id);
    CREATE INDEX IF NOT EXISTS idx_members_room ON study_room_members(room_id);
    CREATE INDEX IF NOT EXISTS idx_members_user ON study_room_members(user_id);

    -- AI 助手表索引
    CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations(user_id, last_at);
    CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id, id);
    CREATE INDEX IF NOT EXISTS idx_ai_msg_user ON ai_messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_memory_user ON ai_memory(user_id, strength);
    CREATE INDEX IF NOT EXISTS idx_ai_action_user ON ai_action_logs(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_date ON ai_usage_daily(user_id, date);
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

/**
 * v7.1 表重建：老库 invite_codes.used_by 列定义是 `INTEGER REFERENCES users(id)`（带外键），
 * 新设计该列存 JSON 数组（TEXT、无外键）。SQLite 无法 ALTER 列删外键，
 * 用「建新表 → 拷数据并转换 used_by → 删旧表 → 改名 → 重建索引」完成，幂等。
 * @param {import('better-sqlite3').Database} db
 */
function rebuildInviteCodesTable(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='invite_codes'").get();
  if (!row || !row.sql) return;
  const line = row.sql.match(/used_by[^,\n]*/i);
  // 仅当 used_by 列定义里仍带 REFERENCES（外键）才需要重建
  if (!line || !/REFERENCES/i.test(line[0])) return;

  const tx = db.transaction(() => {
    db.exec('PRAGMA defer_foreign_keys = ON;');
    db.exec(`
      CREATE TABLE invite_codes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        created_by INTEGER REFERENCES users(id),
        used_by TEXT DEFAULT '[]',
        used_count INTEGER NOT NULL DEFAULT 0,
        max_uses INTEGER NOT NULL DEFAULT 1,
        used_at TEXT,
        expires_at TEXT,
        note TEXT,
        channel TEXT,
        revoked_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    const rows = db.prepare('SELECT * FROM invite_codes').all();
    const ins = db.prepare(`INSERT INTO invite_codes_new
      (id,code,created_by,used_by,used_count,max_uses,used_at,expires_at,note,channel,revoked_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of rows) {
      let arr = [];
      const ub = r.used_by;
      if (ub === null || ub === undefined || ub === '') arr = [];
      else if (typeof ub === 'number' || /^\d+$/.test(String(ub))) arr = [Number(ub)];
      else {
        try { const p = JSON.parse(ub); arr = Array.isArray(p) ? p : (Number.isFinite(p) ? [p] : []); }
        catch (e) { arr = []; }
      }
      const usedCount = Math.max(Number.isFinite(r.used_count) ? r.used_count : 0, arr.length);
      ins.run(r.id, r.code, r.created_by, JSON.stringify(arr), usedCount,
        Number.isFinite(r.max_uses) ? r.max_uses : 1,
        r.used_at, r.expires_at, r.note, r.channel, r.revoked_at, r.created_at);
    }
    db.exec('DROP TABLE invite_codes;');
    db.exec('ALTER TABLE invite_codes_new RENAME TO invite_codes;');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
      CREATE INDEX IF NOT EXISTS idx_invite_codes_used_by ON invite_codes(used_by);
      CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by ON invite_codes(created_by);
    `);
  });
  tx();
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

// 先做表重建（去掉 used_by 列残留外键），重建后 used_by 即 TEXT 数组
try { rebuildInviteCodesTable(db); }
catch (e) { console.warn('rebuild invite_codes skipped:', e.message); }

// v7 数据迁移：将旧格式 used_by（单用户 INTEGER 或 NULL）统一为 JSON 数组字符串，
// 并根据是否被使用设置 used_count。幂等：只处理纯数字或 NULL 的行，已是 '[' 开头则跳过。
try {
  const rows = db.prepare("SELECT id, used_by FROM invite_codes").all();
  const upd = db.prepare("UPDATE invite_codes SET used_by = ?, used_count = ? WHERE id = ?");
  for (const row of rows) {
    try {
      const ub = row.used_by;
      if (ub === null || ub === undefined || ub === '') {
        upd.run('[]', 0, row.id);
      } else if (typeof ub === 'number' || /^\d+$/.test(String(ub))) {
        // 旧格式：单用户 ID → JSON 数组，已使用 1 次
        upd.run('[' + Number(ub) + ']', 1, row.id);
      }
      // 已是 '[' 开头的 JSON 数组格式，不处理
    } catch (rowE) {
      // 单行失败（如历史脏数据 created_by 外键指向已失效用户，UPDATE 会触发整行外键检查）
      // 不阻断其余行迁移；该行由 admin.js 的数组兜底保护，不会再 5xx
      console.warn('migrate used_by row id=' + row.id + ' skipped:', rowE.message);
    }
  }
} catch (e) {
  console.warn('migrate invite_codes.used_by to JSON array skipped:', e.message);
}

// v7.2 修正 used_count：历史库可能 used_by 已记录使用者、但 used_count 未维护（为 0），
// 这会让一次性邀请码被误判「还能使用」（注册判断 used_count < max_uses）。
// 以 used_by 数组长度为准兜底，幂等。
try {
  const rows = db.prepare("SELECT id, used_by, used_count FROM invite_codes").all();
  const fix = db.prepare("UPDATE invite_codes SET used_count = ? WHERE id = ?");
  for (const r of rows) {
    let n = 0;
    try { const p = JSON.parse(r.used_by || '[]'); n = Array.isArray(p) ? p.length : 0; } catch (e) { n = 0; }
    if (n > (r.used_count || 0)) fix.run(n, r.id);
  }
} catch (e) {
  console.warn('fix invite_codes.used_count skipped:', e.message);
}

module.exports = db;
module.exports.runMigrations = runMigrations;
module.exports.ensureColumn = ensureColumn;
