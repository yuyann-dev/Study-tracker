/**
 * routes/studyRoom.js — 自习室（Study Room）
 *
 * 轻量学习小组：一个用户同时只能加入 1 个房间（UNIQUE(user_id)），
 * 最多 20 人；无消息流，仅展示成员身份 + 今日打卡状态（隐私开关默认关闭）。
 *
 * 路由前缀 /api/study-room，全部需登录：
 *   GET    /me                 当前房间信息 + 成员列表（含 streak 与今日打卡数，未公开用户今日字段返回 null）
 *   POST   /create             创建房间（自动生成 6 位房间号，默认私有）
 *   POST   /join               通过房间号加入（私有房只能凭房间号加入）
 *   POST   /leave              退出（房主退出自动转让给最早加入者，或解散房间）
 *   DELETE /                   房主解散整个自习室（ON DELETE CASCADE 清成员）
 *   GET    /member/:userId     成员公开学习数据（统计 + 最近学习动态，需同房间）
 *   PATCH  /privacy            切换「公开学习数据到自习室」开关
 *   POST   /kick               房主踢出某成员（body: {userId}）
 *   PATCH  /settings           房主修改房间名 / 是否公开到广场（body: {name?, isPublic?}）
 *   GET    /plaza              公开自习室广场（只列 is_public=1 的房间）
 *
 * 设计契约见 docs/study-room-design.md（v1.1 变更见文末）。
 */
const express = require('express');
const db = require('../database');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/respond');
const { writeAudit } = require('../utils/audit');
const statsCache = require('../utils/statsCache');

const router = express.Router();
router.use(authRequired);

/** 房间号字符集：A-Z 去掉 I/L/O + 2-9 去掉 0/1，共 31 字符 */
const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/**
 * 房间人数上限。依据：4 核 / 3.6G 内存小机器；GET /me 需解析 N 个成员的
 * user_data.store_json（单份 1–3MB）。配合 statsCache（TTL 90s + 写入即失效）后，
 * 20 人在 30 秒轮询下仍流畅；再大则退化为群聊，不再是「小圈子监督」。
 * 注册用户口径 1000 内体验最佳、2000 内可接受（仅注释，不加代码限制）。
 */
const MAX_ROOM_MEMBERS = 20;
/** 房间号格式：6 位大写字母数字（I/L/O/0/1 已排除） */
const ROOM_CODE_RE = /^[A-HJKMNP-Z2-9]{6}$/;

/** 房间标签枚举：考研、考公、期末、英语、其他 */
const VALID_CATEGORIES = ['考研', '考公', '期末', '英语', 'other'];

/**
 * 广场结果 60s 进程内缓存。key 固定为 'plaza'（公开房列表全局共享）。
 * 公开房列表不涉及用户私有数据，60s 延迟可接受（新加入/满员最多延迟一个周期）。
 */
const PLAZA_CACHE_TTL = 60 * 1000;
let _plazaCache = { ts: 0, data: null };

/**
 * 在线状态心跳表：userId -> lastSeenAt(ms)。
 * /me 请求时顺带更新（30s 轮询天然带心跳）。进程内，重启丢失可接受。
 * 60s 内有心跳=在线(绿点)；60s~5min=离开(灰点+"x分钟前")；>5min=离线(灰点)。
 */
const onlineHeartbeat = new Map();
const ONLINE_MS = 60 * 1000;       // 60s 内 = 在线
const AWAY_MS = 5 * 60 * 1000;     // 5 分钟内 = 离开
function touchOnline(userId) {
  if (typeof userId === 'number' && Number.isInteger(userId)) {
    onlineHeartbeat.set(userId, Date.now());
  }
}
/** 取某用户的在线状态：online / away / offline */
function getOnlineStatus(userId) {
  const last = onlineHeartbeat.get(userId);
  if (!last) return { status: 'offline', label: '' };
  const diff = Date.now() - last;
  if (diff < ONLINE_MS) return { status: 'online', label: '刚刚' };
  if (diff < AWAY_MS) {
    const mins = Math.floor(diff / 60000);
    return { status: 'away', label: (mins < 1 ? 1 : mins) + ' 分钟前' };
  }
  return { status: 'offline', label: '' };
}

// ── 日期 / 统计小工具 ──────────────────────────────────────────────────────

/** 今天（UTC+8）的 'YYYY-MM-DD'，与前端本地日期对齐 */
function todayStr() {
  return db.prepare("SELECT date('now', '+8 hours') AS d").get().d;
}

/** 'YYYY-MM-DD' 平移 deltaDays 天（按 UTC 解析，避免本地时区偏差） */
function shiftDate(dateStr, deltaDays) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 0=周一 … 6=周日 */
function mondayIndex(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=周日
  return (dow + 6) % 7;
}

/** UTC 星期索引 → 中文星期（与 new Date(dateStr+'T00:00:00Z').getUTCDay() 对应） */
const DAY_NAMES_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 'YYYY-MM-DD' → 中文星期（周日~周六），按 UTC 解析避免本地时区偏差 */
function dayOfWeekCn(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=周日
  return DAY_NAMES_CN[dow] || '';
}

/**
 * 从 user_data.store_json 收集 review 统计：
 *   byDate     { 'YYYY-MM-DD': 当天 review 条数 }
 *   total      全量 review 总条数
 *   allDates   Set，所有有学习活动的日期（刷题 records + 复习 reviews + 首次学习 learnedDate）
 *   todayScore 今日活跃度分数（刷题页×1 + 套卷×4 + 错题×0.3），用于成员列表排序
 * 口径与前端 renderHeatmap 一致：遍历 projects[].items[].reviews[]，每条 review 计 1。
 * allDates 用于学习天数、streak、今日打卡判断，确保纯刷题日也算学习。
 */
