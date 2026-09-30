/**
 * routes/user.js — 当前登录用户的资料操作
 *
 *   PUT  /profile   修改昵称 / QQ邮箱
 *   PUT  /password  修改密码（需原密码）
 *   POST /avatar    multipart 上传头像（≤2MB, jpg/png/webp/gif）
 */
const express = require('express');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('../database');
const { config, RULES } = require('../config');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/respond');
const { createCode, verifyCode } = require('../utils/verification');
const { sendVerificationCode } = require('../utils/mailer');

const router = express.Router();
router.use(authRequired);

if (!fs.existsSync(config.uploadDir)) fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => {
    const ext = config.upload.allowedMime[file.mimetype] || '.png';
    cb(null, `avatar_${req.user.id}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxBytes },
  fileFilter: (req, file, cb) => {
    if (config.upload.allowedMime[file.mimetype]) return cb(null, true);
    cb(new Error('仅支持 jpg/png/webp/gif 图片'));
  },
});

/** 把库里的行映射成对外的用户对象 */
function toPublic(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    avatar: row.avatar,
    isAdmin: row.is_admin === 1,
  };
}

// PUT /api/user/profile  body: { username }（邮箱修改需走验证码流程，见下方 change-email）
router.put('/profile', (req, res) => {
  try {
    const { username } = req.body || {};
    if (username === undefined) return fail(res, '请提供要修改的字段');

    const uname = String(username == null ? '' : username).trim();
    if (!uname || uname.length > 20 || !RULES.username.test(uname)) {
      return fail(res, '请输入用户名（不超过20个字符，支持中文）');
    }
    db.prepare("UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?")
      .run(uname, req.user.id);

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    return ok(res, { user: toPublic(row) });
  } catch (e) {
    console.error('PUT /api/user/profile error:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// POST /api/user/change-email/request  body: { newEmail } —— 向新邮箱发送验证码
router.post('/change-email/request', async (req, res) => {
  try {
    const newEmail = String((req.body && req.body.newEmail) || '').trim().toLowerCase();
    if (!newEmail || !RULES.email.test(newEmail)) return fail(res, '请输入有效的邮箱地址');
    if (newEmail === String(req.user.email || '').trim().toLowerCase()) {
      return fail(res, '新邮箱与当前邮箱相同');
    }
    const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(newEmail, req.user.id);
    if (dup) return fail(res, '该邮箱已被使用');

    const { code, cooldown } = createCode(newEmail, 'changeemail');
    if (cooldown > 0) return fail(res, `请求过于频繁，请 ${cooldown} 秒后再试`);

    const sent = await sendVerificationCode(newEmail, code, 'changeemail');
    if (!sent) return fail(res, '邮件服务未配置，无法发送验证码');
    return ok(res, { sent: true });
  } catch (e) {
    console.error('change-email/request error:', e.message);
    return fail(res, '验证码发送失败，请稍后再试', 500);
  }
});

// POST /api/user/change-email/confirm  body: { newEmail, code } —— 校验验证码并绑定新邮箱
router.post('/change-email/confirm', (req, res) => {
  try {
    const newEmail = String((req.body && req.body.newEmail) || '').trim().toLowerCase();
    const code = String((req.body && req.body.code) || '').trim();
    if (!newEmail || !RULES.email.test(newEmail)) return fail(res, '请输入有效的邮箱地址');

    const dup = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(newEmail, req.user.id);
    if (dup) return fail(res, '该邮箱已被使用');

    const result = verifyCode(newEmail, 'changeemail', code);
    if (!result.valid) return fail(res, result.reason || '验证码错误');

    db.prepare("UPDATE users SET email = ?, updated_at = datetime('now') WHERE id = ?")
      .run(newEmail, req.user.id);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    return ok(res, { user: toPublic(row) });
  } catch (e) {
    console.error('change-email/confirm error:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// PUT /api/user/password  body: { oldPassword, newPassword }
router.put('/password', (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) return fail(res, '原密码和新密码不能为空');
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!row || !bcrypt.compareSync(String(oldPassword), row.password_hash)) return fail(res, '原密码错误', 401);
    if (typeof newPassword !== 'string' || newPassword.length < RULES.password.minLen) {
      return fail(res, `新密码至少${RULES.password.minLen}位`);
    }
    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return fail(res, '新密码必须同时包含字母和数字');
    }
    const hash = bcrypt.hashSync(String(newPassword), config.bcryptRounds);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(hash, req.user.id);
    return ok(res, {});
  } catch (e) {
    console.error('PUT /api/user/password error:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// POST /api/user/avatar  multipart field: avatar
router.post('/avatar', (req, res) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '头像不能超过2MB' : (err.message || '头像上传失败');
      return fail(res, msg);
    }
    try {
      if (!req.file) return fail(res, '请选择头像文件');
      const avatarUrl = `/uploads/${req.file.filename}`;
      db.prepare("UPDATE users SET avatar = ?, updated_at = datetime('now') WHERE id = ?")
        .run(avatarUrl, req.user.id);
      return ok(res, { avatar: avatarUrl });
    } catch (e) {
      console.error('POST /api/user/avatar error:', e.message);
      return fail(res, '服务器内部错误', 500);
    }
  });
});

module.exports = router;
