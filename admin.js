/**
 * routes/admin.js — 管理员后台
 *
 *   GET    /stats                  全局统计
 *   GET    /users                  用户列表（含项目数、最后同步、数据量）
 *   POST   /invite/generate        生成邀请码（可批量、可设有效期）
 *   GET    /invite/list            邀请码列表
 *   PUT    /users/:id/status       启用/禁用用户
 *   PUT    /users/:id/admin        设置/取消管理员
 *   DELETE /users/:id              删除用户（连同云端数据）
 *   DELETE /invite/:code           作废/删除邀请码
 *
 * 整个路由挂载在 authRequired + requireAdmin 之后。
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const { RULES } = require('../config');
const { authRequired, requireAdmin } = require('../middleware/auth');
const { ok, fail } = require('../utils/respond');

const router = express.Router();
router.use(authRequired, requireAdmin);

/**
 * 从 store_json 解析项目数量；解析失败返回 0
 */
function projectCountOf(storeJson) {
  if (!storeJson) return 0;
  try {
    const s = JSON.parse(storeJson);
    return s && s.projects ? Object.keys(s.projects).length : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * 随机生成一个邀请码（去掉易混淆字符）
 */
function generateCode() {
  const buf = crypto.randomBytes(RULES.inviteLength);
  let out = '';
  for (let i = 0; i < RULES.inviteLength; i++) out += RULES.inviteAlphabet[buf[i] % RULES.inviteAlphabet.length];
  return out;
}

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    const activeUsers = db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'active'").get().c;
    const disabledUsers = db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'disabled'").get().c;
    const totalInviteCodes = db.prepare('SELECT COUNT(*) AS c FROM invite_codes').get().c;
    const unusedInviteCodes = db.prepare('SELECT COUNT(*) AS c FROM invite_codes WHERE used_by IS NULL AND used_at IS NULL').get().c;
    const usedInviteCodes = db.prepare('SELECT COUNT(*) AS c FROM invite_codes WHERE used_at IS NOT NULL').get().c;
    const expiredInviteCodes = db.prepare(
      "SELECT COUNT(*) AS c FROM invite_codes WHERE used_at IS NULL AND expires_at IS NOT NULL AND expires_at < datetime('now')"
    ).get().c;
    // 近 7 天有同步的用户
    const active7d = db.prepare(
      "SELECT COUNT(*) AS c FROM user_data WHERE updated_at >= datetime('now','-7 days')"
    ).get().c;
    // 总项目数 & 存储大小
    const stores = db.prepare('SELECT store_json FROM user_data').all();
    let totalProjects = 0;
    let dataBytes = 0;
    stores.forEach((r) => {
      totalProjects += projectCountOf(r.store_json);
      dataBytes += r.store_json ? r.store_json.length : 0;
    });
    const dataSizeMB = Math.round((dataBytes / 1024 / 1024) * 100) / 100;
    return ok(res, {
      totalUsers, activeUsers, disabledUsers,
      totalInviteCodes, unusedInviteCodes, usedInviteCodes, expiredInviteCodes,
      active7d, totalProjects, dataSizeMB,
    });
  } catch (e) {
    console.error('admin/stats:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// GET /api/admin/users
router.get('/users', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.email, u.is_admin, u.status, u.created_at,
                d.store_json, d.updated_at AS last_sync
         FROM users u LEFT JOIN user_data d ON d.user_id = u.id ORDER BY u.id ASC`
      )
      .all();
    const users = rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      isAdmin: r.is_admin === 1,
      status: r.status,
      createdAt: r.created_at,
      lastSyncAt: r.last_sync || null,
      projectCount: projectCountOf(r.store_json),
      dataSizeMB: Math.round(((r.store_json ? r.store_json.length : 0) / 1024 / 1024) * 100) / 100,
    }));
    return ok(res, { users });
  } catch (e) {
    console.error('admin/users:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// POST /api/admin/invite/generate  body: { count?, expiresInDays? }
router.post('/invite/generate', (req, res) => {
  try {
    const { count, expiresInDays } = req.body || {};
    const n = Math.max(1, Math.min(50, parseInt(count, 10) || 1));
    let expiresAt = null;
    if (expiresInDays !== undefined && expiresInDays !== null && !isNaN(Number(expiresInDays))) {
      const days = Number(expiresInDays);
      if (days > 0) expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
    }

    const insert = db.prepare('INSERT INTO invite_codes (code, created_by, expires_at) VALUES (?, ?, ?)');
    const codes = [];
    for (let i = 0; i < n; i++) {
      let code = generateCode();
      let guard = 0;
      while (db.prepare('SELECT id FROM invite_codes WHERE code = ?').get(code) && guard < 5) {
        code = generateCode();
        guard++;
      }
      insert.run(code, req.user.id, expiresAt);
      codes.push(code);
    }
    return ok(res, { codes });
  } catch (e) {
    console.error('admin/invite/generate:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// GET /api/admin/invite/list
router.get('/invite/list', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT c.code, c.created_by, cb.username AS created_by_name,
                c.used_by, ub.username AS used_by_name,
                c.used_at, c.expires_at, c.created_at
         FROM invite_codes c
         LEFT JOIN users cb ON cb.id = c.created_by
         LEFT JOIN users ub ON ub.id = c.used_by
         ORDER BY c.id DESC`
      )
      .all();
    return ok(res, {
      codes: rows.map((r) => ({
        code: r.code,
        createdBy: r.created_by,
        createdByName: r.created_by_name,
        usedBy: r.used_by,
        usedByName: r.used_by_name,
        usedAt: r.used_at,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    console.error('admin/invite/list:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// PUT /api/admin/users/:id/status  body: { status: 'active'|'disabled' }
router.put('/users/:id/status', (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const { status } = req.body || {};
    if (!['active', 'disabled'].includes(status)) return fail(res, 'status 必须为 active 或 disabled');
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return fail(res, '用户不存在', 404);

    if (targetId === req.user.id && status === 'disabled') return fail(res, '不能禁用自己');

    // 至少保留一个可用管理员
    if (target.is_admin === 1 && status === 'disabled') {
      const adminCount = db
        .prepare("SELECT COUNT(*) AS c FROM users WHERE is_admin = 1 AND status = 'active'")
        .get().c;
      if (adminCount <= 1) return fail(res, '至少保留一个可用管理员');
    }

    db.prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, targetId);
    const row = db.prepare('SELECT id, username, email, is_admin, status FROM users WHERE id = ?').get(targetId);
    return ok(res, {
      user: {
        id: row.id,
        username: row.username,
        email: row.email,
        isAdmin: row.is_admin === 1,
        status: row.status,
      },
    });
  } catch (e) {
    console.error('admin/users/:id/status:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// PUT /api/admin/users/:id/admin  body: { isAdmin: boolean }
router.put('/users/:id/admin', (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const makeAdmin = !!(req.body && req.body.isAdmin);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return fail(res, '用户不存在', 404);
    if (targetId === req.user.id && !makeAdmin) return fail(res, '不能取消自己的管理员身份');

    // 降级时至少保留一个可用管理员
    if (target.is_admin === 1 && !makeAdmin) {
      const adminCount = db
        .prepare("SELECT COUNT(*) AS c FROM users WHERE is_admin = 1 AND status = 'active'")
        .get().c;
      if (adminCount <= 1) return fail(res, '至少保留一个可用管理员');
    }

    db.prepare("UPDATE users SET is_admin = ?, updated_at = datetime('now') WHERE id = ?")
      .run(makeAdmin ? 1 : 0, targetId);
    return ok(res, { id: targetId, isAdmin: makeAdmin });
  } catch (e) {
    console.error('admin/users/:id/admin:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// DELETE /api/admin/users/:id  删除用户及其云端数据
router.delete('/users/:id', (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return fail(res, '用户不存在', 404);
    if (targetId === req.user.id) return fail(res, '不能删除自己');

    if (target.is_admin === 1) {
      const adminCount = db
        .prepare("SELECT COUNT(*) AS c FROM users WHERE is_admin = 1 AND status = 'active'")
        .get().c;
      if (adminCount <= 1) return fail(res, '至少保留一个可用管理员');
    }

    const removeUser = db.transaction(() => {
      // 解除邀请码外键引用（保留 used_at 记录，仅置空使用者/创建者）
      db.prepare('UPDATE invite_codes SET created_by = NULL WHERE created_by = ?').run(targetId);
      db.prepare('UPDATE invite_codes SET used_by = NULL WHERE used_by = ?').run(targetId);
      // user_data 由外键 ON DELETE CASCADE 自动删除
      db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    });
    removeUser();
    return ok(res, { id: targetId, deleted: true });
  } catch (e) {
    console.error('admin/users DELETE:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// DELETE /api/admin/invite/:code  作废并删除邀请码
router.delete('/invite/:code', (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    const info = db.prepare('DELETE FROM invite_codes WHERE code = ?').run(code);
    if (info.changes === 0) return fail(res, '邀请码不存在', 404);
    return ok(res, { code, deleted: true });
  } catch (e) {
    console.error('admin/invite DELETE:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

module.exports = router;
