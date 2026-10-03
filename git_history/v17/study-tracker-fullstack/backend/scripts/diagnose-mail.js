#!/usr/bin/env node
/**
 * backend/scripts/diagnose-mail.js — 邮件发送独立取证脚本（服务器实际跑）
 *
 * 用途：管理员反馈"收不到验证码"时，在服务器上 `node scripts/diagnose-mail.js` 自查。
 * 不 require config.js（避免它随机生成 JWT_SECRET 写 .env），而是自行解析上一级 backend/.env。
 *
 * 它会：
 *   1. 打印 SMTP_HOST/PORT/USER 是否配置、SMTP_PASS 长度（绝不回显授权码明文）；
 *   2. 用 nodemailer 按 .env 建 transporter（socket 超时 15s），向 SMTP_USER 自发自收一封测试邮件；
 *   3. 完整打印 sendMail 返回（messageId/response）或错误码（EAUTH/535/ETIMEDOUT/ECONNECTION…）；
 *   4. 出错时 transporter.close() 退出。
 *
 * 运行：cd /opt/study-tracker/backend && node scripts/diagnose-mail.js
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// .env 位于 backend/.env（本脚本在 backend/scripts/ 下）
const ENV_PATH = path.join(__dirname, '..', '.env');

/** 极简解析 .env（KEY=VALUE，忽略注释/空行，不做引号强解析） */
function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) return;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  return out;
}

(async () => {
  console.log('=== Study Tracker 邮件取证 ===');
  console.log('.env 路径:', ENV_PATH, fs.existsSync(ENV_PATH) ? '(存在)' : '(不存在!)');
  const env = parseEnv(ENV_PATH);

  const host = env.SMTP_HOST || 'smtp.qq.com';
  const port = parseInt(env.SMTP_PORT || '465', 10);
  const secure = String(env.SMTP_SECURE || 'true') !== 'false';
  const user = env.SMTP_USER || '';
  const pass = env.SMTP_PASS || '';
  const from = env.SMTP_FROM || user;

  console.log('SMTP_HOST     :', host || '(空)');
  console.log('SMTP_PORT     :', port);
  console.log('SMTP_SECURE   :', secure);
  console.log('SMTP_USER 配置:', user ? '是' : '否');
  console.log('SMTP_PASS 配置:', pass ? `是（长度 ${pass.length}，不回显明文）` : '否（空）');

  if (!user || !pass) {
    console.error('\n[结论] SMTP_USER / SMTP_PASS 未配置，发信必然失败。请在 backend/.env 填写 QQ 邮箱授权码。');
    process.exit(2);
  }

  const transporter = nodemailer.createTransport({
    host, port, secure,
    auth: { user, pass },
    socketTimeout: 15000,
    greetingTimeout: 15000,
    connectionTimeout: 15000,
  });

  try {
    console.log('\n正在连接 SMTP 并向', user, '自发自收测试邮件…');
    const info = await transporter.sendMail({
      from,
      to: user,
      subject: '[Study Tracker] 邮件诊断测试',
      text: `这是一封诊断邮件，证明 SMTP 可用。\n时间：${new Date().toISOString()}\n`,
    });
    console.log('\n[成功] sendMail 返回:');
    console.log('  messageId:', info.messageId);
    console.log('  response :', info.response);
    console.log('  accepted :', JSON.stringify(info.accepted));
    console.log('  rejected :', JSON.stringify(info.rejected));
    console.log('\n[结论] SMTP 发信链路正常。若用户仍收不到，请检查垃圾箱 / 白名单 / 收件地址拼写。');
  } catch (e) {
    console.error('\n[失败] sendMail 报错:');
    console.error('  code       :', e.code);
    console.error('  responseCode:', e.responseCode);
    console.error('  response   :', e.response);
    console.error('  message    :', e.message);
    console.error('\n[排查建议]');
    console.error('  EAUTH / 535   : 授权码错误——QQ 邮箱需用"授权码"而非登录密码，且已开启 SMTP 服务。');
    console.error('  ETIMEDOUT     : 网络/防火墙到 SMTP 端口不通，检查服务器出站 465/587。');
    console.error('  ECONNECTION   : 连接被拒，核对 host/port/secure（465=secure:true，587=secure:false）。');
    process.exitCode = 1;
  } finally {
    try { transporter.close(); } catch (_) {}
  }
})();
