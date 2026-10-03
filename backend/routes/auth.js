/**
 * routes/auth.js — 认证相关路由
 *
 *   POST /send-code       发送邮箱验证码（type=register/reset）
 *   POST /register        验证码+用户名+密码注册（首个用户免邀请码、自动管理员）
 *   POST /login           邮箱+密码登录（含失败计数/锁定/登录日志）
 *   POST /logout          登出（前端清 token）
 *   GET  /me              获取当前登录用户
 *   POST /reset-password  验证码重置密码
 *
 * v5 安全增强：登录失败计数 + 10 次锁 15 分钟；登录全程写 login_logs；
 * JWT payload 带 tv（token_version）；软删除账号按"用户不存在"模糊返回。
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { config, RULES } = require('../config');
const { authRequired, recoverExpiredBan } = require('../middleware/auth');
const { ok, fail } = require('../utils/respond');
const { sendVerificationCode } = require('../utils/mailer');
const { createCode, verifyCode, invalidateCode } = require('../utils/verification');
const { writeLoginLog, clientIp, clientUa } = require('../utils/audit');

const router = express.Router();

/** 连续登录失败多少次后锁定账号 */
const MAX_FAILED_LOGINS = 10;
/** 单次锁定时长（分钟） */
const LOCK_MINUTES = 15;

/** 当前 UTC 时间，格式与 SQLite datetime('now') 一致：'YYYY-MM-DD HH:MM:SS' */
function sqlUtcNow(offsetMin = 0) {
  return new Date(Date.now() + offsetMin * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * 为用户签发 JWT（payload 带 tv，用于改密/封禁后强制旧 token 失效）
 */
function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, tv: user.token_version || 0 },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

/**
 * 输出给前端的用户对象（绝不含 password_hash）
 */
function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    email: row.email,
    isAdmin: row.is_admin === 1,
    isSuperAdmin: row.id === 1,
  };
}

/**
 * 判断当前是否为首个用户（数据库无用户）
 */
function isFirstUser() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;
}

/**
 * 验证邀请码（未使用、未过期、未软作废）
 * @param {string} inviteCode
 * @returns {{valid: boolean, invite?: object, reason?: string}}
 */
