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
 *   byDate { 'YYYY-MM-DD': 当天 review 条数 }
 *   total  全量 review 总条数
 * 口径与前端 renderHeatmap 一致：遍历 projects[].items[].reviews[]，每条 review 计 1。
 */
function collectReviewStats(storeJson) {
  const byDate = {};
  let total = 0;
  let store = null;
  try { store = storeJson ? JSON.parse(storeJson) : null; } catch (_) { store = null; }
  if (!store || typeof store !== 'object') return { byDate, total };
  const projects = store.projects || {};
  for (const p of Object.values(projects)) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.items)) continue;
    for (const it of p.items) {
      if (!it || typeof it !== 'object' || !Array.isArray(it.reviews)) continue;
      for (const r of it.reviews) {
        if (!r || typeof r.date !== 'string' || !r.date) continue;
        byDate[r.date] = (byDate[r.date] || 0) + 1;
        total++;
      }
    }
  }
  return { byDate, total };
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
 * 计算连续打卡 streak：
 *   - 今天有 review → 从今天起算；
 *   - 今天没有 review → 从昨天起算（不因今天尚未学而清零，符合「 streak 是历史连续」口径）；
 *   逐日回退直到遇到无记录日为止。加 3650 天保险上限防异常数据死循环。
 * @param {Object<string,number>} byDate {'YYYY-MM-DD': 当天 review 条数}
 * @param {string} today 当前 UTC+8 日期 'YYYY-MM-DD'
 * @returns {number}
 */
function computeStreak(byDate, today) {
  let streak = 0;
  // 今天学了从今天算，今天还没学则从昨天往回算（不因今天尚未学清零）
  let cursor = (byDate[today] || 0) > 0 ? today : shiftDate(today, -1);
  let guard = 0; // 3650 天保险上限
  while ((byDate[cursor] || 0) > 0 && guard < 3650) {
    streak++;
    cursor = shiftDate(cursor, -1);
    guard++;
  }
  return streak;
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
              sr.owner_id AS ownerId, sr.is_public AS isPublic
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
      // streak 属基础社交信息（头像/用户名/房主标记/streak 全可见），对所有成员真实返回
      const streak = computeStreak(stats.byDate, today);
      // 今日是否打卡属基础社交信息（全可见）；今日具体次数属进阶信息（未公开者 null）
      const checkedInToday = (stats.byDate[today] || 0) > 0;
      let todayReviewCount = null;
      if (visible) {
        todayReviewCount = stats.byDate[today] || 0;
      }
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
      };
    });

    return ok(res, {
      room: {
        id: room.roomId,
        roomCode: room.roomCode,
        name: room.name,
        isPublic: room.isPublic === 1,
        isOwner: me === room.ownerId,
      },
      members,
    });
  } catch (e) {
    console.error('GET /api/study-room/me error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

// POST /api/study-room/create  body: { name }
router.post('/create', (req, res) => {
  try {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name || name.length > 20) return fail(res, '房间名必填且不超过 20 个字');

    // 一个用户同时只能在一个房间
    if (myRoomRow(req.user.id)) return fail(res, '你已在某个自习室中，请先退出当前房间');

    const roomCode = generateUniqueRoomCode();
    let roomId;
    const tx = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO study_rooms (room_code, name, owner_id) VALUES (?, ?, ?)')
        .run(roomCode, name, req.user.id);
      roomId = info.lastInsertRowid;
      db.prepare('INSERT INTO study_room_members (room_id, user_id) VALUES (?, ?)').run(roomId, req.user.id);
    });
    tx();

    writeAudit(req.user.id, 'study_room_create', 'study_room', roomId, { roomCode, name }, req);
    return ok(res, { room: { id: roomId, roomCode, name } });
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
    const row = db.prepare('SELECT project_count FROM user_data WHERE user_id = ?').get(targetUserId);
    const { byDate, total } = getUserStats(targetUserId);

    const today = todayStr();
    // 最近学习动态：最近 3 条有打卡记录的日期（按日期降序，不含今天之后的日期）
    const recentActivity = Object.entries(byDate)
      .filter(([date, count]) => date <= today && count > 0)
      .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
      .slice(0, 3)
      .map(([date, count]) => ({
        date,
        reviewCount: count,
        dayOfWeek: dayOfWeekCn(date),
      }));

    // 本周复习数：周一→周日 7 个数
    const monday = shiftDate(today, -mondayIndex(today));
    const weekReviewCount = [];
    for (let d = 0; d < 7; d++) {
      const date = shiftDate(monday, d);
      weekReviewCount.push(byDate[date] || 0);
    }

    // 当前连续打卡：今天学了从今天算，今天还没学则从昨天往回算（不因今天尚未学清零）
    const currentStreak = computeStreak(byDate, today);

    return ok(res, {
      profile: {
        userId: targetUserId,
        username: target.username,
        avatar: target.avatar,
        recentActivity,
        weekReviewCount,
        currentStreak,
        totalReviews: total,
        projectCount: (row && row.project_count) || 0,
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

// PATCH /api/study-room/settings  body: { name?: string, isPublic?: boolean }
// 仅房主可改房间名与是否公开到广场；至少要提供一项。
router.patch('/settings', (req, res) => {
  try {
    const me = req.user.id;
    const room = myRoomRow(me);
    if (!room) return fail(res, '你不在任何自习室中');
    if (me !== room.ownerId) return fail(res, '只有房主可以修改房间设置', 403);

    const body = req.body || {};
    const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
    const hasPublic = Object.prototype.hasOwnProperty.call(body, 'isPublic');
    if (!hasName && !hasPublic) return fail(res, '没有需要修改的设置', 400);

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
    params.push(room.roomId);
    db.prepare(`UPDATE study_rooms SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    writeAudit(me, 'study_room_settings', 'study_room', room.roomId, { changes }, req);

    const updated = db
      .prepare('SELECT room_code AS roomCode, name, is_public AS isPublic FROM study_rooms WHERE id = ?')
      .get(room.roomId);
    return ok(res, {
      ok: true,
      room: {
        id: room.roomId,
        roomCode: updated.roomCode,
        name: updated.name,
        isPublic: updated.isPublic === 1,
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
router.get('/plaza', (req, res) => {
  try {
    const today = todayStr();
    const rooms = db
      .prepare(
        `SELECT sr.id AS roomId, sr.room_code AS roomCode, sr.name,
                sr.owner_id AS ownerId, u.username AS ownerName,
                (SELECT COUNT(*) FROM study_room_members m WHERE m.room_id = sr.id) AS memberCount
         FROM study_rooms sr
         JOIN users u ON u.id = sr.owner_id
         WHERE sr.is_public = 1`
      )
      .all();

    // 每房近 7 天成员打卡总数（含今天共 7 天：today-6 … today）
    const start = shiftDate(today, -6);
    for (const room of rooms) {
      const members = db
        .prepare('SELECT user_id AS userId FROM study_room_members WHERE room_id = ?')
        .all(room.roomId);
      let active7 = 0;
      for (const mem of members) {
        const stats = getUserStats(mem.userId);
        for (const [date, count] of Object.entries(stats.byDate)) {
          if (date >= start && date <= today) active7 += count;
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
    }));

    return ok(res, { ok: true, maxMembers: MAX_ROOM_MEMBERS, rooms: result });
  } catch (e) {
    console.error('GET /api/study-room/plaza error:', e.message);
    return fail(res, '服务器开小差了，请稍后重试', 500);
  }
});

module.exports = router;
