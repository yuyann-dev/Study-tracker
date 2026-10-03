/**
 * utils/alert.js — 运维告警（复用 mailer 的 SMTP）
 *
 * 告警条件（由调用方判定后触发）：磁盘 >90%、连续 5 个 5xx、备份失败、登录失败激增。
 * 每类告警 1 小时内内存去重，避免邮件轰炸。SMTP 未配置时静默降级（不发不抛错）。
 */
const { config } = require('../config');
const { getTransporter } = require('./mailer');

/** 每类告警的最小发送间隔 */
const DEDUPE_MS = 60 * 60 * 1000;
const lastSent = new Map(); // type -> timestamp

/**
 * 发送一条告警邮件（带去重）。任何失败都不影响主业务。
 * @param {string} type 告警类别（去重 key），如 disk_full / consecutive_5xx / backup_failed / login_spike
 * @param {string} subject 标题
 * @param {string} detail 正文
 */
async function alert(type, subject, detail) {
  try {
    const now = Date.now();
    const prev = lastSent.get(type) || 0;
    if (now - prev < DEDUPE_MS) return; // 1 小时内同类已发过
    lastSent.set(type, now);

    const t = getTransporter();
    if (!t) {
      console.error(`[ALERT][${type}] SMTP 未配置，告警内容：${subject} - ${detail}`);
      return;
    }
    await t.sendMail({
      from: config.smtp.from || config.smtp.user,
      to: config.smtp.user, // 发给超管邮箱（SMTP 账号本人）
      subject: `[Study Tracker 告警] ${subject}`,
      text: `时间：${new Date().toISOString()}\n类别：${type}\n\n${detail}\n`,
    });
  } catch (e) {
    console.error('alert send failed:', e.message);
  }
}

module.exports = { alert };