function collectReviewStats(storeJson) {
  const byDate = {};
  const allDates = new Set();
  let total = 0;
  let store = null;
  try { store = storeJson ? JSON.parse(storeJson) : null; } catch (_) { store = null; }
  if (!store || typeof store !== 'object') return { byDate, total, allDates, todayScore: 0 };
  const projects = store.projects || {};
  const today = todayStr();
  const yesterday = shiftDate(today, -1);
  let todayScore = 0;
  for (const p of Object.values(projects)) {
    if (!p || typeof p !== 'object') continue;
    // 刷题打卡记录日期
    if (p.type === 'exercise' && Array.isArray(p.records)) {
      p.records.forEach(r => { if (r && r.date) allDates.add(r.date); });
    }
    // 今日活跃度：刷题页数/套数
    if (p.type === 'exercise') {
      const cur = _getCompletedPagesAtDate(p, today);
      const prev = _getCompletedPagesAtDate(p, yesterday);
      const delta = Math.max(0, cur - prev);
      if (delta > 0) {
        todayScore += delta * (_isSetMode(p) ? 4.0 : 1.0);
      }
    }
    if (!Array.isArray(p.items)) continue;
    for (const it of p.items) {
      if (!it || typeof it !== 'object') continue;
      // 首次学习日期也算学习活动
      if (it.learnedDate) allDates.add(it.learnedDate);
      if (!Array.isArray(it.reviews)) continue;
      for (const r of it.reviews) {
        if (!r || typeof r.date !== 'string' || !r.date) continue;
        byDate[r.date] = (byDate[r.date] || 0) + 1;
        allDates.add(r.date);
        total++;
        // 今日复习条数计入活跃度（错题和背书都算，权重0.3）
        if (r.date === today) todayScore += 0.3;
      }
    }
  }
  return { byDate, total, allDates, todayScore: Math.round(todayScore * 100) / 100 };
}

/**
 * 取某用户的 review 统计，优先命中 statsCache，未命中则读 user_data.store_json
 * 解析后回写缓存。GET /me、GET /member、GET /plaza 全部复用本函数，
 * 禁止在各路由里再各自直接 parse store_json。
 * @param {number} userId
 * @returns {{byDate:Object<string,number>, total:number}}
 */
function getUserStats(userId) {
  const today = todayStr();
  const hit = statsCache.get(userId, today);
  if (hit) return hit;
  const row = db.prepare('SELECT store_json FROM user_data WHERE user_id = ?').get(userId);
  const stats = collectReviewStats(row && row.store_json);
  statsCache.set(userId, today, stats);
  return stats; // { byDate, total }
}

/**
 * 计算连续打卡 streak（宽容模式）：
 *   - 今天有学习 → 从今天起算；今天没有 → 从昨天起算（不因今天尚未学而清零）
 *   - 宽容续接：中间断签天数不超过当前等级的宽容阈值，且断签后立刻接上
 *     并连续达到补偿天数，则断签日也算入 streak，不中断连续
 *   - 等级越高宽容度越大：3天级允许断1天续2天，365天级允许断5天续30天
 *   - 加 3650 天保险上限防异常数据死循环
 * @param {Set<string>|Object<string,number>} dateSource 有学习记录的日期集合或 byDate 对象
 * @param {string} today 当前 UTC+8 日期 'YYYY-MM-DD'
 * @returns {number}
 */
function computeStreak(dateSource, today) {
  const has = (d) => {
    if (dateSource instanceof Set) return dateSource.has(d);
    return (dateSource[d] || 0) > 0;
  };
  // 今天学了从今天算，今天还没学则从昨天往回算
  let cursor = has(today) ? today : shiftDate(today, -1);
  if (!has(cursor)) return 0;
  let streak = 0;
  let guard = 0;
  // 第一段：严格连续
  while (has(cursor) && guard < 3650) {
    streak++;
    cursor = shiftDate(cursor, -1);
    guard++;
  }
  // 宽容续接循环：找间隔 → 判断是否在宽容阈值内 → 数下一段连续 → 满足补偿则拼接
  while (guard < 3650) {
    let gap = 0;
    while (!has(cursor) && gap < 10 && guard < 3650) {
      gap++;
      cursor = shiftDate(cursor, -1);
      guard++;
    }
    if (gap === 0 || gap >= 10) break;
    // 根据当前累计 streak 决定宽容阈值和补偿要求
    let maxGap = 1, minContinue = 2;
    if (streak >= 365) { maxGap = 5; minContinue = 30; }
    else if (streak >= 100) { maxGap = 3; minContinue = 14; }
    else if (streak >= 30) { maxGap = 2; minContinue = 7; }
    else if (streak >= 14) { maxGap = 2; minContinue = 5; }
    else if (streak >= 7) { maxGap = 1; minContinue = 3; }
    if (gap > maxGap) break;
    // 数下一段连续天数
    let nextLen = 0;
    let nextCursor = cursor;
    while (has(nextCursor) && guard < 3650) {
      nextLen++;
      nextCursor = shiftDate(nextCursor, -1);
      guard++;
    }
    if (nextLen < minContinue) break;
    // 续接成功：间隔日 + 下一段全部计入
    streak += gap + nextLen;
    cursor = nextCursor;
  }
  return streak;
}

// ── 项目今日完成量提取（口径与前端 getMetrics 一致）──────────────────────
// 以下函数复刻 frontend/js/app.js 中 getCompletedPages / getCompletedPagesAtDate
// 的区间合并逻辑，用于 /member/:userId 返回各项目今日完成页数/套数。

