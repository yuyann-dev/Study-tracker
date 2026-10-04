/**
 * server.js — Study Tracker 后端入口
 *
 * 职责：装配 Express、安全响应头、请求指标、挂载路由、静态文件、全局错误处理。
 * 业务逻辑不要写在这里，一律拆到 routes/。
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { config } = require('./config');
const db = require('./database'); // 初始化 SQLite（建表 + 幂等迁移）

// JWT_SECRET 强度校验：系统环境变量空字符串会绕过 ensureEnvFile() 的自动生成，
// 这里在数据库初始化之后、监听端口之前兜底，防止以空密钥启动导致 token 可被伪造。
if (!process.env.JWT_SECRET || String(process.env.JWT_SECRET).length < 32) {
  console.error('FATAL: JWT_SECRET 未配置或强度不足（需≥32字符）');
  process.exit(1);
}
const metrics = require('./utils/metrics');
const logger = require('./utils/logger');

const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const studyRoomRoutes = require('./routes/studyRoom');

const app = express();

/** CORS 白名单：仅允许本站域名（同源请求浏览器本就放行，这里做显式约束） */
const ALLOWED_ORIGINS = [
  'https://yystudy.top',
  'https://www.yystudy.top',
  'http://yystudy.top',
  'http://www.yystudy.top',
];
app.use(
  cors({
    origin(origin, cb) {
      // 同源/非浏览器请求（无 Origin）直接放行
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      // 拒绝但不抛错：cb(null, false) 不会落到全局错误处理返回 500，仅正常拒绝跨域
      return cb(null, false);
    },
  })
);

// 本服务仅绑 127.0.0.1、前面有一层 Nginx 反代。信任 1 层代理后，req.ip 才能取到
// X-Forwarded-For 里的真实客户端 IP，否则所有请求都显示 127.0.0.1，导致 express-rate-limit
// 的 IP 维度全站共享一个计数桶（限流失效、可被 DoS）。必须在挂载任何 rate limiter 之前设置。
app.set('trust proxy', 1);

// ── 安全响应头（8.2 CSP；保留原有 X-Content-Type-Options / X-Frame-Options）──
// CSP：API 本身不渲染页面，但统一带上纵深防御；前端页面的 CSP 由 Nginx 同名头兜底。
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'"
  );
  next();
});

// ── 请求指标：每个请求结束时记录状态码与耗时，供 /system 展示（轻量内存滑窗）──
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    try {
      metrics.record(res.statusCode, ms, req.path.startsWith('/api/data'));
    } catch (_) {}
    // 访问日志落 jsonl（健康检查过于频繁，跳过；写入失败不影响业务）
    if (req.path !== '/api/health') {
      try { logger.access({ method: req.method, path: req.path, status: res.statusCode, ms, ip: req.ip }); } catch (_) {}
    }
  });
  next();
});

app.use(express.json({ limit: config.jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.jsonBodyLimit }));

/** 注册 / 登录 / 发码限流：每 IP 每分钟 N 次 */
const authLimiter = rateLimit({
  windowMs: config.rateLimit.authPerMinute.windowMs,
  max: config.rateLimit.authPerMinute.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: '操作过于频繁，请稍后再试' },
});
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/send-code', authLimiter);

/** 忘记密码（reset-password）：真正接到 config.forgotPerHour，每 IP 每小时 N 次 */
const resetHourLimiter = rateLimit({
  windowMs: config.rateLimit.forgotPerHour.windowMs,
  max: config.rateLimit.forgotPerHour.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: '重置密码请求过于频繁，请 1 小时后再试' },
});
app.use('/api/auth/reset-password', resetHourLimiter);

/** 数据同步限流：每 IP 每分钟 30 次（正常 60 秒一次自动同步，余量充足） */
const dataLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: '同步过于频繁，请稍后再试' },
});
app.use('/api/data', dataLimiter);

// 业务路由
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/study-room', studyRoomRoutes);

// 上传的头像静态访问
app.use('/uploads', express.static(config.uploadDir));

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// 兜底 404
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: '接口不存在' }));

// 全局错误兜底，避免单个请求崩掉整个进程
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.log('error', 'unhandled: ' + err.message, { method: req.method, path: req.path });
  res.status(500).json({ ok: false, error: '服务器开小差了，请稍后重试' });
});

const server = app.listen(config.port, config.host, () => {
  logger.log('info', `backend listening on http://${config.host}:${config.port}`);
});

// 优雅关闭：systemd restart / docker stop 收到 SIGTERM 时先停止接新连接，
// 再做一次 WAL checkpoint 把内存页刷盘，避免进程直接退出中断写入。
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    try { db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run(); } catch (e) {}
    process.exit(0);
  });
  // 10 秒内未结束则强制退出，避免 hang 住
  setTimeout(() => process.exit(1), 10000).unref();
});
