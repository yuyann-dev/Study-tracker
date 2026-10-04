/**
 * utils/statsCache.js — 服务端「自习室统计」缓存
 *
 * 背景：GET /api/study-room/me 与 /plaza 需要对房间内每个成员解析
 * user_data.store_json（单份 1–3MB），30 秒轮询下若每次都 JSON.parse 全量，
 * 在 4 核 / 3.6G 内存的小机器上会有明显压力。这里给「某用户的 review 统计结果」
 * 加一层进程内缓存：
 *
 *   - 缓存键：userId；缓存值：{ ts, today, byDate, total }
 *   - TTL：90 秒（落在 60–120s 区间）。配合 data.js 写入即失效，既能扛住 30s 轮询，
 *          又不会让「今天刚打了卡」的数据脏太久。
 *   - 跨天兜底：缓存记录写入时的 today（UTC+8），取出时若 today 已变化则视为失效，
 *             避免「昨天缓存的 byDate 到今天还命中」导致 streak / 今日次数口径错误。
 *   - 懒清理：get/set 时若距上次清理超过 30 秒，顺带遍历删除所有过期项，
 *           避免常驻 Map 无限增长。
 *   - 硬上限：最多 3000 条（对齐注册用户 1000 内体验最佳、2000 内可接受的口径，
 *           留足余量）。超出时按 ts 从旧到新淘汰约 10%。
 *
 * 纯 JS、无外部依赖。进程重启即空，不持久化。
 */

// TTL 90 秒：60–120s 区间，兼顾轮询压力与打卡实时性
const TTL_MS = 90 * 1000;
// 懒清理间隔：get/set 超过 30 秒未清理才做一次全量过期扫描
const SWEEP_INTERVAL_MS = 30 * 1000;
// 硬上限：对齐注册用户口径（1000 内最佳、2000 内可接受），留余量到 3000
const MAX_ENTRIES = 3000;

/** @type {Map<number, {ts:number, today:string, byDate:object, total:number}>} */
const cache = new Map();
/** 上次懒清理的时间戳（ms）；0 表示尚未清理 */
let _lastSweep = 0;

/**
 * 遍历删除所有 TTL 过期项，并重置清理计时。
 * @param {number} now 当前时间戳（ms）
 */
function sweepExpired(now) {
  for (const [userId, entry] of cache) {
    if (now - entry.ts > TTL_MS) cache.delete(userId);
  }
  _lastSweep = now;
}

/** 距上次清理超过 SWEEP_INTERVAL_MS 才做一次过期扫描（懒清理） */
function maybeSweep(now) {
  if (now - _lastSweep > SWEEP_INTERVAL_MS) sweepExpired(now);
}

/** 超出硬上限时，按 ts 从旧到新淘汰约 10% 最旧条目 */
function evictIfOverLimit() {
  if (cache.size <= MAX_ENTRIES) return;
  // Map.entries 按插入序，但 ts 不一定等于插入序（更新会重插），这里显式按 ts 排序
  const sorted = Array.from(cache.entries()).sort((a, b) => a[1].ts - b[1].ts);
  const drop = Math.ceil(sorted.length * 0.1);
  for (let i = 0; i < drop; i++) cache.delete(sorted[i][0]);
}

/**
 * 取某用户的缓存统计。
 * 命中条件：① 存在；② 未过 TTL；③ entry.today === expectedToday（跨天兜底）。
 * 任一不满足即返回 null，并顺带清掉该 key。
 *
 * @param {number} userId
 * @param {string} expectedToday 当前 UTC+8 日期 'YYYY-MM-DD'
 * @returns {{byDate:object, total:number}|null}
 */
function get(userId, expectedToday) {
  const now = Date.now();
  maybeSweep(now);
  const entry = cache.get(userId);
  if (!entry) return null;
  // TTL 过期
  if (now - entry.ts > TTL_MS) {
    cache.delete(userId);
    return null;
  }
  // 跨天：缓存里的 today 与今天不一致，按新一天重算
  if (entry.today !== expectedToday) {
    cache.delete(userId);
    return null;
  }
  return { byDate: entry.byDate, total: entry.total };
}

/**
 * 写入/更新某用户的缓存统计。
 * @param {number} userId
 * @param {string} today 写入时的 UTC+8 日期 'YYYY-MM-DD'
 * @param {{byDate:object, total:number}} stats
 */
function set(userId, today, stats) {
  const now = Date.now();
  maybeSweep(now);
  cache.set(userId, {
    ts: now,
    today,
    byDate: (stats && stats.byDate) || {},
    total: (stats && stats.total) || 0,
  });
  evictIfOverLimit();
}

/**
 * 主动失效某用户的缓存（用户 PUT 新数据后调用）。
 * 其余 key 继续走 TTL，不做全量清理。
 * @param {number} userId
 */
function invalidate(userId) {
  cache.delete(userId);
}

module.exports = {
  get,
  set,
  invalidate,
  TTL_MS,
  SWEEP_INTERVAL_MS,
  MAX_ENTRIES,
  // 仅供测试/调试：暴露内部 Map 以便手动改 ts 模拟过期，生产代码请勿依赖
  _cache: cache,
};
