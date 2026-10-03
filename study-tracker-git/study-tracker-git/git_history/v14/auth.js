/**
 * routes/auth.js — 认证相关路由
 *
 *   POST /send-code       发送邮箱验证码（type=register/reset）
 *   POST /register        验证码+用户名+密码注册（首个用户免邀请码、自动管理员）
 *   POST /login           邮箱+密码登录
 *   POST /logout          登出（前端清 token）
 *   GET  /me              获取当前登录用户
 *   POST /reset-password  验证码重置密码
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { config, RULES } = require('../config');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/respond');
const { sendVerificationCode } = require('../utils/mailer');
const { createCode, verifyCode } = require('../utils/verification');

const router = express.Router();

/**
 * 为用户签发 JWT
 */
function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
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
  };
}

/**
 * 判断当前是否为首个用户（数据库无用户）
 */
function isFirstUser() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;
}

/**
 * 验证邀请码
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
       WHERE code = ? AND used_by IS NULL
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
    )
    .get(String(inviteCode).trim().toUpperCase());
  if (!invite) return { valid: false, reason: '邀请码无效或已被使用' };
  return { valid: true, invite };
}

// POST /api/auth/send-code  body: { email, type, inviteCode? }
router.post('/send-code', async (req, res) => {
  try {
    const { email, type, inviteCode } = req.body || {};
    const purpose = type === 'reset' ? 'reset' : 'register';

    if (!email || !RULES.email.test(String(email))) {
      return fail(res, '请输入有效的邮箱地址');
    }
    const emailNorm = String(email).trim().toLowerCase();
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(emailNorm);

    if (purpose === 'register') {
      // 注册：邮箱不能已注册
      if (existingUser) return fail(res, '该邮箱已注册，请直接登录');

      // 非首个用户需要验证邀请码
      if (!isFirstUser()) {
        const inviteCheck = checkInviteCode(inviteCode);
        if (!inviteCheck.valid) return fail(res, inviteCheck.reason);
      }
    } else {
      // 重置密码：邮箱必须已注册
      if (!existingUser) return fail(res, '该邮箱未注册');
    }

    // 创建验证码
    const { code, cooldown } = createCode(emailNorm, purpose);
    if (cooldown > 0) {
      return fail(res, `发送太频繁，请 ${cooldown} 秒后再试`);
    }

    // 发送邮件
    let sent = false;
    try {
      sent = await sendVerificationCode(emailNorm, code, purpose);
    } catch (e) {
      console.error('sendVerificationCode failed:', e.message);
    }

    if (!sent) {
      return fail(res, '邮件服务未配置，请联系管理员', 503);
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

    // 邮箱不能已注册
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

    if (invite) {
      db.prepare("UPDATE invite_codes SET used_by = ?, used_at = datetime('now') WHERE id = ?")
        .run(info.lastInsertRowid, invite.id);
    }

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
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

    const row = db.prepare('SELECT * FROM users WHERE email = ?')
      .get(String(email).trim().toLowerCase());

    if (!row || !bcrypt.compareSync(String(password), row.password_hash)) {
      return fail(res, '邮箱或密码错误', 401);
    }
    if (row.status !== 'active') return fail(res, '账号已被禁用', 403);

    return ok(res, { token: signToken(row), user: publicUser(row) });
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
    if (!row) return fail(res, '该邮箱未注册');

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

    const hash = bcrypt.hashSync(newPassword, config.bcryptRounds);
    db.prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(hash, row.id);

    return ok(res, { message: '密码已重置，请使用新密码登录' });
  } catch (e) {
    console.error('reset-password error:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

module.exports = router;
