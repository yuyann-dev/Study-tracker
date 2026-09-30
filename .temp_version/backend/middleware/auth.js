/**
 * middleware/auth.js — JWT 认证与管理员鉴权
 *
 * authRequired: 解析 Bearer token → 查库 → 挂载 req.user（含 email/isAdmin/status）
 * requireAdmin: 在 authRequired 之后使用，拒绝非管理员
 *
 * 扩展点：未来加角色分级（editor / moderator / admin）时，
 *   在这里加 requireRole(role) 工厂函数即可。
 */
const jwt = require('jsonwebtoken');
const db = require('../database');
const { config } = require('../config');
const { fail } = require('../utils/respond');

/**
 * 必须登录：解析 Authorization: Bearer <token>，挂载 req.user
 */
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, '未登录', 401);

  try {
    const payload = jwt.verify(token, config.jwt.secret);
    const row = db
      .prepare('SELECT id, username, email, avatar, is_admin, status FROM users WHERE id = ?')
      .get(payload.id);
    if (!row) return fail(res, '未登录', 401);
    if (row.status !== 'active') return fail(res, '账号已被禁用', 403);

    req.user = {
      id: row.id,
      username: row.username,
      email: row.email,
      avatar: row.avatar,
      isAdmin: row.is_admin === 1,
      status: row.status,
    };
    next();
  } catch (e) {
    return fail(res, '未登录', 401);
  }
}

/**
 * 必须管理员：需在 authRequired 之后使用
 */
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) return fail(res, '需要管理员权限', 403);
  next();
}

module.exports = { authRequired, requireAdmin };
