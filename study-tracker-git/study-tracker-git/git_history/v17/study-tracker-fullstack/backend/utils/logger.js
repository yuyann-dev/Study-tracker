/**
 * utils/logger.js — 文件日志（JSON Lines，按天轮转 + 保留期清理）
 *
 * 与内存指标（metrics）、数据库审计（audit_logs）分离，独立成文件便于归档/采集：
 *   - access-YYYY-MM-DD.jsonl：每个 HTTP 请求一行（方法/路径/状态/耗时/IP）
 *   - app-YYYY-MM-DD.jsonl   ：应用运行与错误（level = info | warn | error）
 *
 * 写入失败绝不阻断主业务；app 日志同时镜像到 console（systemd journal）。
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.join(__dirname, '..', 'logs');
const RETAIN_DAYS = parseInt(process.env.LOG_RETAIN_DAYS || '14', 10);

const streams = {}; // kind -> { date, stream }

function ensureDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function getStream(kind) {
  ensureDir();
  const date = today();
  const cur = streams[kind];
  if (cur && cur.date === date) return cur.stream;
  if (cur) { try { cur.stream.end(); } catch (_) {} }
  const stream = fs.createWriteStream(path.join(LOG_DIR, `${kind}-${date}.jsonl`), { flags: 'a' });
  stream.on('error', () => {});
  streams[kind] = { date, stream };
  return stream;
}

function write(kind, obj) {
  try {
    getStream(kind).write(JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
  } catch (_) {}
}

/** 写一条访问日志 */
function access(rec) { write('access', rec); }

/** 写一条应用日志（并镜像到 console） */
function log(level, msg, meta = {}) {
  write('app', { level, msg, ...meta });
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  try { fn(`[${level}] ${msg}`); } catch (_) {}
}

/** 删除超过保留期的旧日志（按文件名日期判断） */
function prune() {
  try {
    ensureDir();
    const cutoff = Date.now() - RETAIN_DAYS * 86400 * 1000;
    fs.readdirSync(LOG_DIR).forEach((f) => {
      const m = f.match(/^(?:access|app)-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!m) return;
      if (new Date(m[1] + 'T00:00:00').getTime() < cutoff) {
        try { fs.unlinkSync(path.join(LOG_DIR, f)); } catch (_) {}
      }
    });
  } catch (_) {}
}

ensureDir();
prune();
setInterval(prune, 60 * 60 * 1000).unref(); // 长期运行跨天清理，unref 不阻止进程退出

module.exports = { access, log, prune, LOG_DIR };
