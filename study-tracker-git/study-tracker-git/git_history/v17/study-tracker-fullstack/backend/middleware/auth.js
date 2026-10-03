/**
 * middleware/auth.js — JWT 认证与管理员鉴权
 *
 * authRequired: 解析 Bearer token → 查库 → 挂载 req.user（含 email/isAdmin/status）
 * requireAdmin: 在 authRequired 之后使用，拒绝非管理员
 * requireSuperAdmin: 仅超级管理员（首个注册用户，id=1）可用，如设置/撤销管理员
 *
 * 角色模型：
 *   - 超级管理员（id=1，系统首个用户，唯一）：拥有全部权限，且不可被降级/禁用/删除。
 *   - 普通管理员（由超级管理员授予）：可查看统计/系统、管理普通用户、生成邀请码；
 *     不能管理超级管理员，也不能设置或撤销管理员。
 *
 * v5 安全增强：
 *   - deleted_at NOT NULL 的软删除用户一律视为"未登录"（401，不暴露状态）；
 *   - JWT payload 的 tv 必须与库中 token_version 一致（改密码/封禁/删号即失效，强制下线）；
 *   - 临时封禁（status=disabled 且 ban_until 已到期）在这里自动恢复 active 并清封禁字段。
 */
const jwt = require('jsonwebtoken');
const db = require('../database');
const { config } = require('../config');
const { fail } = require('../utils/respond');

// 超级管理员固定为系统首个用户（id=1）
const SUPER_ADMIN_ID = 1;

/**
 * 临时封禁到期自动恢复：status=disabled 且 ban_until 非空且已过期 → 恢复 active、清封禁字段。
 * ban_until 为空的永久 disabled 不放行。原地修改 row 并返回。
 * 在 authRequired 与登录成功后都会调用。
 * @param {object} row users 行（需含 id/status/ban_until）
 * @returns {object} 可能已恢复 active 的 row
 */
function recoverExpiredBan(row) {
  if (!row) return row;
  if (row.status === 'disabled' && row.ban_until) {
    const info = db
      .prepare(
        `UPDATE users SET status='active', ban_reason=NULL, ban_until=NULL, updated_at=datetime('now')
         WHERE id=? AND status='disabled' AND ban_until IS NOT NULL AND ban_until <= datetime('now')`
      )
      .run(row.id);
    if (info.changes > 0) {
      row.status = 'active';
      row.ban_reason = null;
      row.ban_until = null;
    }
  }
  return row;
}

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
      .prepare(
        `SELECT id, username, email, avatar, is_admin, status, deleted_at,
                token_version, ban_reason, ban_until
         FROM users WHERE id = ?`
      )
      .get(payload.id);
    if (!row) return fail(res, '未登录', 401);

    // 软删除用户（含自助注销/管理员回收站）一律视为未登录，不暴露账号状态
    if (row.deleted_at != null) return fail(res, '未登录', 401);

    // 临时封禁到期自动恢复 active
    recoverExpiredBan(row);

    if (row.status !== 'active') return fail(res, '账号已被禁用', 403);

    // token_version 不符 → 旧 token 已被改密码/封禁/删号作废
    if ((payload.tv || 0) !== (row.token_version || 0)) return fail(res, '未登录', 401);

    req.user = {
      id: row.id,
      username: row.username,
      email: row.email,
      avatar: row.avatar,
      isAdmin: row.is_admin === 1,
      isSuperAdmin: row.id === SUPER_ADMIN_ID,
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

/**
 * 必须超级管理员：需在 authRequired 之后使用（设置/撤销管理员等最高权限操作）
 */
function requireSuperAdmin(req, res, next) {
  if (!req.user || !req.user.isSuperAdmin) {
    return fail(res, '只有超级管理员可以执行此操作', 403);
  }
  next();
}

module.exports = { authRequired, requireAdmin, requireSuperAdmin, recoverExpiredBan, SUPER_ADMIN_ID };
