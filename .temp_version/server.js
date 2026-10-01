/**
 * server.js — Study Tracker 后端入口
 *
 * 职责：装配 Express、挂载路由、静态文件、全局错误处理。
 * 业务逻辑不要写在这里，一律拆到 routes/。
 */
const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { config } = require('./config');
require('./database'); // 初始化 SQLite（建表 + 幂等迁移）

const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(cors());
app.use(express.json({ limit: config.jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.jsonBodyLimit }));

/** 注册 / 登录限流：每 IP 每分钟 N 次 */
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
app.use('/api/auth/reset-password', authLimiter);

// 业务路由
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

// 上传的头像静态访问
app.use('/uploads', express.static(config.uploadDir));

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// 兜底 404
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: '接口不存在' }));

// 全局错误兜底，避免单个请求崩掉整个进程
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('unhandled error:', err.message);
  res.status(500).json({ ok: false, error: '服务器内部错误' });
});

app.listen(config.port, config.host, () => {
  console.log(`[study-tracker] backend listening on http://${config.host}:${config.port}`);
});
