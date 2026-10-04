/**
 * routes/admin.js — 管理员后台
 *
 *   GET    /stats                 全局统计（?days=7|14|30|90，DAU/新增/次日留存）
 *   GET    /system                服务器 + 备份 + 应用指标
 *   GET    /audit-logs            审计日志（分页，仅超管）
 *   GET    /users/export?format=csv  用户导出（静态路径，必须在 /users/:id 之前）
 *   GET    /users                 用户列表（q/status/isAdmin/page/pageSize，默认排除回收站）
 *   GET    /users/:id             用户详情
 *   POST   /users/:id/reset-password 管理员重置为临时密码
 *   PUT    /users/:id/status      启用/封禁（支持临时封禁 ban_until）
 *   PUT    /users/:id/admin       设置/取消管理员（仅超管）
 *   DELETE /users/:id             软删除（回收站 + 删除前导出 + 强制下线）
 *   POST   /users/:id/restore     从回收站恢复
 *   DELETE /users/:id/permanent   物理删除（仅对已软删用户）
 *   POST   /invite/generate       生成邀请码（支持 note/channel）
 *   GET    /invite/list           邀请码列表
 *   DELETE /invite/:code          软作废邀请码（已使用码禁删）
 *
 * 整个路由挂载在 authRequired + requireAdmin 之后。
 */
const express = require('express');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const db = require('../database');
const { config, RULES } = require('../config');
const { authRequired, requireAdmin, requireSuperAdmin, SUPER_ADMIN_ID } = require('../middleware/auth');
const { ok, fail } = require('../utils/respond');
const { writeAudit } = require('../utils/audit');
const metrics = require('../utils/metrics');

const router = express.Router();
router.use(authRequired, requireAdmin);

const ALLOWED_DAYS = [7, 14, 30, 90];

/** 规范化 days 参数 */
function clampDays(q) {
  const n = parseInt(q, 10);
  return ALLOWED_DAYS.includes(n) ? n : 14;
}

/** 随机生成一个邀请码（去掉易混淆字符） */
function generateCode() {
  const buf = crypto.randomBytes(RULES.inviteLength);
  let out = '';
  for (let i = 0; i < RULES.inviteLength; i++) out += RULES.inviteAlphabet[buf[i] % RULES.inviteAlphabet.length];
  return out;
}

/** 生成临时密码（字母+数字，12 位，一次性返回给管理员） */
function generateTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const buf = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

/** 导出某用户云端 store_json 到 backups/，返回文件路径（失败返回 null，不阻断主流程） */
function exportUserStore(userId) {
  try {
    if (!fs.existsSync(config.backupDir)) fs.mkdirSync(config.backupDir, { recursive: true });
    const row = db.prepare('SELECT store_json FROM user_data WHERE user_id = ?').get(userId);
    if (!row || !row.store_json) return null;
    const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const file = path.join(config.backupDir, `user-export-${userId}-${date}.json`);
    fs.writeFileSync(file, row.store_json, 'utf8');
    return file;
  } catch (e) {
    console.error('exportUserStore failed:', e.message);
    return null;
  }
}

