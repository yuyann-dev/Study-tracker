/**
 * utils/verification.js — 邮箱验证码管理（内存存储）
 *
 * 验证码保存在内存 Map 中，服务重启后失效（用户重新获取即可）。
 * 每个验证码 5 分钟有效，发送后 60 秒内不可重复获取，最多验证 5 次。
 */
const crypto = require('crypto');

const CODE_TTL_MS = 5 * 60 * 1000;       // 验证码有效期 5 分钟
const RESEND_COOLDOWN_MS = 60 * 1000;    // 重发间隔 60 秒
const MAX_VERIFY_ATTEMPTS = 5;           // 最多验证尝试次数

/**
 * store: Map<key, { code, expiresAt, sentAt, attempts }>
 * key = `${type}:${email}`
 */
const store = new Map();

/**
 * 定期清理过期验证码（每 5 分钟执行一次）
 */
function cleanup() {
  const now = Date.now();
  for (const [key, item] of store) {
    if (item.expiresAt < now) store.delete(key);
  }
}
const interval = setInterval(cleanup, 5 * 60 * 1000);
// 不阻塞进程退出（测试/脚本场景）
if (interval && typeof interval.unref === 'function') interval.unref();

/**
 * 生成 6 位数字验证码（用 crypto 安全随机，替代 Math.random）
 * @returns {string}
 */
function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * 创建并存储验证码
 * @param {string} email 邮箱
 * @param {string} type register | reset
 * @returns {{code: string, cooldown: number}} code=验证码，cooldown=需等待的秒数（0表示可发送）
 */
function createCode(email, type) {
  const key = `${type}:${email.toLowerCase()}`;
  const now = Date.now();
  const existing = store.get(key);

  if (existing && existing.sentAt + RESEND_COOLDOWN_MS > now) {
    const waitSec = Math.ceil((existing.sentAt + RESEND_COOLDOWN_MS - now) / 1000);
    return { code: null, cooldown: waitSec };
  }

  const code = generateCode();
  store.set(key, {
    code,
    expiresAt: now + CODE_TTL_MS,
    sentAt: now,
    attempts: 0,
  });
  return { code, cooldown: 0 };
}

/**
 * 验证验证码
 * @param {string} email 邮箱
 * @param {string} type register | reset
 * @param {string} code 用户输入的验证码
 * @returns {{valid: boolean, reason?: string}}
 */
function verifyCode(email, type, code) {
  const key = `${type}:${email.toLowerCase()}`;
  const item = store.get(key);
  const now = Date.now();

  if (!item) {
    return { valid: false, reason: '请先获取验证码' };
  }
  if (item.expiresAt < now) {
    store.delete(key);
    return { valid: false, reason: '验证码已过期，请重新获取' };
  }
  if (item.attempts >= MAX_VERIFY_ATTEMPTS) {
    store.delete(key);
    return { valid: false, reason: '验证次数过多，请重新获取验证码' };
  }

  item.attempts += 1;

  if (String(code).trim() !== item.code) {
    const remaining = MAX_VERIFY_ATTEMPTS - item.attempts;
    return {
      valid: false,
      reason: remaining > 0
        ? `验证码错误，还可尝试 ${remaining} 次`
        : '验证次数过多，请重新获取验证码',
    };
  }

  // 验证成功，删除验证码（一次性使用）
  store.delete(key);
  return { valid: true };
}

/**
 * 作废已下发但发送失败的验证码：删除记录，使 60s 重发冷却不被占用（发送失败可立即重试）。
 * @param {string} email
 * @param {string} type
 */
function invalidateCode(email, type) {
  try {
    store.delete(`${type}:${String(email).toLowerCase()}`);
  } catch (_) {}
}

module.exports = { createCode, verifyCode, invalidateCode, CODE_TTL_MS, RESEND_COOLDOWN_MS };
