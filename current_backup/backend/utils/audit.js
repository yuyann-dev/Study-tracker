/**
 * utils/audit.js — 登录日志与管理员操作审计写入
 *
 * 两张表分离：
 *   - login_logs：每次登录成功/失败/锁定/注册/重置密码都写一条，供异常登录追溯；
 *   - audit_logs：管理员在后台的每个写操作（封禁/删用户/重置密码/发邀请码…）都写一条，
 *                 仅超级管理员可在 GET /audit-logs 查看。
 *
 * 写入失败绝不允许阻断主业务：这里全部 try/catch 吞掉并 console.error。
 */
const db = require('../database');
const logger = require('./logger');

/** 取请求 IP（反代后通常是 X-Forwarded-For 第一个），取不到给 '-' */
function clientIp(req) {
  if (!req) return null;
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.ip || null;
}

/** 取 User-Agent，截断到 200 字符避免过长 */
function clientUa(req) {
  if (!req || !req.headers) return null;
  const ua = String(req.headers['user-agent'] || '');
  return ua.slice(0, 200);
}

/**
 * 写一条登录日志
 * @param {object} p
 * @param {number|null} p.userId
 * @param {string} p.username  登录邮箱/用户名（user_id 为空时也能看到尝试账号）
 * @param {string} p.result    success | failed | locked | register | reset
 * @param {import('express').Request} [p.req]
 */
function writeLoginLog({ userId = null, username = null, result, req = null }) {
  try {
    db.prepare(
      `INSERT INTO login_logs (user_id, username, ip, ua, result, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(userId, username, clientIp(req), clientUa(req), result);
    // 安全敏感事件同步到文件日志（便于归档/告警采集）
    if (result === 'failed' || result === 'locked') {
      logger.log('warn', `login ${result}`, { username, ip: clientIp(req) });
    }
  } catch (e) {
    console.error('writeLoginLog failed:', e.message);
  }
}

/**
 * 写一条管理员审计日志
 * @param {number} adminId 操作人
 * @param {string} action  动作，如 ban_user / soft_delete_user / grant_admin
 * @param {string} targetType 如 user / invite
 * @param {string|number} targetId
 * @param {object} [detail] 额外上下文（JSON 序列化）
 * @param {import('express').Request} [req]
 */
function writeAudit(adminId, action, targetType, targetId, detail = {}, req = null) {
  try {
    let detailJson = null;
    try { detailJson = JSON.stringify(detail || {}); } catch (_) { detailJson = null; }
    db.prepare(
      `INSERT INTO audit_logs (admin_id, action, target_type, target_id, detail_json, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(adminId, action, targetType, targetId == null ? null : String(targetId), detailJson, clientIp(req));
    // 管理员操作同步到文件日志（与 audit_logs 表分离归档）
    logger.log('info', `audit:${action}`, {
      adminId, targetType, targetId: targetId == null ? null : String(targetId), detail: detail || {},
    });
  } catch (e) {
    console.error('writeAudit failed:', e.message);
  }
}

module.exports = { writeLoginLog, writeAudit, clientIp, clientUa };
