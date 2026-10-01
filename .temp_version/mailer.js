/**
 * utils/mailer.js — 邮件发送
 *
 * SMTP 未配置（user/pass 为空）时 getTransporter() 返回 null，
 * 调用方据此降级提示，不抛错。
 */
const nodemailer = require('nodemailer');
const { config } = require('../config');

let transporter = null;

/**
 * 懒加载 SMTP transporter；未配置时返回 null
 */
function getTransporter() {
  if (!config.smtp.user || !config.smtp.pass) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

/**
 * 发送验证码邮件
 * @param {string} toEmail 收件人
 * @param {string} code 6位验证码
 * @param {string} purpose register=注册 verify=重置密码
 * @returns {Promise<boolean>} true=已发送，false=SMTP 未配置
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

  await t.sendMail({
    from: config.smtp.from || `"Study Tracker" <${config.smtp.user}>`,
    to: toEmail,
    subject: title,
    html: `
      <div style="font-family:-apple-system,'Segoe UI','PingFang SC',sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#1a1a2e">
        <h2 style="margin:0 0 16px;font-size:20px;color:#5b6ef5">Study Tracker</h2>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#444">${desc}</p>
        <div style="background:linear-gradient(135deg,#f0f2ff,#faf5ff);border:1px solid #e0e4ff;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px">
          <span style="font-size:36px;font-weight:700;letter-spacing:10px;color:#5b6ef5;font-family:'Courier New',monospace">${code}</span>
        </div>
        <p style="margin:0 0 8px;font-size:13px;color:#888">验证码 5 分钟内有效，请勿泄露给他人。</p>
        <p style="margin:0;font-size:13px;color:#888">如非本人操作，请忽略此邮件。</p>
      </div>
    `,
  });
  return true;
}

/**
 * 发送密码重置邮件（保留旧接口兼容）
 */
async function sendResetEmail(toEmail, resetUrl) {
  const t = getTransporter();
  if (!t) return false;
  await t.sendMail({
    from: config.smtp.from || config.smtp.user,
    to: toEmail,
    subject: 'Study Tracker 密码重置',
    html: `
      <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222">
        <h2 style="margin-top:0">Study Tracker 密码重置</h2>
        <p>我们收到了重置密码的请求。点击下方按钮重置密码，链接 <b>1 小时内有效</b>：</p>
        <p style="margin:24px 0">
          <a href="${resetUrl}"
             style="background:#4f7cff;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;display:inline-block">
            重置密码
          </a>
        </p>
        <p style="word-break:break-all;color:#888;font-size:12px">${resetUrl}</p>
        <p style="color:#888;font-size:13px">如非本人操作，请忽略此邮件，您的密码不会有任何变化。</p>
      </div>
    `,
  });
  return true;
}

module.exports = { sendVerificationCode, sendResetEmail, getTransporter };