function checkInviteCode(inviteCode) {
  if (!inviteCode || typeof inviteCode !== 'string') {
    return { valid: false, reason: '邀请码不能为空' };
  }
  const invite = db
    .prepare(
      `SELECT * FROM invite_codes
       WHERE code = ? AND used_by IS NULL AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
    )
    .get(String(inviteCode).trim().toUpperCase());
  if (!invite) return { valid: false, reason: '邀请码无效或已被使用/作废' };
  return { valid: true, invite };
}

// POST /api/auth/send-code  body: { email, type, inviteCode? }
router.post('/send-code', async (req, res) => {
  try {
    const { email, type, inviteCode } = req.body || {};
    const purpose = type === 'reset' ? 'reset' : (type === 'delete' ? 'delete' : 'register');

    if (!email || !RULES.email.test(String(email))) {
      return fail(res, '请输入有效的邮箱地址');
    }
    const emailNorm = String(email).trim().toLowerCase();
    const existingUser = db
      .prepare('SELECT id, deleted_at FROM users WHERE email = ?')
      .get(emailNorm);

    if (purpose === 'register') {
      // 注册：邮箱不能已注册（含已软删除的邮箱——视为已注册，走找回流程）
      if (existingUser) return fail(res, '该邮箱已注册，请直接登录');

      // 非首个用户需要验证邀请码
      if (!isFirstUser()) {
        const inviteCheck = checkInviteCode(inviteCode);
        if (!inviteCheck.valid) return fail(res, inviteCheck.reason);
      }
    } else {
      // 重置密码：邮箱必须已注册且未注销
      if (!existingUser || existingUser.deleted_at != null) return fail(res, '该邮箱未注册');
    }

    // 创建验证码
    const { code, cooldown } = createCode(emailNorm, purpose);
    if (cooldown > 0) {
      return fail(res, `发送太频繁，请 ${cooldown} 秒后再试`);
    }

    // 发送邮件：区分"SMTP 未配置(503)"与"发送失败(502)"；发送失败不占用 60s 重发冷却
    try {
      const sent = await sendVerificationCode(emailNorm, code, purpose);
      if (!sent) {
        // SMTP 未配置（mailer 返回 false）
        invalidateCode(emailNorm, purpose);
        return fail(res, '邮件服务未配置，请联系管理员', 503);
      }
    } catch (e) {
      console.error('sendVerificationCode failed:', e.code || e.message, 'responseCode=', e.responseCode);
      invalidateCode(emailNorm, purpose); // 撤销刚下发的验证码，允许立即重试
      return fail(res, '验证码邮件发送失败，请稍后重试（邮件服务暂时不可用）', 502);
    }

    return ok(res, {
      message: '验证码已发送至邮箱，5 分钟内有效',
      cooldown: 60,
    });
  } catch (e) {
    console.error('send-code error:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// POST /api/auth/register  body: { email, code, username, password, inviteCode? }
router.post('/register', (req, res) => {
  try {
    const { email, code, username, password, inviteCode } = req.body || {};

    // 基础校验
    if (!email || !RULES.email.test(String(email))) {
      return fail(res, '请输入有效的邮箱地址');
    }
    const emailNorm = String(email).trim().toLowerCase();

    const usernameTrim = String(username == null ? '' : username).trim();
    if (!usernameTrim || usernameTrim.length > 20 || !RULES.username.test(usernameTrim)) {
      return fail(res, '请输入用户名（不超过20个字符，支持中文）');
    }
    if (typeof password !== 'string' || password.length < RULES.password.minLen) {
      return fail(res, `密码至少${RULES.password.minLen}位`);
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return fail(res, '密码必须同时包含字母和数字');
    }

    // 邮箱不能已注册（含软删除邮箱）
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(emailNorm)) {
      return fail(res, '该邮箱已注册，请直接登录');
    }

    // 验证验证码
    const codeCheck = verifyCode(emailNorm, 'register', code);
    if (!codeCheck.valid) return fail(res, codeCheck.reason);

    // 首个用户免邀请码、自动管理员
    const firstUser = isFirstUser();
    let invite = null;
    if (!firstUser) {
      const inviteCheck = checkInviteCode(inviteCode);
      if (!inviteCheck.valid) return fail(res, inviteCheck.reason);
      invite = inviteCheck.invite;
    }

    const isAdmin = firstUser ? 1 : 0;
    const hash = bcrypt.hashSync(password, config.bcryptRounds);
    const info = db
      .prepare('INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)')
      .run(usernameTrim, hash, emailNorm, isAdmin);
    const newId = info.lastInsertRowid;

    if (invite) {
      db.prepare("UPDATE invite_codes SET used_by = ?, used_at = datetime('now') WHERE id = ?")
        .run(newId, invite.id);
    }

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(newId);
    writeLoginLog({ userId: newId, username: emailNorm, result: 'register', req });
    return ok(res, { token: signToken(row), user: publicUser(row) });
  } catch (e) {
    console.error('register error:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// POST /api/auth/login  body: { email, password }
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return fail(res, '邮箱和密码不能为空');

    const emailNorm = String(email).trim().toLowerCase();
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(emailNorm);

    // 用户不存在 / 已注销（软删除）→ 统一模糊错误，不暴露账号是否存在
    if (!row || row.deleted_at != null) {
      writeLoginLog({ userId: row ? row.id : null, username: emailNorm, result: 'failed', req });
      return fail(res, '邮箱或密码错误', 401);
    }

    // 账号被临时锁定（爆破防护）
    const now = sqlUtcNow();
    if (row.locked_until && row.locked_until > now) {
      const remainSec = Math.max(0, Math.ceil((new Date(row.locked_until.replace(' ', 'T') + 'Z') - Date.now()) / 1000));
      writeLoginLog({ userId: row.id, username: row.username, result: 'locked', req });
      return fail(res, `尝试次数过多，账号已临时锁定，请 ${Math.ceil(remainSec / 60) || 1} 分钟后再试`, 423);
    }

    // 密码校验
    if (!bcrypt.compareSync(String(password), row.password_hash)) {
      const count = (row.failed_login_count || 0) + 1;
      if (count >= MAX_FAILED_LOGINS) {
        // 锁定 LOCK_MINUTES 分钟
        db.prepare(
          "UPDATE users SET failed_login_count = ?, locked_until = datetime('now', ?) WHERE id = ?"
        ).run(count, `+${LOCK_MINUTES} minutes`, row.id);
        writeLoginLog({ userId: row.id, username: row.username, result: 'locked', req });
      } else {
        db.prepare('UPDATE users SET failed_login_count = ? WHERE id = ?').run(count, row.id);
        writeLoginLog({ userId: row.id, username: row.username, result: 'failed', req });
      }
      return fail(res, '邮箱或密码错误', 401);
    }

    // 密码正确：先尝试恢复到期的临时封禁
    recoverExpiredBan(row);
    if (row.status !== 'active') {
      // 永久封禁（ban_until 为空）或仍在临时封禁期内 → 不放行
      writeLoginLog({ userId: row.id, username: row.username, result: 'failed', req });
      return fail(res, '账号已被禁用', 403);
    }

    // 登录成功：清零失败计数、记录最近登录 IP/时间、写成功日志
    db.prepare(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL,
              last_login_ip = ?, last_login_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    ).run(clientIp(req), row.id);
    writeLoginLog({ userId: row.id, username: row.username, result: 'success', req });

    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
    return ok(res, { token: signToken(fresh), user: publicUser(fresh) });
  } catch (e) {
    console.error('login error:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// POST /api/auth/logout
router.post('/logout', authRequired, (req, res) => ok(res, {}));

// GET /api/auth/me
router.get('/me', authRequired, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!row) return fail(res, '未登录', 401);
    return ok(res, {
      user: {
        id: row.id,
        username: row.username,
        avatar: row.avatar,
        email: row.email,
        isAdmin: row.is_admin === 1,
        isSuperAdmin: row.id === 1,
        createdAt: row.created_at,
      },
    });
  } catch (e) {
    return fail(res, '服务器内部错误', 500);
  }
});

// POST /api/auth/reset-password  body: { email, code, newPassword }
router.post('/reset-password', (req, res) => {
  try {
    const { email, code, newPassword } = req.body || {};

    if (!email || !RULES.email.test(String(email))) {
      return fail(res, '请输入有效的邮箱地址');
    }
    const emailNorm = String(email).trim().toLowerCase();

    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(emailNorm);
    if (!row || row.deleted_at != null) return fail(res, '该邮箱未注册');

    // 验证验证码
    const codeCheck = verifyCode(emailNorm, 'reset', code);
    if (!codeCheck.valid) return fail(res, codeCheck.reason);

    // 校验新密码
    if (typeof newPassword !== 'string' || newPassword.length < RULES.password.minLen) {
      return fail(res, `新密码至少${RULES.password.minLen}位`);
    }
    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return fail(res, '新密码必须同时包含字母和数字');
    }

    // 改密码即 token_version+1，强制所有旧 token（含被盗 token）失效
    db.prepare(
      `UPDATE users SET password_hash = ?, password_changed_at = datetime('now'),
              token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?`
    ).run(bcrypt.hashSync(newPassword, config.bcryptRounds), row.id);

    writeLoginLog({ userId: row.id, username: emailNorm, result: 'reset', req });
    return ok(res, { message: '密码已重置，请使用新密码登录' });
  } catch (e) {
    console.error('reset-password error:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

module.exports = router;