function _mergeRanges(ranges) {
  if (!ranges || !ranges.length) return [];
  const sorted = ranges.filter(r => r.end >= r.start).slice().sort((a, b) => a.start - b.start);
  if (!sorted.length) return [];
  const merged = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end + 1) last.end = Math.max(last.end, sorted[i].end);
    else merged.push({ start: sorted[i].start, end: sorted[i].end });
  }
  return merged;
}
function _countMergedPages(merged) {
  return merged.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
}
function _countRanges(rs) { return rs.reduce((s, r) => s + (r.end - r.start + 1), 0); }
function _getRecordRange(r, p) {
  if (r.startPage != null) {
    const s = r.startPage;
    const e = r.endPage != null ? r.endPage : s;
    return { start: s, end: e };
  }
  const end = r.endPage != null ? r.endPage : (r.page != null ? r.page : 0);
  return { start: 1, end };
}
function _getTargetPageRanges(p) {
  if (p.unitMode && Array.isArray(p.units) && p.units.length) {
    const mode = p.unitScopeMode || (p.unitScopeOnly === false ? 'book' : 'all');
    if (mode === 'leaf' || mode === 'all') {
      const all = [];
      (function collect(u) {
        const hasChildren = u.children && u.children.length;
        if (mode === 'all' || !hasChildren) {
          if (u.startPage != null && u.endPage != null && u.endPage >= u.startPage) {
            all.push({ start: u.startPage, end: u.endPage });
          }
        }
        (u.children || []).forEach(collect);
      })({ children: p.units });
      if (all.length) return _mergeRanges(all);
    }
  }
  if (p.scopeMode && Array.isArray(p.targetRanges) && p.targetRanges.length) {
    return _mergeRanges(p.targetRanges.map(r => ({ start: r.start, end: r.end })));
  }
  const lo = p.bookStartPage != null ? p.bookStartPage : 1;
  const hi = p.bookEndPage != null ? p.bookEndPage : (p.total || 0);
  if (hi >= lo) return [{ start: lo, end: hi }];
  return [];
}
function _getBookDoneRanges(p) {
  let raw;
  if (p.type === 'exercise') raw = (p.records || []).map(r => _getRecordRange(r, p));
  else raw = (p.items || []).map(it => {
    const s = it.pageStart != null ? it.pageStart : (it.page != null ? it.page : 0);
    const e = it.pageEnd != null ? it.pageEnd : (it.pageStart != null ? it.pageStart : (it.page != null ? it.page : 0));
    return { start: s, end: e };
  });
  const targets = _getTargetPageRanges(p);
  if (!targets.length) return [];
  const clipped = [];
  _mergeRanges(raw).forEach(r => {
    targets.forEach(t => {
      const s = Math.max(t.start, r.start), e = Math.min(t.end, r.end);
      if (e >= s) clipped.push({ start: s, end: e });
    });
  });
  return _mergeRanges(clipped);
}
function _getNormalizedSections(p) {
  const secs = Array.isArray(p.paperSections) ? p.paperSections.filter(s => s && s.name) : [];
  if (!secs.length) return [];
  const sum = secs.reduce((s, x) => s + Math.max(0, Number(x.weight) || 0), 0);
  if (sum <= 0) {
    const eq = 1 / secs.length;
    return secs.map(s => ({ id: s.id, wt: eq }));
  }
  return secs.map(s => ({ id: s.id, wt: Math.max(0, Number(s.weight) || 0) / sum }));
}
function _getSetState(p, targetDate) {
  const secs = _getNormalizedSections(p);
  const state = {};
  const recs = (p.records || []).slice().sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
  const lastSetSec = {};
  recs.forEach(r => {
    if (r.set == null) return;
    if (targetDate && r.date > targetDate) return;
    const no = r.set;
    if (!state[no]) state[no] = { secs: {}, legacy: 0 };
    const st = state[no];
    if (r.secId != null && r.pct != null) {
      const key = no + '|' + r.secId;
      const pct = Number(r.pct);
      const prev = lastSetSec[key];
      if (prev && prev.date === r.date) {
        st.secs[r.secId] = Math.max(0, Math.min(100, (st.secs[r.secId] || 0) - prev.pct + pct));
        prev.pct = pct;
      } else {
        st.secs[r.secId] = Math.max(0, Math.min(100, (st.secs[r.secId] || 0) + pct));
        lastSetSec[key] = { date: r.date, pct: pct };
      }
    } else if (r.all === true || (r.done == null && r.q == null)) {
      if (secs.length) secs.forEach(s => { st.secs[s.id] = 100; });
      st.legacy = 1;
    } else if (r.done != null && r.q != null && r.q > 0) {
      st.legacy = Math.max(0, Math.min(1, r.done / r.q));
    }
  });
  return state;
}
function _getSetFraction(p, no, state) {
  const st = (state || _getSetState(p))[no];
  if (!st) return 0;
  const secs = _getNormalizedSections(p);
  if (secs.length) {
    let f = 0;
    secs.forEach(s => { f += ((st.secs[s.id] || 0) / 100) * s.wt; });
    return Math.max(0, Math.min(1, f));
  }
  return st.legacy;
}
function _getCompletedSets(p, targetDate) {
  const state = _getSetState(p, targetDate);
  return Object.keys(state).reduce((sum, no) => sum + _getSetFraction(p, no, state), 0);
}
function _isSetMode(p) { return !!p && p.type === 'exercise' && p.unit === 'set'; }

