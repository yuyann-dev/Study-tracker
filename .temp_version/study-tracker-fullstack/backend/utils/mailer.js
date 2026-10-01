/**
 * utils/mailer.js — 邮件发送
 *
 * SMTP 未配置（user/pass 为空）时 getTransporter() 返回 null，调用方据此降级提示，不抛错。
 *
 * v5 健壮性修复（邮件"收不到验证码"排查）：
 *   - transporter 设 socket/greeting 超时 15s，避免 SMTP 挂起拖死请求；
 *   - 遇到 EAUTH / 连接错误时 close() 并置空 transporter，下次发信自动重建（不缓存坏连接）；
 *   - from 一律与 SMTP_USER 完全一致，避免部分服务商校验发件人不匹配而退信；
 *   - 模板配色改方案 B：深书绿 #2e6b4f 强调 + 暖纸 #f6f1e7 底色，去除紫蓝渐变。
 */
const nodemailer = require('nodemailer');
const { config } = require('../config');

let transporter = null;

/**
 * 懒加载 SMTP transporter；未配置时返回 null。
 * 带 15s socket 超时，防止 SMTP 无响应时长时间挂起。
 */
function getTransporter() {
  if (!config.smtp.user || !config.smtp.pass) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
      socketTimeout: 15000,
      greetingTimeout: 15000,
      connectionTimeout: 15000,
    });
  }
  return transporter;
}

/** 遇到鉴权/连接类错误时，丢弃坏 transporter，下次重建 */
function resetTransporter() {
  try { if (transporter) transporter.close(); } catch (_) {}
  transporter = null;
}

/**
 * from 与 SMTP_USER 完全一致（部分服务商强制校验发件人）。
 * 注意：SMTP_FROM 若在 .env 显式设置则优先采用，但强烈建议让它与 SMTP_USER 保持一致，
 * 否则 QQ/163 等服务商可能因"发件人与登录账号不匹配"而退信或进垃圾箱。
 */
function fromAddress() {
  return config.smtp.from || config.smtp.user;
}

/** 判断是否为需要重建连接的错误（鉴权失败 / 连接失败 / 超时） */
function isRecoverableMailError(e) {
  if (!e) return false;
  const code = e.code || '';
  return (
    code === 'EAUTH' || code === 'ETIMEDOUT' || code === 'ECONNECTION' ||
    code === 'ESOCKET' || code === 'ECONNRESET' || code === 'ECONNREFUSED' ||
    /^535$/.test(String(e.responseCode || ''))
  );
}

/**
 * 发送验证码邮件（方案 B 配色）
 * @param {string} toEmail 收件人
 * @param {string} code 6位验证码
 * @param {string} purpose register=注册 changeemail=更换邮箱 reset=重置密码
 * @returns {Promise<boolean>} true=已发送，false=SMTP 未配置；发送失败会 throw（由调用方区分）
 */
async function sendVerificationCode(toEmail, code, purpose = 'register') {
  const t = getTransporter();
  if (!t) return false;

  let title, desc;
  if (purpose === 'register') {
    title = 'Study Tracker 注册验证码';
    desc = '欢迎使用 Study Tracker！请使用以下验证码完成注册：';
  } else if (purpose === 'changeemail') {
    title = 'Study Tracker 更换邮箱验证码';
    desc = '我们收到了更换绑定邮箱的请求，请使用以下验证码确认新邮箱：';
  } else {
    title = 'Study Tracker 重置密码验证码';
    desc = '我们收到了重置密码的请求，请使用以下验证码重置密码：';
  }

  try {
    await t.sendMail({
      from: fromAddress(),
      to: toEmail,
      subject: title,
      html: `
        <div style="font-family:-apple-system,'Segoe UI','PingFang SC',sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f6f1e7;color:#2b2b2b">
          <h2 style="margin:0 0 16px;font-size:20px;color:#2e6b4f">Study Tracker</h2>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3a3a3a">${desc}</p>
          <div style="background:#ffffff;border:1px solid #e3d9c4;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px">
            <span style="font-size:36px;font-weight:700;letter-spacing:10px;color:#2e6b4f;font-family:'Courier New',monospace">${code}</span>
          </div>
          <p style="margin:0 0 8px;font-size:13px;color:#8a7f6a">验证码 5 分钟内有效，请勿泄露给他人。</p>
          <p style="margin:0;font-size:13px;color:#8a7f6a">如非本人操作，请忽略此邮件。</p>
        </div>
      `,
    });
    return true;
  } catch (e) {
    if (isRecoverableMailError(e)) resetTransporter();
    throw e;
  }
}

/**
 * 发送密码重置邮件（保留旧接口兼容，方案 B 配色）
 */
async function sendResetEmail(toEmail, resetUrl) {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.sendMail({
      from: fromAddress(),
      to: toEmail,
      subject: 'Study Tracker 密码重置',
      html: `
        <div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f6f1e7;color:#2b2b2b">
          <h2 style="margin-top:0;color:#2e6b4f">Study Tracker 密码重置</h2>
          <p>我们收到了重置密码的请求。点击下方按钮重置密码，链接 <b>1 小时内有效</b>：</p>
          <p style="margin:24px 0">
            <a href="${resetUrl}"
               style="background:#2e6b4f;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;display:inline-block">
              重置密码
            </a>
          </p>
          <p style="word-break:break-all;color:#8a7f6a;font-size:12px">${resetUrl}</p>
          <p style="color:#8a7f6a;font-size:13px">如非本人操作，请忽略此邮件，您的密码不会有任何变化。</p>
        </div>
      `,
    });
    return true;
  } catch (e) {
    if (isRecoverableMailError(e)) resetTransporter();
    throw e;
  }
}

module.exports = { sendVerificationCode, sendResetEmail, getTransporter, resetTransporter };
