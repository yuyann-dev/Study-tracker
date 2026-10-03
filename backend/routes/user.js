/**
 * routes/user.js — 当前登录用户的资料操作
 *
 *   PUT  /profile   修改昵称 / QQ邮箱
 *   PUT  /password  修改密码（需原密码）
 *   POST /avatar    multipart 上传头像（≤2MB, jpg/png/webp/gif）
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
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

/**
 * 导出用户云端 store_json 到 backups/user-export-{id}-{date}.json（删除前留存，误删可恢复）。
 * 目录不存在时递归创建；任何失败都不阻断主流程（仅 console.error）。
 */
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
    // 改密即 token_version+1，使被盗旧 token 立即失效（与 reset-password / admin 重置一致）。
    // 本轮不下发新 token，用户改密后重新登录即可。
    db.prepare("UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?")
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

      // 记录旧头像，新头像写库成功后清理旧文件（仅删 uploads 目录内、DB 记录过的旧文件，做好容错）
      const oldRow = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.user.id);
      db.prepare("UPDATE users SET avatar = ?, updated_at = datetime('now') WHERE id = ?")
        .run(avatarUrl, req.user.id);

      if (oldRow && oldRow.avatar && oldRow.avatar !== avatarUrl) {
        try {
          const m = String(oldRow.avatar).match(/^\/uploads\/(.+)$/);
          if (m) {
            const oldPath = path.join(config.uploadDir, path.normalize(m[1]));
            // 路径校验：确保最终仍落在 uploadDir 内，防止路径穿越误删
            if (oldPath.startsWith(config.uploadDir) && fs.existsSync(oldPath)) {
              fs.unlinkSync(oldPath);
            }
          }
        } catch (cleanErr) {
          console.error('cleanup old avatar failed (ignored):', cleanErr.message);
        }
      }
      return ok(res, { avatar: avatarUrl });
    } catch (e) {
      console.error('POST /api/user/avatar error:', e.message);
      return fail(res, '服务器内部错误', 500);
    }
  });
});

// DELETE /api/user —— 自助注销账号（合规：个保法第47条，用户有权删除个人信息）
// 前置：先 POST /api/auth/send-code { email: 当前邮箱, type:'delete' } 拿验证码，再带 { code } 调用。
router.delete('/', (req, res) => {
  try {
    const { code } = req.body || {};
    // 二次确认：必须凭邮箱验证码（delete 类型，与重置密码验证码隔离）
    const v = verifyCode(String(req.user.email).trim().toLowerCase(), 'delete', code);
    if (!v.valid) return fail(res, v.reason || '验证码错误或已过期');

    const userId = req.user.id;

    // 超级管理员（id=1）不允许自助注销
    if (userId === 1) return fail(res, '系统首个管理员账号不可注销');

    // 删除前把云端数据导出留存（误删可恢复）
    const exported = exportUserStore(userId);

    // 软删除 + 强制所有已签发 token 失效
    // 注意：不清除 invite_codes.used_by——邀请码已被使用，保持已使用状态，不可被重复使用
    const tx = db.transaction(() => {
      db.prepare("UPDATE invite_codes SET created_by = NULL WHERE created_by = ?").run(userId);
      db.prepare(
        `UPDATE users SET deleted_at = datetime('now'), token_version = token_version + 1,
                status = 'disabled', delete_reason = 'self', updated_at = datetime('now') WHERE id = ?`
      ).run(userId);
    });
    tx();

    return ok(res, { deleted: true, exportedTo: exported });
  } catch (e) {
    console.error('DELETE /api/user error:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

module.exports = router;