/** 当前累计完成量（页数或套数） */
function _getCompletedPagesNow(p) {
  if (_isSetMode(p)) return _getCompletedSets(p);
  if (p.type === 'mistake') return (p.items || []).filter(it => it.mastered || it.manualMastered).length;
  let done = _countRanges(_getBookDoneRanges(p));
  if (p.type === 'recite' && Array.isArray(p.abandonedRanges)) {
    p.abandonedRanges.forEach(r => {
      if (r && r.end >= r.start) done += (r.end - r.start + 1);
    });
  }
  return done;
}
/** 截至 targetDate 当日累计完成量 */
function _getCompletedPagesAtDate(p, targetDate) {
  if (_isSetMode(p)) return _getCompletedSets(p, targetDate);
  if (p.type === 'mistake') {
    return (p.items || []).filter(it => {
      if (!(it.mastered || it.manualMastered)) return false;
      const d = it.masteredDate || it.learnedDate;
      return d && d <= targetDate;
    }).length;
  }
  let ranges;
  if (p.type === 'exercise') {
    ranges = (p.records || []).filter(r => r.date <= targetDate).map(r => _getRecordRange(r, p));
  } else {
    ranges = (p.items || []).filter(it => it.learnedDate && it.learnedDate <= targetDate)
      .map(it => {
        const s = it.pageStart != null ? it.pageStart : (it.page != null ? it.page : 0);
        const e = it.pageEnd != null ? it.pageEnd : (it.pageStart != null ? it.pageStart : (it.page != null ? it.page : 0));
        return { start: s, end: e };
      });
  }
  // 裁剪到目标范围
  const targets = _getTargetPageRanges(p);
  if (!targets.length) return 0;
  const merged = _mergeRanges(ranges);
  const clipped = [];
  merged.forEach(r => targets.forEach(t => {
    const s = Math.max(t.start, r.start), e = Math.min(t.end, r.end);
    if (e >= s) clipped.push({ start: s, end: e });
  }));
  let result = _countMergedPages(_mergeRanges(clipped));
  // recite 类型：与 _getCompletedPagesNow 对齐，战略放弃页段也计入累计，
  // 否则 delta（now - yesterday）会把 abandoned 误算成今日新增
  if (p.type === 'recite' && Array.isArray(p.abandonedRanges)) {
    p.abandonedRanges.forEach(r => {
      if (r && r.end >= r.start) result += (r.end - r.start + 1);
    });
  }
  return result;
}

/**
 * 从 store_json 提取每个项目今日完成量（delta = 当前累计 - 昨日累计）。
 * 刷题本页模式→页；套卷模式→套；错题本→条；背书本→页。
 * 只返回今日有完成的项目（todayCount > 0）。
 */
function collectProjectTodayProgress(storeJson) {
  let store = null;
  try { store = storeJson ? JSON.parse(storeJson) : null; } catch (_) { store = null; }
  if (!store || typeof store !== 'object' || !store.projects) return [];
  const today = todayStr();
  const yesterday = shiftDate(today, -1);
  const result = [];
  for (const [pid, p] of Object.entries(store.projects)) {
    if (!p || typeof p !== 'object') continue;
    let unit = '页';
    if (_isSetMode(p)) unit = '套';
    else if (p.type === 'mistake') unit = '条';
    else if (p.type === 'exercise') unit = '页';
    else if (p.type === 'recite') unit = '页';

    const now = _getCompletedPagesNow(p);
    const yest = _getCompletedPagesAtDate(p, yesterday);
    const todayCount = Math.max(0, now - yest);
    if (todayCount <= 0) continue;

    result.push({
      projectId: pid,
      projectName: String(p.name || '未命名项目'),
      type: p.type || 'exercise',
      unit,
      todayCount: Math.round(todayCount * 100) / 100,
    });
  }
  // 今日完成量降序，做多环图排列更直观
  result.sort((a, b) => b.todayCount - a.todayCount);
  return result;
}

/**
 * 广场房间排序：成员数降序优先；成员数相同时，近 7 天成员打卡总数 active7 降序。
 * 热门口径：成员规模优先，其次近 7 天活跃热度。返回 -1 / 0 / 1 供 Array.sort 使用。
 * @param {{memberCount:number, active7:number}} a
 * @param {{memberCount:number, active7:number}} b
 */
function comparePlazaRooms(a, b) {
  if (b.memberCount !== a.memberCount) return Math.sign(b.memberCount - a.memberCount);
  return Math.sign(b.active7 - a.active7);
}

/** 生成 6 位随机房间号 */
function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

/** 循环生成直到不重复（8.87 亿组合下碰撞概率极低，循环兜底唯一性） */
function generateUniqueRoomCode() {
  let code;
  do {
    code = generateRoomCode();
  } while (db.prepare('SELECT id FROM study_rooms WHERE room_code = ?').get(code));
  return code;
}

/** 查询用户当前所在房间（含房间行 + 是否公开）；不在房间返回 null */
function myRoomRow(userId) {
  return db
    .prepare(
      `SELECT srm.room_id AS roomId, sr.room_code AS roomCode, sr.name,
              sr.owner_id AS ownerId, sr.is_public AS isPublic,
              sr.intro AS intro, sr.category AS category
       FROM study_room_members srm
       JOIN study_rooms sr ON sr.id = srm.room_id
       WHERE srm.user_id = ?`
    )
    .get(userId);
}

/**
 * 判断异常是否为 UNIQUE 约束冲突（study_room_members 的 UNIQUE(user_id)）。
 * better-sqlite3 可能给出 e.code='SQLITE_CONSTRAINT_UNIQUE'（也可能只是 SQLITE_CONSTRAINT），
 * 同时 message 会含 'UNIQUE constraint failed'，二者任一命中即视为撞唯一约束。
 * 用于并发/重复加入时把底层 500 转成友好提示。
 */
function isUniqueViolation(e) {
  return (!!e && ((typeof e.code === 'string' && e.code.startsWith('SQLITE_CONSTRAINT')) ||
    /UNIQUE constraint failed/i.test(e && e.message)));
}

// ── 接口 ──────────────────────────────────────────────────────────────────