// GET /api/admin/stats?days=7|14|30|90
router.get('/stats', (req, res) => {
  try {
    const days = clampDays(req.query.days);

    const totalUsers = db.prepare('SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL').get().c;
    const activeUsers = db.prepare("SELECT COUNT(*) AS c FROM users WHERE status='active' AND deleted_at IS NULL").get().c;
    const disabledUsers = db.prepare("SELECT COUNT(*) AS c FROM users WHERE status='disabled' AND deleted_at IS NULL").get().c;
    const totalInviteCodes = db.prepare('SELECT COUNT(*) AS c FROM invite_codes').get().c;
    const unusedInviteCodes = db.prepare('SELECT COUNT(*) AS c FROM invite_codes WHERE used_count = 0 AND revoked_at IS NULL').get().c;
    const usedInviteCodes = db.prepare('SELECT COUNT(*) AS c FROM invite_codes WHERE used_count > 0').get().c;
    const expiredInviteCodes = db.prepare(
      "SELECT COUNT(*) AS c FROM invite_codes WHERE used_count = 0 AND revoked_at IS NULL AND expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')"
    ).get().c;

    // 近 7 天有同步的用户
    const active7d = db.prepare(
      "SELECT COUNT(*) AS c FROM user_data WHERE updated_at >= datetime('now','-7 days')"
    ).get().c;

    // 总项目数（读冗余列，免 JSON.parse）与存储大小
    const agg = db.prepare('SELECT COALESCE(SUM(project_count),0) AS p, COALESCE(SUM(LENGTH(store_json)),0) AS b FROM user_data').get();
    const totalProjects = agg.p;
    const dataBytes = agg.b;
    const dataSizeMB = Math.round((dataBytes / 1024 / 1024) * 100) / 100;

    const quotaMB = config.storageQuota.totalMB;
    const storagePercent = Math.min(100, Math.round((dataSizeMB / quotaMB) * 1000) / 10);

    // DAU：当日有同步写库的去重用户数（按 days 窗口）
    const activeTrend = [];
    for (let i = days - 1; i >= 0; i--) {
      const row = db.prepare(
        "SELECT COUNT(DISTINCT user_id) AS c FROM user_data WHERE date(updated_at) = date('now', ?)"
      ).get(`-${i} days`);
      activeTrend.push(row.c);
    }

    // 新增用户趋势：users.created_at 按日
    const newRows = db.prepare(
      `SELECT date(created_at) AS d, COUNT(*) AS c FROM users
       WHERE deleted_at IS NULL AND created_at >= date('now', ?) GROUP BY d`
    ).all(`-${days - 1} days`);
    const newMap = {};
    newRows.forEach((r) => { newMap[r.d] = r.c; });
    const newUsersTrend = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = db.prepare("SELECT date('now', ?) AS d").get(`-${i} days`).d;
      newUsersTrend.push(newMap[d] || 0);
    }

    // 最简注册次日留存：窗口内注册用户中，有后续（次日及以后）同步记录的比例
    const ret = db.prepare(
      `SELECT COUNT(DISTINCT u.id) AS registered,
              COUNT(DISTINCT CASE WHEN date(d.updated_at) > date(u.created_at) THEN u.id END) AS returned
       FROM users u LEFT JOIN user_data d ON d.user_id = u.id
       WHERE u.deleted_at IS NULL AND u.created_at >= date('now', ?)`
    ).get(`-${days - 1} days`);
    const retentionNextDay = {
      registered: ret.registered,
      returned: ret.returned,
      rate: ret.registered ? Math.round((ret.returned / ret.registered) * 1000) / 10 : 0,
    };

    return ok(res, {
      days,
      totalUsers, activeUsers, disabledUsers,
      totalInviteCodes, unusedInviteCodes, usedInviteCodes, expiredInviteCodes,
      active7d, totalProjects, dataSizeMB,
      quotaMB, perUserQuotaMB: config.storageQuota.perUserMB,
      storagePercent, activeTrend, newUsersTrend, retentionNextDay,
    });
  } catch (e) {
    console.error('admin/stats:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// GET /api/admin/system — 服务器 + 备份 + 应用指标
router.get('/system', (req, res) => {
  try {
    let dbBytes = 0;
    [config.dbFile, config.dbFile + '-wal', config.dbFile + '-shm'].forEach((f) => {
      try { dbBytes += fs.statSync(f).size; } catch (_) {}
    });
    const dbSizeMB = Math.round((dbBytes / 1024 / 1024) * 100) / 100;

    let disk = null;
    try {
      const st = fs.statfsSync(path.dirname(config.dbFile));
      const total = st.blocks * st.bsize;
      const free = st.bavail * st.bsize;
      disk = {
        totalGB: Math.round((total / 1024 / 1024 / 1024) * 10) / 10,
        freeGB: Math.round((free / 1024 / 1024 / 1024) * 10) / 10,
        usedPercent: Math.round(((total - free) / total) * 1000) / 10,
      };
    } catch (_) {}

    // 备份目录最新一份备份信息
    let lastBackup = null;
    let backupStatus = 'none';
    try {
      if (fs.existsSync(config.backupDir)) {
        const files = fs.readdirSync(config.backupDir)
          .filter((f) => f.endsWith('.db'))
          .map((f) => {
            try { const s = fs.statSync(path.join(config.backupDir, f)); return { f, mtime: s.mtimeMs, size: s.size }; }
            catch (_) { return null; }
          })
          .filter(Boolean)
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length) {
          const latest = files[0];
          const ageH = (Date.now() - latest.mtime) / 3600000;
          lastBackup = { name: latest.f, at: new Date(latest.mtime).toISOString(), sizeBytes: latest.size };
          backupStatus = ageH <= 26 ? 'ok' : 'stale';
        }
      }
    } catch (_) {}

    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return ok(res, {
      nodeVersion: process.version,
      platform: `${os.type()} ${os.release()}`,
      hostname: os.hostname(),
      cpuCount: os.cpus().length,
      systemUptimeSec: Math.floor(os.uptime()),
      appUptimeSec: Math.floor(process.uptime()),
      memory: {
        totalMB: Math.round(totalMem / 1024 / 1024),
        usedPercent: Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10,
      },
      disk,
      dbSizeMB,
      backups: {
        lastBackupAt: lastBackup ? lastBackup.at : null,
        lastBackupSize: lastBackup ? lastBackup.size : 0,
        lastBackupName: lastBackup ? lastBackup.name : null,
        backupStatus,
      },
      appMetrics: metrics.snapshot(),
    });
  } catch (e) {
    console.error('admin/system:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// GET /api/admin/audit-logs?page&pageSize —— 仅超管可看
router.get('/audit-logs', requireSuperAdmin, (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(200, parseInt(req.query.pageSize, 10) || 20));
    const total = db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get().c;
    const rows = db.prepare(
      `SELECT a.id, a.admin_id, au.username AS admin_name, a.action, a.target_type, a.target_id,
              a.detail_json, a.ip, a.created_at
       FROM audit_logs a LEFT JOIN users au ON au.id = a.admin_id
       ORDER BY a.id DESC LIMIT ? OFFSET ?`
    ).all(pageSize, (page - 1) * pageSize);
    return ok(res, { items: rows, total, page, pageSize });
  } catch (e) {
    console.error('admin/audit-logs:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// GET /api/admin/users/export?format=csv —— 静态路径，必须定义在 /users/:id 之前
router.get('/users/export', (req, res) => {
  try {
    const rows = db.prepare(
      `SELECT u.id, u.username, u.email, u.is_admin, u.status, u.created_at,
              d.project_count, d.updated_at AS last_sync
       FROM users u LEFT JOIN user_data d ON d.user_id = u.id
       WHERE u.deleted_at IS NULL ORDER BY u.id ASC`
    ).all();
    const esc = (v) => {
      let s = v == null ? '' : String(v);
      // Formula Injection 防护：以 = + - @ 开头的字段前置单引号，防止 Excel 打开时执行公式
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [['id', 'username', 'email', 'isAdmin', 'status', 'projectCount', 'lastSync', 'createdAt'].join(',')];
    rows.forEach((r) => {
      lines.push([r.id, esc(r.username), esc(r.email), r.is_admin, r.status, r.project_count, r.last_sync || '', r.created_at || ''].join(','));
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="users-${Date.now()}.csv"`);
    return res.send('﻿' + lines.join('\n'));
  } catch (e) {
    console.error('admin/users/export:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// GET /api/admin/users?q=&status=&isAdmin=&page=&pageSize=
router.get('/users', (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(200, parseInt(req.query.pageSize, 10) || 20));
    const q = String(req.query.q || '').trim();
    const statusFilter = String(req.query.status || '').trim();
    const isAdminFilter = ['1', 'true', 'yes'].includes(String(req.query.isAdmin || '').toLowerCase());

    const where = [];
    const params = [];
    if (statusFilter === 'deleted') {
      where.push('u.deleted_at IS NOT NULL');
    } else {
      where.push('u.deleted_at IS NULL');
      if (['active', 'disabled'].includes(statusFilter)) {
        where.push('u.status = ?'); params.push(statusFilter);
      }
    }
    if (isAdminFilter) { where.push('u.is_admin = 1'); }
    if (q) {
      where.push('(u.username LIKE ? OR u.email LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const whereSql = 'WHERE ' + where.join(' AND ');

    const total = db.prepare(`SELECT COUNT(*) AS c FROM users u ${whereSql}`).get(...params).c;
    const rows = db.prepare(
      `SELECT u.id, u.username, u.email, u.is_admin, u.status, u.ban_reason, u.ban_until,
              u.last_login_ip, u.last_login_at, u.created_at, u.deleted_at, u.delete_reason,
              d.project_count, d.updated_at AS last_sync, LENGTH(d.store_json) AS bytes
       FROM users u LEFT JOIN user_data d ON d.user_id = u.id
       ${whereSql} ORDER BY u.id ASC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, (page - 1) * pageSize);

    const items = rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      isAdmin: r.is_admin === 1,
      isSuperAdmin: r.id === SUPER_ADMIN_ID,
      status: r.status,
      banReason: r.ban_reason,
      banUntil: r.ban_until,
      deletedAt: r.deleted_at,
      deleteReason: r.delete_reason,
      projectCount: r.project_count || 0,
      lastSyncAt: r.last_sync || null,
      lastLoginAt: r.last_login_at || null,
      lastLoginIp: r.last_login_ip || null,
      dataSizeMB: Math.round(((r.bytes || 0) / 1024 / 1024) * 100) / 100,
      createdAt: r.created_at,
    }));
    return ok(res, { items, total, page, pageSize });
  } catch (e) {
    console.error('admin/users:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// GET /api/admin/users/:id —— 用户详情
router.get('/users/:id', (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!u) return fail(res, '用户不存在', 404);
    const d = db.prepare('SELECT store_json, project_count, updated_at FROM user_data WHERE user_id = ?').get(targetId);
    const recentLogins = db.prepare(
      'SELECT ip, ua, result, created_at FROM login_logs WHERE user_id = ? ORDER BY id DESC LIMIT 5'
    ).all(targetId);
    // 邀请码：created_by = 用户创建的；used_by JSON 数组包含 = 用户使用过的
    const allCodes = db.prepare(
      `SELECT code, used_by, used_count, max_uses, used_at, note, channel, revoked_at, created_at
       FROM invite_codes WHERE created_by = ? ORDER BY id DESC`
    ).all(targetId);
    const usedCodes = db.prepare(
      `SELECT code, used_by, used_count, max_uses, used_at, note, channel, revoked_at, created_at
       FROM invite_codes`
    ).all();
    const userUsedCodes = usedCodes.filter((c) => {
      try { return JSON.parse(c.used_by || '[]').includes(targetId); } catch (e) { return false; }
    });
    // 合并去重（按 code）
    const codeMap = new Map();
    for (const c of allCodes) codeMap.set(c.code, c);
    for (const c of userUsedCodes) codeMap.set(c.code, c);
    const codes = Array.from(codeMap.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return ok(res, {
      user: {
        id: u.id, username: u.username, email: u.email,
        isAdmin: u.is_admin === 1, status: u.status,
        banReason: u.ban_reason, banUntil: u.ban_until,
        deletedAt: u.deleted_at, createdAt: u.created_at, updatedAt: u.updated_at,
        lastLoginIp: u.last_login_ip, lastLoginAt: u.last_login_at,
      },
      data: {
        sizeBytes: d && d.store_json ? d.store_json.length : 0,
        projectCount: d ? d.project_count : 0,
        lastSyncAt: d ? d.updated_at : null,
      },
      recentLogins,
      inviteCodes: codes,
    });
  } catch (e) {
    console.error('admin/users/:id:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// POST /api/admin/users/:id/reset-password —— 生成一次性临时密码
router.post('/users/:id/reset-password', (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return fail(res, '用户不存在', 404);
    if (targetId === SUPER_ADMIN_ID) return fail(res, '不能重置超级管理员密码', 403);
    // 普通管理员不能管理其他管理员（同级横向越权），仅超管可
    if (target.is_admin === 1 && req.user.id !== SUPER_ADMIN_ID) return fail(res, '不能管理其他管理员', 403);

    const temp = generateTempPassword();
    db.prepare(
      `UPDATE users SET password_hash = ?, password_changed_at = datetime('now'),
              token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?`
    ).run(require('bcryptjs').hashSync(temp, config.bcryptRounds), targetId);

    writeAudit(req.user.id, 'reset_password', 'user', targetId, { username: target.username }, req);
    return ok(res, { tempPassword: temp, message: '临时密码已生成，请转告用户并提醒其登录后立即修改' });
  } catch (e) {
    console.error('admin reset-password:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// PUT /api/admin/users/:id/status  body: { status, banReason?, banUntil? }
//   status=disabled + banUntil 为空 → 永久封禁；status=disabled + banUntil → 临时封禁（到期自动恢复）
router.put('/users/:id/status', (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const { status, banReason, banUntil } = req.body || {};
    if (!['active', 'disabled'].includes(status)) return fail(res, 'status 必须为 active 或 disabled');
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return fail(res, '用户不存在', 404);
    if (targetId === SUPER_ADMIN_ID) return fail(res, '不能管理超级管理员', 403);
    // 普通管理员不能管理其他管理员（同级横向越权），仅超管可
    if (target.is_admin === 1 && req.user.id !== SUPER_ADMIN_ID) return fail(res, '不能管理其他管理员', 403);
    if (targetId === req.user.id && status === 'disabled') return fail(res, '不能禁用自己');

    if (target.is_admin === 1 && status === 'disabled') {
      const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE is_admin = 1 AND status='active' AND deleted_at IS NULL").get().c;
      if (adminCount <= 1) return fail(res, '至少保留一个可用管理员');
    }

    if (status === 'disabled') {
      // 解析 banUntil（ISO 8601）→ SQLite UTC datetime；无效/为空视为永久封禁
      let banUntilSql = null;
      if (banUntil) {
        const ts = new Date(banUntil);
        if (!isNaN(ts.getTime())) banUntilSql = ts.toISOString().slice(0, 19).replace('T', ' ');
      }
      // 封禁即 token_version+1，强制其在线会话立即下线
      db.prepare(
        `UPDATE users SET status='disabled', ban_reason=?, ban_until=?,
                token_version = token_version + 1, updated_at=datetime('now') WHERE id=?`
      ).run(banReason ? String(banReason).slice(0, 200) : null, banUntilSql, targetId);
      writeAudit(req.user.id, 'ban_user', 'user', targetId,
        { banUntil: banUntilSql || 'permanent', reason: banReason || null }, req);
    } else {
      db.prepare(
        `UPDATE users SET status='active', ban_reason=NULL, ban_until=NULL, updated_at=datetime('now') WHERE id=?`
      ).run(targetId);
      writeAudit(req.user.id, 'unban_user', 'user', targetId, {}, req);
    }

    const row = db.prepare('SELECT id, username, email, is_admin, status FROM users WHERE id = ?').get(targetId);
    return ok(res, {
      user: { id: row.id, username: row.username, email: row.email, isAdmin: row.is_admin === 1, status: row.status },
    });
  } catch (e) {
    console.error('admin/users/:id/status:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// PUT /api/admin/users/:id/admin  body: { isAdmin: boolean }（仅超管）
router.put('/users/:id/admin', requireSuperAdmin, (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const makeAdmin = !!(req.body && req.body.isAdmin);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return fail(res, '用户不存在', 404);
    if (targetId === SUPER_ADMIN_ID && !makeAdmin) return fail(res, '超级管理员不可被降级', 403);
    if (targetId === req.user.id && !makeAdmin) return fail(res, '不能取消自己的管理员身份');

    // 降权为敏感操作：要求重输当前超级管理员密码（admin-55）
    if (!makeAdmin) {
      const rePassword = req.body && req.body.password ? String(req.body.password) : '';
      if (!rePassword) return fail(res, '请重新输入登录密码以确认', 400);
      const meRow = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!meRow || !require('bcryptjs').compareSync(rePassword, meRow.password_hash)) {
        return fail(res, '登录密码不正确，操作已取消', 403);
      }
    }

    if (target.is_admin === 1 && !makeAdmin) {
      const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE is_admin=1 AND status='active' AND deleted_at IS NULL").get().c;
      if (adminCount <= 1) return fail(res, '至少保留一个可用管理员');
    }

    db.prepare("UPDATE users SET is_admin = ?, updated_at = datetime('now') WHERE id = ?")
      .run(makeAdmin ? 1 : 0, targetId);
    writeAudit(req.user.id, makeAdmin ? 'grant_admin' : 'revoke_admin', 'user', targetId, {}, req);
    return ok(res, { id: targetId, isAdmin: makeAdmin });
  } catch (e) {
    console.error('admin/users/:id/admin:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// DELETE /api/admin/users/:id —— 软删除（回收站）：导出 + 删前留存 + 强制下线
router.delete('/users/:id', (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return fail(res, '用户不存在', 404);
    if (targetId === SUPER_ADMIN_ID) return fail(res, '不能删除超级管理员', 403);
    if (targetId === req.user.id) return fail(res, '不能删除自己');
    // 普通管理员不能删除其他管理员（同级横向越权），仅超管可
    if (target.is_admin === 1 && req.user.id !== SUPER_ADMIN_ID) return fail(res, '不能管理其他管理员', 403);
    if (target.deleted_at != null) return fail(res, '该用户已在回收站，如需彻底删除请用 permanent');

    if (target.is_admin === 1) {
      const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE is_admin=1 AND status='active' AND deleted_at IS NULL").get().c;
      if (adminCount <= 1) return fail(res, '至少保留一个可用管理员');
    }

    const exported = exportUserStore(targetId);
    const tx = db.transaction(() => {
      db.prepare('UPDATE invite_codes SET created_by = NULL WHERE created_by = ?').run(targetId);
      // 不清除 used_by：邀请码已被使用，保持已使用状态
      db.prepare(
        `UPDATE users SET deleted_at = datetime('now'), status='disabled', delete_reason='admin',
                token_version = token_version + 1, updated_at=datetime('now') WHERE id=?`
      ).run(targetId);
    });
    tx();
    writeAudit(req.user.id, 'soft_delete_user', 'user', targetId, { exportedTo: exported }, req);
    return ok(res, { id: targetId, deleted: true, recycled: true, exportedTo: exported });
  } catch (e) {
    console.error('admin/users DELETE:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// POST /api/admin/users/:id/restore —— 从回收站恢复
router.post('/users/:id/restore', (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return fail(res, '用户不存在', 404);
    if (target.deleted_at == null) return fail(res, '该用户未被删除');
    // 普通管理员不能管理其他管理员（同级横向越权），仅超管可
    if (target.is_admin === 1 && req.user.id !== SUPER_ADMIN_ID) return fail(res, '不能管理其他管理员', 403);
    db.prepare("UPDATE users SET deleted_at = NULL, status='active', delete_reason=NULL, updated_at=datetime('now') WHERE id=?")
      .run(targetId);
    writeAudit(req.user.id, 'restore_user', 'user', targetId, {}, req);
    return ok(res, { id: targetId, restored: true });
  } catch (e) {
    console.error('admin/users restore:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// DELETE /api/admin/users/:id/permanent —— 物理删除（仅对已软删用户，级联 user_data）
router.delete('/users/:id/permanent', (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!target) return fail(res, '用户不存在', 404);
    if (targetId === SUPER_ADMIN_ID) return fail(res, '不能删除超级管理员', 403);
    if (target.deleted_at == null) return fail(res, '请先软删除后再执行物理删除');
    // 普通管理员不能管理其他管理员（同级横向越权），仅超管可
    if (target.is_admin === 1 && req.user.id !== SUPER_ADMIN_ID) return fail(res, '不能管理其他管理员', 403);

    // 不可逆操作：要求重新输入当前管理员自己的登录密码（admin-55），防止会话被冒用误删
    const rePassword = req.body && req.body.password ? String(req.body.password) : '';
    if (!rePassword) return fail(res, '请重新输入登录密码以确认永久删除', 400);
    const me = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!me || !require('bcryptjs').compareSync(rePassword, me.password_hash)) {
      return fail(res, '登录密码不正确，操作已取消', 403);
    }

    const tx = db.transaction(() => {
      db.prepare('UPDATE invite_codes SET created_by = NULL WHERE created_by = ?').run(targetId);
      // 多用户邀请码：从 used_by JSON 数组中移除该用户 ID（事务内读取再更新），
      // used_count 不递减——邀请码已被实际使用过，不应回退使用次数。
      const allInvites = db.prepare('SELECT id, used_by FROM invite_codes').all();
      for (const inv of allInvites) {
        try {
          const arr = JSON.parse(inv.used_by || '[]');
          const filtered = arr.filter((uid) => uid !== targetId);
          if (filtered.length !== arr.length) {
            db.prepare('UPDATE invite_codes SET used_by = ? WHERE id = ?').run(JSON.stringify(filtered), inv.id);
          }
        } catch (e) { /* 非 JSON 格式跳过 */ }
      }
      db.prepare('DELETE FROM users WHERE id = ?').run(targetId); // user_data 外键级联删除
    });
    tx();
    writeAudit(req.user.id, 'permanent_delete_user', 'user', targetId, {}, req);
    return ok(res, { id: targetId, permanentlyDeleted: true });
  } catch (e) {
    console.error('admin/users permanent:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// POST /api/admin/invite/generate  body: { count?, expiresInDays?, note?, channel?, maxUses? }
router.post('/invite/generate', (req, res) => {
  try {
    const { count, expiresInDays, note, channel, maxUses } = req.body || {};
    const n = Math.max(1, Math.min(50, parseInt(count, 10) || 1));
    // 单码最大使用人数：默认1（一次性），范围1-10000
    const maxUsesVal = Math.max(1, Math.min(10000, parseInt(maxUses, 10) || 1));
    let expiresAt = null;
    if (expiresInDays !== undefined && expiresInDays !== null && !isNaN(Number(expiresInDays))) {
      const days = Number(expiresInDays);
      if (days > 0) expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    }
    const noteVal = note ? String(note).slice(0, 100) : null;
    const channelVal = channel ? String(channel).slice(0, 50) : null;

    const insert = db.prepare('INSERT INTO invite_codes (code, created_by, expires_at, note, channel, max_uses) VALUES (?, ?, ?, ?, ?, ?)');
    const codes = [];
    for (let i = 0; i < n; i++) {
      let code = generateCode();
      let guard = 0;
      while (db.prepare('SELECT id FROM invite_codes WHERE code = ?').get(code) && guard < 5) {
        code = generateCode(); guard++;
      }
      insert.run(code, req.user.id, expiresAt, noteVal, channelVal, maxUsesVal);
      codes.push(code);
    }
    writeAudit(req.user.id, 'generate_invite', 'invite', null, { count: n, note: noteVal, channel: channelVal, maxUses: maxUsesVal, codes }, req);
    return ok(res, { codes });
  } catch (e) {
    console.error('admin/invite/generate:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// GET /api/admin/invite/list
router.get('/invite/list', (req, res) => {
  try {
    const rows = db.prepare(
      `SELECT c.code, c.created_by, cb.username AS created_by_name,
              c.used_by, c.used_count, c.max_uses,
              c.used_at, c.expires_at, c.note, c.channel, c.revoked_at, c.created_at
       FROM invite_codes c
       LEFT JOIN users cb ON cb.id = c.created_by
       ORDER BY (c.used_count = 0 AND c.revoked_at IS NULL) DESC, c.id DESC`
    ).all();

    // 收集所有 used_by JSON 数组中的用户 ID，批量查用户名（避免 N+1 查询）
    const userIdSet = new Set();
    for (const r of rows) {
      try {
        const arr = JSON.parse(r.used_by || '[]');
        for (const uid of arr) userIdSet.add(uid);
      } catch (e) { /* 非 JSON 格式跳过 */ }
    }
    const userMap = {};
    if (userIdSet.size > 0) {
      const placeholders = Array.from(userIdSet).map(() => '?').join(',');
      const userRows = db.prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`).all(...Array.from(userIdSet));
      for (const u of userRows) userMap[u.id] = u.username;
    }

    return ok(res, {
      codes: rows.map((r) => {
        let usedUserIds = [];
        try { usedUserIds = JSON.parse(r.used_by || '[]'); } catch (e) { /* 非 JSON 格式 */ }
        return {
          code: r.code,
          createdBy: r.created_by,
          createdByName: r.created_by_name,
          usedBy: usedUserIds,
          usedByNames: usedUserIds.map((uid) => userMap[uid] || `用户#${uid}`),
          usedCount: r.used_count,
          maxUses: r.max_uses,
          usedAt: r.used_at,
          expiresAt: r.expires_at,
          note: r.note,
          channel: r.channel,
          revokedAt: r.revoked_at,
          createdAt: r.created_at,
        };
      }),
    });
  } catch (e) {
    console.error('admin/invite/list:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// DELETE /api/admin/invite/:code —— 已使用码禁删；未使用码软作废（保留分发统计）
router.delete('/invite/:code', (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    const invite = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(code);
    if (!invite) return fail(res, '邀请码不存在', 404);
    if (invite.used_count > 0) return fail(res, '已使用的邀请码不可删除（保留分发归因记录）', 400);
    db.prepare("UPDATE invite_codes SET revoked_at = datetime('now') WHERE id = ?").run(invite.id);
    writeAudit(req.user.id, 'revoke_invite', 'invite', code, {}, req);
    return ok(res, { code, revoked: true });
  } catch (e) {
    console.error('admin/invite DELETE:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// POST /api/admin/invite/batch-delete  body: { codes: [...] }
// 批量物理删除已用/已作废/已过期的邀请码（未使用且未作废的码不允许删，防止误删可用码）
router.post('/invite/batch-delete', (req, res) => {
  try {
    const { codes } = req.body || {};
    if (!Array.isArray(codes) || codes.length === 0) return fail(res, 'codes 必须是非空数组');
    if (codes.length > 500) return fail(res, '单次最多删除 500 个');

    // 只允许删除已用、已作废或已过期的码；未使用且未作废的码跳过（保护可用码）
    const placeholders = codes.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT code, used_at, revoked_at, expires_at FROM invite_codes
       WHERE code IN (${placeholders})`
    ).all(...codes);

    let deleted = 0;
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      rows.forEach((r) => {
        // expires_at 为 'YYYY-MM-DD HH:MM:SS'（UTC）；补 T 和 Z 强制按 UTC 解析，避免本地时区偏差
        const expired = r.expires_at && new Date(r.expires_at.replace(' ', 'T') + 'Z') < new Date(now);
        if (r.used_at || r.revoked_at || expired) {
          const result = db.prepare('DELETE FROM invite_codes WHERE code = ?').run(r.code);
          deleted += result.changes;
        }
      });
    });
    tx();

    writeAudit(req.user.id, 'batch_delete_invite', 'invite', null, { deleted, total: codes.length }, req);
    return ok(res, { deleted, skipped: codes.length - rows.length });
  } catch (e) {
    console.error('admin/invite/batch-delete:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

module.exports = router;
