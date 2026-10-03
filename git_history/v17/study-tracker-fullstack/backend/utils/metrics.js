/**
 * utils/metrics.js — 轻量内存滑窗应用指标（不引入 Prometheus）
 *
 * 记录最近 1 小时内的请求数、5xx 错误数、数据同步平均延迟，供 GET /api/admin/system 展示。
 * 纯内存数组按时间戳滑动裁剪，进程重启归零（够用级监控，不持久化）。
 */
const { alert } = require('./alert');

const WINDOW_MS = 60 * 60 * 1000; // 1 小时滑窗
const EVENTS_CAP = 5000;          // 上限保护，避免极端流量撑爆内存

let events = [];        // { t, status }
let syncDurations = []; // { t, dur } 仅 /api/data PUT 的耗时
let consecutive5xx = 0; // 当前连续 5xx 计数
const CONSECUTIVE_5XX_TRIGGER = 5;

/** 裁剪滑窗，只保留最近 1 小时 */
function prune(now) {
  const cutoff = now - WINDOW_MS;
  while (events.length && events[0].t < cutoff) events.shift();
  while (syncDurations.length && syncDurations[0].t < cutoff) syncDurations.shift();
}

/**
 * 每个请求结束时调用（server.js 响应中间件）
 * @param {number} statusCode 响应状态码
 * @param {number} durationMs 请求耗时
 * @param {boolean} isSync 是否为数据同步（/api/data）请求
 */
function record(statusCode, durationMs, isSync) {
  const now = Date.now();
  events.push({ t: now, status: statusCode });
  if (events.length > EVENTS_CAP) events.splice(0, events.length - EVENTS_CAP);
  if (isSync) {
    syncDurations.push({ t: now, dur: durationMs });
    if (syncDurations.length > 500) syncDurations.splice(0, syncDurations.length - 500);
  }

  // 连续 5xx 计数 + 达到阈值告警（告警模块内部做 1 小时去重）
  if (statusCode >= 500) {
    consecutive5xx += 1;
    if (consecutive5xx >= CONSECUTIVE_5XX_TRIGGER) {
      alert('consecutive_5xx', '后端连续 5xx 告警',
        `最近已连续 ${consecutive5xx} 个请求返回 5xx，请立即检查服务日志。`);
      consecutive5xx = 0; // 告警后重置计数，避免重复轰炸
    }
  } else if (statusCode >= 400) {
    // 4xx 不打断连续 5xx 计数（保守：只有成功 2xx 才打断）
  } else {
    consecutive5xx = 0;
  }

  prune(now);
}

/** 获取最近 1 小时指标快照 */
function snapshot() {
  prune(Date.now());
  const total = events.length;
  const c5 = events.filter((e) => e.status >= 500).length;
  const avgSync = syncDurations.length
    ? Math.round(syncDurations.reduce((s, x) => s + x.dur, 0) / syncDurations.length)
    : 0;
  return {
    windowMs: WINDOW_MS,
    totalRequests: total,
    count5xx: c5,
    errorRate: total ? Math.round((c5 / total) * 1000) / 10 : 0,
    avgSyncLatencyMs: avgSync,
    syncSamples: syncDurations.length,
  };
}

module.exports = { record, snapshot };