// GET /api/study-room/me —— 当前房间 + 成员列表（未公开用户的学习数字返回 null）
router.get('/me', (req, res) => {
  try {
    const me = req.user.id;
    // 在线心跳：/me 30s 轮询天然带心跳，进程内记录 lastSeenAt
    touchOnline(me);
    const room = myRoomRow(me);
    if (!room) return ok(res, { room: null, members: [] });

    const today = todayStr();
    const rows = db
      .prepare(
        `SELECT srm.user_id AS userId, u.username, u.avatar, u.study_room_public AS publicFlag
         FROM study_room_members srm
         JOIN users u ON u.id = srm.user_id
         WHERE srm.room_id = ?
         ORDER BY srm.joined_at ASC`
      )
      .all(room.roomId);

    const members = rows.map((m) => {
      const isSelf = m.userId === me;
      const isOwner = m.userId === room.ownerId;
      const publicData = m.publicFlag === 1;
      // 隐私开关只影响"别人看你"；自己在列表里始终看到自己的真实今日打卡数
      const visible = publicData || isSelf;
      // 统一走缓存取数：每个成员解析 store_json 一次（缓存命中则免解析）
      const stats = getUserStats(m.userId);
      // 所有有学习活动的日期（刷题+复习+首次学习），转成 byDate 格式供 computeStreak 使用
      const activityByDate = {};
      stats.allDates.forEach(d => { if (d <= today) activityByDate[d] = 1; });
      // streak 属基础社交信息（头像/用户名/房主标记/streak 全可见），对所有成员真实返回
      const streak = computeStreak(activityByDate, today);
      // 今日是否打卡属基础社交信息（全可见）；今日具体复习条数属进阶信息（未公开者 null）
      const checkedInToday = !!activityByDate[today];
      let todayReviewCount = null;
      if (visible) {
        todayReviewCount = stats.byDate[today] || 0;
      }
      // 在线状态：从内存心跳表取（60s=在线绿点，60s~5min=离开灰点+"x分钟前"，>5min=离线灰点）
      const online = getOnlineStatus(m.userId);
      // 活跃度分数：今日学习量加权 + 在线加成 + streak小幅加成
      const onlineBonus = online.status === 'online' ? 2 : (online.status === 'away' ? 1 : 0);
      const activityScore = (stats.todayScore || 0) + onlineBonus + streak * 0.1;
      return {
        userId: m.userId,
        username: m.username,
        avatar: m.avatar,
        isOwner,
        isSelf,
        publicData,
        streak,
        todayReviewCount,
        checkedInToday,
        todayScore: stats.todayScore || 0,
        activityScore: Math.round(activityScore * 100) / 100,
        onlineStatus: online.status,   // 'online' | 'away' | 'offline'
        onlineLabel: online.label,      // '刚刚' | 'x 分钟前' | ''
      };
    });

    // 按活跃度降序排序：房主不固定，参与统一排序；同分按 streak 降序，再同按 user_id 升序
    members.sort((a, b) => {
      if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore;
      if (b.streak !== a.streak) return b.streak - a.streak;
      return a.userId - b.userId;
    });
    // 标记今日之星（活跃度第1，且分数>0；全0则无人获此徽章）
    if (members.length > 0 && members[0].activityScore > 0) {
      members[0].isTodayStar = true;
    }

    return ok(res, {
      room: {
        id: room.roomId,
        roomCode: room.roomCode,
        name: room.name,
        isPublic: room.isPublic === 1,
        isOwner: me === room.ownerId,
        intro: room.intro || '',
        category: room.category || 'other',
      },
      members,
    });
  } catch (e) {
    console.error('GET /api/study-room/me error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// POST /api/study-room/create  body: { name, intro?, category? }
router.post('/create', (req, res) => {
  try {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name || name.length > 20) return fail(res, '房间名必填且不超过 20 个字');

    // 简介可选：≤100 字
    let intro = String((req.body && req.body.intro) || '').trim();
    if (intro.length > 100) intro = intro.slice(0, 100);
    // 标签可选：默认 other，枚举校验
    let category = String((req.body && req.body.category) || 'other').trim();
    if (!VALID_CATEGORIES.includes(category)) category = 'other';
    // 是否公开到广场：默认私有(0)，前端创建面板可选
    const isPublic = !!(req.body && req.body.isPublic);

    // 一个用户同时只能在一个房间
    if (myRoomRow(req.user.id)) return fail(res, '你已在某个自习室中，请先退出当前房间');

    const roomCode = generateUniqueRoomCode();
    let roomId;
    const tx = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO study_rooms (room_code, name, owner_id, intro, category, is_public) VALUES (?, ?, ?, ?, ?, ?)')
        .run(roomCode, name, req.user.id, intro, category, isPublic ? 1 : 0);
      roomId = info.lastInsertRowid;
      db.prepare('INSERT INTO study_room_members (room_id, user_id) VALUES (?, ?)').run(roomId, req.user.id);
    });
    tx();

    writeAudit(req.user.id, 'study_room_create', 'study_room', roomId, { roomCode, name, category }, req);
    return ok(res, { room: { id: roomId, roomCode, name, intro, category, isPublic } });
  } catch (e) {
    // 并发/重复创建时 INSERT study_room_members 撞 UNIQUE(user_id)，转友好提示
    if (isUniqueViolation(e)) return fail(res, '你已在某个自习室中，请先退出当前房间');
    console.error('POST /api/study-room/create error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// POST /api/study-room/join  body: { roomCode }
router.post('/join', (req, res) => {
  try {
    const roomCode = String((req.body && req.body.roomCode) || '').trim().toUpperCase();
    if (!ROOM_CODE_RE.test(roomCode)) return fail(res, '房间号格式不对，请输入 6 位房间号');

    if (myRoomRow(req.user.id)) return fail(res, '你已在某个自习室中，请先退出当前房间');

    const room = db.prepare('SELECT id, name FROM study_rooms WHERE room_code = ?').get(roomCode);
    if (!room) return fail(res, '房间号不存在，请检查后重试', 404);

    // 人数上限：SQLite 单写串行化，MVP 阶段竞态可接受
    const { c } = db.prepare('SELECT COUNT(*) AS c FROM study_room_members WHERE room_id = ?').get(room.id);
    if (c >= MAX_ROOM_MEMBERS) return fail(res, '房间人数已满');

    const tx = db.transaction(() => {
      db.prepare('INSERT INTO study_room_members (room_id, user_id) VALUES (?, ?)').run(room.id, req.user.id);
    });
    tx();

    writeAudit(req.user.id, 'study_room_join', 'study_room', room.id, { roomCode }, req);
    return ok(res, { room: { id: room.id, roomCode, name: room.name } });
  } catch (e) {
    // 并发/重复加入时 INSERT study_room_members 撞 UNIQUE(user_id)，转友好提示
    if (isUniqueViolation(e)) return fail(res, '你已在某个自习室中，请先退出当前房间');
    console.error('POST /api/study-room/join error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// POST /api/study-room/leave  body: 无
// 房主退出：有其他成员→转让给最早加入者；无其他成员→物理解散房间（级联删成员）
router.post('/leave', (req, res) => {
  try {
    const me = req.user.id;
    const room = myRoomRow(me);
    if (!room) return fail(res, '你不在任何自习室中');

    let roomDisbanded = false;
    let transferredTo = null;

    const tx = db.transaction(() => {
      // 其他成员（排除自己），按加入时间升序，最早者继承房主
      const others = db
        .prepare(
          `SELECT srm.user_id AS userId, u.username
           FROM study_room_members srm
           JOIN users u ON u.id = srm.user_id
           WHERE srm.room_id = ? AND srm.user_id != ?
           ORDER BY srm.joined_at ASC`
        )
        .all(room.roomId);

      if (me === room.ownerId) {
        if (others.length > 0) {
          db.prepare('UPDATE study_rooms SET owner_id = ? WHERE id = ?').run(others[0].userId, room.roomId);
          transferredTo = others[0].username;
        } else {
          // 只剩房主一人：删房间，ON DELETE CASCADE 清掉成员记录
          db.prepare('DELETE FROM study_rooms WHERE id = ?').run(room.roomId);
          roomDisbanded = true;
        }
      }
      // 无论是否房主，都删自己的成员记录
      db.prepare('DELETE FROM study_room_members WHERE room_id = ? AND user_id = ?').run(room.roomId, me);
    });
    tx();

    writeAudit(req.user.id, 'study_room_leave', 'study_room', room.roomId,
      { transferredTo, roomDisbanded }, req);

    const payload = { leftRoom: true, roomDisbanded };
    if (transferredTo) payload.transferredTo = transferredTo;
    return ok(res, payload);
  } catch (e) {
    console.error('POST /api/study-room/leave error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// DELETE /api/study-room —— 房主解散整个自习室
// 仅房主可调用；事务内删 study_rooms 行（ON DELETE CASCADE 自动清成员），
// 解散后批量失效所有成员的 statsCache，并写审计。
router.delete('/', (req, res) => {
  try {
    const me = req.user.id;
    const room = myRoomRow(me);
    if (!room) return fail(res, '你不在任何自习室中', 400);
    if (me !== room.ownerId) return fail(res, '只有房主可以解散自习室', 403);

    let memberUserIds = [];
    const tx = db.transaction(() => {
      // 先取成员列表：删房间后 CASCADE 会清掉成员行，缓存清理名单必须在此之前拿到
      memberUserIds = db
        .prepare('SELECT user_id AS userId FROM study_room_members WHERE room_id = ?')
        .all(room.roomId)
        .map((r) => r.userId);
      db.prepare('DELETE FROM study_rooms WHERE id = ?').run(room.roomId);
    });
    tx();

    // 缓存按 userId 维度存（与房间无关），解散后逐人失效，避免脏数据残留
    statsCache.invalidateMany(memberUserIds);

    writeAudit(me, 'study_room_disband', 'study_room', room.roomId,
      { memberCount: memberUserIds.length }, req);

    return ok(res, { ok: true, disbanded: true });
  } catch (e) {
    console.error('DELETE /api/study-room error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// GET /api/study-room/member/:userId —— 成员公开学习数据（统计 + 最近学习动态）
// 权限：请求者与目标必须在同一房间；目标未公开则返回 profile:null（不报错）
router.get('/member/:userId', (req, res) => {
  try {
    const me = req.user.id;
    const targetUserId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(targetUserId)) return fail(res, '用户 ID 不合法', 400);

    // 同房间校验：两人的 room_id 都存在且相等
    const myMembership = db.prepare('SELECT room_id FROM study_room_members WHERE user_id = ?').get(me);
    const targetMembership = db.prepare('SELECT room_id FROM study_room_members WHERE user_id = ?').get(targetUserId);
    if (!myMembership || !targetMembership || myMembership.room_id !== targetMembership.room_id) {
      return fail(res, '只能查看同自习室成员的学习数据', 403);
    }

    const target = db
      .prepare('SELECT username, avatar, study_room_public AS publicFlag FROM users WHERE id = ?')
      .get(targetUserId);
    if (!target) return fail(res, '用户不存在', 404);

    // 未公开：不返回任何学习统计数字（前端弹"未公开"提示）；
    // 但自己看自己不受隐私开关限制（自己点自己头像仍能拿到自己的数据）。
    if (target.publicFlag !== 1 && targetUserId !== me) return ok(res, { profile: null });

    // 统计走统一缓存取数；project_count 仍单独取（admin 列表冗余列，不在缓存内）
    const row = db.prepare('SELECT project_count, store_json FROM user_data WHERE user_id = ?').get(targetUserId);
    const stats = getUserStats(targetUserId);
    const { byDate, total } = stats;

    const today = todayStr();
    // 所有有学习活动的日期（刷题+复习+首次学习），口径与 /me 一致
    const allDates = stats.allDates;
    let storeObj = null;
    try { storeObj = row && row.store_json ? JSON.parse(row.store_json) : null; } catch (_) { storeObj = null; }
    const recentDates = [...allDates].filter(d => d <= today).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).slice(0, 3);
    // 所有有学习活动的日期，用于学习天数和 streak 计算
    const allActivityByDate = {};
    allDates.forEach(d => { if (d <= today) allActivityByDate[d] = 1; });
    // 计算每日 breakdown：刷题页数、套数、复习条数
    const recentActivity = recentDates.map(date => {
      const prevDate = shiftDate(date, -1);
      let pages = 0, sets = 0, reviews = 0;
      if (storeObj && storeObj.projects) {
        for (const p of Object.values(storeObj.projects)) {
          if (!p) continue;
          if (p.type === 'exercise') {
            const cur = _getCompletedPagesAtDate(p, date);
            const prev = _getCompletedPagesAtDate(p, prevDate);
            const delta = Math.max(0, cur - prev);
            if (_isSetMode(p)) sets += delta; else pages += delta;
          } else if (p.type === 'mistake' || p.type === 'recite') {
            if (Array.isArray(p.items)) {
              p.items.forEach(it => {
                if (it && Array.isArray(it.reviews)) {
                  it.reviews.forEach(r => { if (r && r.date === date) reviews++; });
                }
              });
            }
          }
        }
      }
      return {
        date,
        dayOfWeek: dayOfWeekCn(date),
        pages: Math.round(pages * 10) / 10,
        sets: Math.round(sets * 10) / 10,
        reviews,
      };
    }).filter(a => a.pages > 0 || a.sets > 0 || a.reviews > 0);

    // 本周复习数：周一→周日 7 个数
    const monday = shiftDate(today, -mondayIndex(today));
    const weekReviewCount = [];
    for (let d = 0; d < 7; d++) {
      const date = shiftDate(monday, d);
      weekReviewCount.push(byDate[date] || 0);
    }
    // 本周学习天数 / 累计学习天数（有刷题或复习记录的天数，口径与 recentActivity 一致）
    let weekStudyDays = 0;
    for (let d = 0; d < 7; d++) {
      if (allActivityByDate[shiftDate(monday, d)]) weekStudyDays++;
    }
    const totalStudyDays = Object.keys(allActivityByDate).length;

    // 当前连续打卡：今天学了从今天算，今天还没学则从昨天往回算（不因今天尚未学清零）
    const currentStreak = computeStreak(allActivityByDate, today);

    // 今日各项目完成量（环形图数据）：只返回今日有完成的项目
    // 隐私：只有公开用户（或自己看自己）才走到这里，未公开已在上面拦截
    const projectToday = collectProjectTodayProgress(row && row.store_json);

    return ok(res, {
      profile: {
        userId: targetUserId,
        username: target.username,
        avatar: target.avatar,
        recentActivity,
        weekReviewCount,
        weekStudyDays,
        totalStudyDays,
        currentStreak,
        totalReviews: total,
        projectCount: (row && row.project_count) || 0,
        projectToday,
      },
    });
  } catch (e) {
    console.error('GET /api/study-room/member/:userId error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// PATCH /api/study-room/privacy  body: { public: boolean }
router.patch('/privacy', (req, res) => {
  try {
    const { public: isPublic } = req.body || {};
    if (typeof isPublic !== 'boolean') return fail(res, 'public 必须是 true/false');
    db.prepare("UPDATE users SET study_room_public = ?, updated_at = datetime('now') WHERE id = ?")
      .run(isPublic ? 1 : 0, req.user.id);
    return ok(res, { public: isPublic });
  } catch (e) {
    console.error('PATCH /api/study-room/privacy error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// POST /api/study-room/kick  body: { userId }
// 仅房主可踢；写审计；被踢者下次轮询 /me 得 room:null 即回引导页。
// 被踢后无冷却，可立即加入别的房（不写入任何状态限制）。
router.post('/kick', (req, res) => {
  try {
    const me = req.user.id;
    const room = myRoomRow(me);
    if (!room) return fail(res, '你不在任何自习室中');
    if (me !== room.ownerId) return fail(res, '只有房主可以踢出成员', 403);

    const targetUserId = parseInt(req.body && req.body.userId, 10);
    if (!Number.isInteger(targetUserId)) return fail(res, '用户 ID 不合法', 400);
    if (targetUserId === me) return fail(res, '不能踢出自己', 400);

    // 目标必须在本房间
    const targetMembership = db
      .prepare('SELECT room_id FROM study_room_members WHERE user_id = ?')
      .get(targetUserId);
    if (!targetMembership || targetMembership.room_id !== room.roomId) {
      return fail(res, '该成员不在房间中', 400);
    }
    // 不能踢房主（房主就是自己，已在上面拦截；这里再兜底一次）
    if (targetUserId === room.ownerId) return fail(res, '不能踢出房主', 400);

    const targetUser = db.prepare('SELECT username FROM users WHERE id = ?').get(targetUserId);
    const kickedUsername = (targetUser && targetUser.username) || null;

    db.prepare('DELETE FROM study_room_members WHERE room_id = ? AND user_id = ?')
      .run(room.roomId, targetUserId);

    writeAudit(me, 'study_room_kick', 'study_room', room.roomId,
      { targetUserId, targetUsername: kickedUsername }, req);

    return ok(res, { ok: true, kickedUserId: targetUserId, kickedUsername });
  } catch (e) {
    console.error('POST /api/study-room/kick error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// PATCH /api/study-room/settings  body: { name?, isPublic?, intro?, category? }
// 仅房主可改房间名、是否公开到广场、简介、标签；至少要提供一项。
router.patch('/settings', (req, res) => {
  try {
    const me = req.user.id;
    const room = myRoomRow(me);
    if (!room) return fail(res, '你不在任何自习室中');
    if (me !== room.ownerId) return fail(res, '只有房主可以修改房间设置', 403);

    const body = req.body || {};
    const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
    const hasPublic = Object.prototype.hasOwnProperty.call(body, 'isPublic');
    const hasIntro = Object.prototype.hasOwnProperty.call(body, 'intro');
    const hasCategory = Object.prototype.hasOwnProperty.call(body, 'category');
    if (!hasName && !hasPublic && !hasIntro && !hasCategory) return fail(res, '没有需要修改的设置', 400);

    const sets = [];
    const params = [];
    const changes = {};
    if (hasName) {
      const name = String(body.name == null ? '' : body.name).trim();
      if (!name || name.length > 20) return fail(res, '房间名必填且长度 1–20 个字', 400);
      sets.push('name = ?');
      params.push(name);
      changes.name = name;
    }
    if (hasPublic) {
      if (typeof body.isPublic !== 'boolean') return fail(res, 'isPublic 必须是 true/false', 400);
      sets.push('is_public = ?');
      params.push(body.isPublic ? 1 : 0);
      changes.isPublic = body.isPublic;
    }
    if (hasIntro) {
      let intro = String(body.intro == null ? '' : body.intro).trim();
      if (intro.length > 100) intro = intro.slice(0, 100);
      sets.push('intro = ?');
      params.push(intro);
      changes.intro = intro;
    }
    if (hasCategory) {
      let category = String(body.category == null ? 'other' : body.category).trim();
      if (!VALID_CATEGORIES.includes(category)) category = 'other';
      sets.push('category = ?');
      params.push(category);
      changes.category = category;
    }
    params.push(room.roomId);
    db.prepare(`UPDATE study_rooms SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    writeAudit(me, 'study_room_settings', 'study_room', room.roomId, { changes }, req);

    // 改了房间信息后失效广场缓存
    _plazaCache = { ts: 0, data: null };

    const updated = db
      .prepare('SELECT room_code AS roomCode, name, is_public AS isPublic, intro, category FROM study_rooms WHERE id = ?')
      .get(room.roomId);
    return ok(res, {
      ok: true,
      room: {
        id: room.roomId,
        roomCode: updated.roomCode,
        name: updated.name,
        isPublic: updated.isPublic === 1,
        intro: updated.intro || '',
        category: updated.category || 'other',
      },
    });
  } catch (e) {
    console.error('PATCH /api/study-room/settings error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// GET /api/study-room/plaza —— 公开自习室广场（只列 is_public=1 的房间，不含私有房）
// 排序：成员数降序优先，其次近 7 天成员打卡总数 active7 降序（热门口径：规模优先，其次活跃热度）。
// 已满房（成员数 >= 上限）标记 isFull，前端置灰「加入」按钮，不可加入。
// 60s 进程内缓存：公开房列表全局共享，key 固定。category 筛选在缓存结果上做内存过滤。
router.get('/plaza', (req, res) => {
  try {
    const now = Date.now();
    // 命中缓存直接返回（缓存的是全量未筛选结果）
    if (_plazaCache.data && (now - _plazaCache.ts) < PLAZA_CACHE_TTL) {
      return _respondPlaza(res, _plazaCache.data, req.query.category);
    }

    const today = todayStr();
    const rooms = db
      .prepare(
        `SELECT sr.id AS roomId, sr.room_code AS roomCode, sr.name,
                sr.owner_id AS ownerId, u.username AS ownerName,
                sr.intro AS intro, sr.category AS category,
                (SELECT COUNT(*) FROM study_room_members m WHERE m.room_id = sr.id) AS memberCount
         FROM study_rooms sr
         JOIN users u ON u.id = sr.owner_id
         WHERE sr.is_public = 1`
      )
      .all();

    // 每房近 7 天成员打卡总数（含今天共 7 天：today-6 … today）
    // 优化：只遍历近 7 天的日期 key，不遍历全部历史 byDate
    const last7Days = [];
    for (let i = 6; i >= 0; i--) last7Days.push(shiftDate(today, -i));
    for (const room of rooms) {
      const members = db
        .prepare('SELECT user_id AS userId FROM study_room_members WHERE room_id = ?')
        .all(room.roomId);
      let active7 = 0;
      for (const mem of members) {
        const stats = getUserStats(mem.userId);
        // 近7天有学习活动的天数（刷题/复习/首次学习都算），比复习条数更能反映活跃度
        for (const d of last7Days) {
          if (stats.allDates.has(d)) active7++;
        }
      }
      room.active7 = active7;
    }

    // 成员数降序 → active7 降序
    rooms.sort(comparePlazaRooms);

    const result = rooms.map((r) => ({
      roomId: r.roomId,
      roomCode: r.roomCode,
      name: r.name,
      ownerName: r.ownerName,
      memberCount: r.memberCount,
      maxMembers: MAX_ROOM_MEMBERS,
      active7: r.active7,
      isFull: r.memberCount >= MAX_ROOM_MEMBERS,
      intro: r.intro || '',
      category: r.category || 'other',
    }));

    // 写入缓存
    _plazaCache = { ts: now, data: result };

    return _respondPlaza(res, result, req.query.category);
  } catch (e) {
    console.error('GET /api/study-room/plaza error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

/**
 * 在全量广场结果上做 category 筛选后返回。
 * category 查询参数为空或 'all' 时返回全部；否则按精确匹配过滤。
 */
function _respondPlaza(res, allRooms, categoryQuery) {
  let rooms = allRooms;
  const cat = String(categoryQuery || '').trim();
  if (cat && cat !== 'all') {
    rooms = allRooms.filter((r) => r.category === cat);
  }
  return ok(res, { ok: true, maxMembers: MAX_ROOM_MEMBERS, rooms });
}

module.exports = router;
