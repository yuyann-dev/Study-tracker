/**
 * config.js — 全局配置常量集中地
 *
 * 所有可调参数（端口、JWT、bcrypt、限流、上传大小、正则、SMTP）都在这里定义，
 * 业务代码只从这里引用，不要在路由/中间件里硬编码。
 *
 * 环境变量优先级高于默认值；部署时通过 backend/.env 覆盖。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DOTENV_PATH = path.join(__dirname, '.env');

/**
 * 首次启动时若 .env 未配置 JWT_SECRET，自动生成一个随机密钥写入 .env。
 */
function ensureEnvFile() {
  if (fs.existsSync(DOTENV_PATH)) {
    const content = fs.readFileSync(DOTENV_PATH, 'utf8');
    if (/^JWT_SECRET\s*=.+/m.test(content)) return;
    const secret = crypto.randomBytes(48).toString('hex');
    fs.appendFileSync(DOTENV_PATH, `\nJWT_SECRET=${secret}\n`);
    return;
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(DOTENV_PATH, `PORT=3001\nJWT_SECRET=${secret}\n`);
}
ensureEnvFile();
require('dotenv').config({ path: DOTENV_PATH });

/** 主配置对象 */
const config = {
  /** 服务监听地址，只绑回环，由 Nginx 反代 */
  host: '127.0.0.1',
  port: parseInt(process.env.PORT || '3001', 10),

  /** JWT 签名 */
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: '30d',
    /** 重置 token 有效期 */
    resetExpiresIn: '1h',
  },

  /** 密码哈希 */
  bcryptRounds: 10,

  /** 请求体大小 */
  jsonBodyLimit: '10mb',

  /** 限流规则 */
  rateLimit: {
    /** 注册 / 登录：每 IP 每分钟 10 次 */
    authPerMinute: { windowMs: 60 * 1000, max: 10 },
    /** 忘记密码：每 IP 每小时 5 次 */
    forgotPerHour: { windowMs: 60 * 60 * 1000, max: 5 },
  },

  /** 头像上传 */
  upload: {
    maxBytes: 2 * 1024 * 1024, // 2MB
    dir: path.join(__dirname, 'uploads'),
    allowedMime: {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
    },
  },

  /** 文件路径 */
  dbFile: path.join(__dirname, 'data', 'study.db'),
  uploadDir: path.join(__dirname, 'uploads'),

  /** SMTP 邮件（user/pass 为空时不发邮件） */
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.qq.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE !== 'false',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },

  /** 前端站点 URL，用于邮件里的重置链接 */
  appUrl: (process.env.APP_URL || 'https://yystudy.top').replace(/\/+$/, ''),
};

/** 业务正则规则（集中管理，方便未来扩展手机号登录等） */
const RULES = {
  username: /^[^\u0000-\u001f\u007f]{1,20}$/,
  email: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/i,
  password: { minLen: 8 },
  inviteAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  inviteLength: 8,
};

module.exports = { config, RULES, DOTENV_PATH };
