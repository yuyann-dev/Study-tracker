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
 * 验证邀请码（未达使用上限、未过期、未软作废）
 * 支持多用户邀请码：used_count < max_uses 即为可用
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
       WHERE code = ? AND used_count < max_uses AND revoked_at IS NULL
         AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`
    )
    .get(String(inviteCode).trim().toUpperCase());
  if (!invite) return { valid: false, reason: '邀请码无效或已达使用上限/已作废' };
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

    // 邀请码校验（仅 register 且非首个用户）必须先于 createCode：
    // 邀请码无效直接拒绝，不创建验证码，避免被用来枚举邮箱/无谓占用验证码记录。
    if (purpose === 'register' && !isFirstUser()) {
      const inviteCheck = checkInviteCode(inviteCode);
      if (!inviteCheck.valid) return fail(res, inviteCheck.reason);
    }

    // 防邮箱枚举（核心）：对所有目的（register/reset/delete）、所有邮箱状态都先创建验证码，
    // 使 60s 重发冷却对“已注册/未注册”邮箱完全对称——
    //   ① 已注册与未注册邮箱都会命中 createCode 的重发冷却；
    //   ② 消除“已注册提前 return 不建码、未注册建码”造成的第二次响应预言机差异。
    const { code, cooldown } = createCode(emailNorm, purpose);
    if (cooldown > 0) {
      // 冷却响应的状态码(429)与文案，对所有目的、所有邮箱状态完全一致
      return fail(res, `发送太频繁，请 ${cooldown} 秒后再试`, 429);
    }

    // 建码之后再查邮箱存在性：仅用于决定“是否真发信”，不再影响响应形态
    const existingUser = db
      .prepare('SELECT id, deleted_at FROM users WHERE email = ?')
      .get(emailNorm);
    const isActive = existingUser && existingUser.deleted_at == null;

    // 是否真正发信：
    //   - register：仅当邮箱未注册（或已软注销）时才发注册验证码；已注册活跃邮箱不发信
    //     （但验证码记录已创建，5 分钟自动过期，可接受）；
    //   - reset/delete：仅当存在活跃账号时才发信；未注册/已注销邮箱不实际发信，
    //     但验证码记录已创建，响应与成功路径完全一致。
    const shouldSend = purpose === 'register' ? !isActive : isActive;

    // 发送邮件：区分"SMTP 未配置(503)"与"发送失败(502)"；发送失败不占用 60s 重发冷却
    if (shouldSend) {
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
    }

    return ok(res, {
      message: '如果该邮箱已注册，验证码已发送',
      cooldown: 60,
    });
  } catch (e) {
    console.error('send-code error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
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

    // 邮箱检查：正常用户不可重复注册；已注销（软删除）的邮箱允许重新注册
    const existing = db.prepare('SELECT id, deleted_at FROM users WHERE email = ?').get(emailNorm);
    if (existing && existing.deleted_at == null) {
      // 防邮箱枚举：不区分"已注册"，统一模糊报错
      return fail(res, '注册失败，请检查输入信息');
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

    // 整体事务：删旧账号（清 invite_codes 引用）+ INSERT 新用户 + 条件抢占邀请码。
    // 任一步失败全部回滚，避免 INSERT 失败导致旧数据永久丢失。
    const newId = db.transaction(() => {
      // 物理删除已注销的旧账号（不可逆操作放在所有校验通过后）
      if (existing && existing.deleted_at != null) {
        db.prepare('UPDATE invite_codes SET created_by = NULL WHERE created_by = ?').run(existing.id);
        // 多用户邀请码：从 used_by JSON 数组中移除该用户 ID（事务内读取再更新，安全可靠），
        // used_count 不递减——邀请码已被实际使用过，不应"复活"回退使用次数。
        const allUsed = db.prepare("SELECT id, used_by FROM invite_codes").all();
        for (const r of allUsed) {
          try {
            const arr = JSON.parse(r.used_by || '[]');
            const filtered = arr.filter((uid) => uid !== existing.id);
            if (filtered.length !== arr.length) {
              db.prepare('UPDATE invite_codes SET used_by = ? WHERE id = ?').run(JSON.stringify(filtered), r.id);
            }
          } catch (e) { /* 非 JSON 格式跳过 */ }
        }
        db.prepare('DELETE FROM users WHERE id = ?').run(existing.id); // user_data 外键级联删除
      }

      const info = db
        .prepare('INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)')
        .run(usernameTrim, hash, emailNorm, isAdmin);
      const insertedId = info.lastInsertRowid;

      // 条件抢占邀请码：WHERE used_count < max_uses 防止并发注册超额（TOCTOU 竞态）
      // json_insert(used_by, '$[#]', ?) 将用户 ID 追加到 JSON 数组末尾
      if (invite) {
        const claim = db.prepare(
          "UPDATE invite_codes SET used_count = used_count + 1, used_by = json_insert(used_by, '$[#]', ?), used_at = datetime('now') WHERE id = ? AND used_count < max_uses AND revoked_at IS NULL"
        ).run(insertedId, invite.id);
        if (claim.changes === 0) {
          throw new Error('INVITE_CODE_TAKEN');
        }
      }
      return insertedId;
    })();

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(newId);
    writeLoginLog({ userId: newId, username: emailNorm, result: 'register', req });
    return ok(res, { token: signToken(row), user: publicUser(row) });
  } catch (e) {
    if (e.message === 'INVITE_CODE_TAKEN') {
      return fail(res, '邀请码已达使用上限，请更换');
    }
    console.error('register error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
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
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// POST /api/auth/logout
router.post('/logout', authRequired, (req, res) => ok(res, {}));

// GET /api/auth/me
router.get('/me', authRequired, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!row) return fail(res, '未登录', 401);
    // 活跃刷新：距上次 last_login_at 超过5分钟则更新，使"最后登录"反映真实活跃时间（token自动登录也会刷新）
    try {
      const lastTs = row.last_login_at ? new Date(row.last_login_at.replace(' ', 'T') + 'Z').getTime() : 0;
      if (!lastTs || (Date.now() - lastTs) > 5 * 60 * 1000) {
        db.prepare("UPDATE users SET last_login_at = datetime('now'), last_login_ip = ? WHERE id = ?").run(clientIp(req), row.id);
      }
    } catch (_) { /* 时间解析失败时跳过刷新，不影响主流程 */ }
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
    return fail(res, '服务器开小差了，请稍后重试', 500);
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
    // 防邮箱枚举：不区分"邮箱不存在/已注销"与"验证码错误"，统一提示（与 send-code 口径一致）
    if (!row || row.deleted_at != null) return fail(res, '验证码错误或已过期，请重新获取', 400);

    // 验证验证码
    const codeCheck = verifyCode(emailNorm, 'reset', code);
    if (!codeCheck.valid) return fail(res, '验证码错误或已过期，请重新获取', 400);

    // 校验新密码
    if (typeof newPassword !== 'string' || newPassword.length < RULES.password.minLen) {
      return fail(res, `新密码至少${RULES.password.minLen}位`);
    }
    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return fail(res, '新密码必须同时包含字母和数字');
    }

    // 改密码即 token_version+1，强制所有旧 token（含被盗 token）失效；
    // 同时清零失败计数/锁定，否则被锁用户重置密码后仍无法登录。
    db.prepare(
      `UPDATE users SET password_hash = ?, password_changed_at = datetime('now'),
              failed_login_count = 0, locked_until = NULL,
              token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?`
    ).run(bcrypt.hashSync(newPassword, config.bcryptRounds), row.id);

    writeLoginLog({ userId: row.id, username: emailNorm, result: 'reset', req });
    return ok(res, { message: '密码已重置，请使用新密码登录' });
  } catch (e) {
    console.error('reset-password error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

module.exports = router;
