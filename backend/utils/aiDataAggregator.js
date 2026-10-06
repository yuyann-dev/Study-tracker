/**
 * utils/aiDataAggregator.js — AI 数据聚合（PRD §7）
 *
 * 铁律：绝不把全量 store 丢给大模型。按意图精准读取 user_data.store_json，
 * 聚合出紧凑小 JSON。所有数字只留 1 位小数、items content 截 40 字、
 * reviews 只统计分布不逐条列。
 *
 * 项目数据模型（PRD §0.3，字段缺失一律降级缺省，不报错）：
 *   project = { id, name, type:'exercise'|'recite'|'mistake',
 *     total, deadline:'YYYY-MM-DD', bookStartPage, bookEndPage, dailyCapacity,
 *     records:[{date,startPage,endPage,rid,score?,sections?}],
 *     items:[{id,content,learnedDate,reviews:[{date,result}],stage,mastered,
 *             errTags:[],note,pageStart,pageEnd,wrongStreak,setNo,manualMastered,
 *             questionType?,examYear?}],
 *     units:[{name,startPage,endPage,children}], intervals:[...],
 *     subjectKey?, minutesPerUnit?, targetScoreTier? }
 */
const db = require('../database');

const DEFAULT_EXAM_ANCHOR = '2026-12-19';

// ── 通用小工具 ──────────────────────────────────────────────────────────────

/** 数字保留 1 位小数（非数字返回 0） */
function r1(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

/** 字符串截 40 字 */
function cut40(s) {
  const t = String(s == null ? '' : s).trim();
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
}

/** 今天 'YYYY-MM-DD'（本地时区） */
function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 'YYYY-MM-DD' → 毫秒时间戳（解析失败返回 NaN） */
function parseDay(s) {
  if (!s) return NaN;
  const t = Date.parse(String(s).slice(0, 10));
  return t;
}

/** 两个 'YYYY-MM-DD' 相差天数（b - a，向下取整） */
function dayDiff(a, b) {
  const da = parseDay(a);
  const db2 = parseDay(b);
  if (Number.isNaN(da) || Number.isNaN(db2)) return null;
  return Math.round((db2 - da) / 86400000);
}

/** 读取并解析某用户的 store（失败返回 {}） */
function loadStore(userId) {
  try {
    const row = db.prepare('SELECT store_json FROM user_data WHERE user_id = ?').get(userId);
    if (!row || !row.store_json) return {};
    return JSON.parse(row.store_json) || {};
  } catch (_) {
    return {};
  }
}

/** 项目列表（数组），按 updatedAt 倒序，自动过滤已归档项目 */
function projectList(store) {
  const ps = (store && store.projects) || {};
  return Object.values(ps)
    .filter((p) => p && !p.archived)
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
}

/** 按 id 取项目 */
function findProject(store, projectId) {
  const ps = (store && store.projects) || {};
  return ps[projectId] || null;
}

// ── 各类型进度计算 ──────────────────────────────────────────────────────────

/**
 * 刷题(exercise)已完成页数：把每条 record 的 [startPage,endPage] 裁剪进
 * [bookStartPage,bookEndPage] 区间后累加（对齐前端 mergeRanges/clipped 口径的简化版）。
 */
function exerciseDonePages(p) {
  const recs = Array.isArray(p.records) ? p.records : [];
  const bStart = Number(p.bookStartPage) || 0;
  const bEnd = Number(p.bookEndPage) || Number(p.total) || 0;
  if (bEnd <= bStart) return 0;
  let done = 0;
  for (const r of recs) {
    const s = Math.max(Number(r.startPage) || bStart, bStart);
    const e = Math.min(Number(r.endPage) || s, bEnd);
    if (e > s) done += (e - s);
  }
  return done;
}

/** 近 N 天某项目产出量（页数 / 条数） */
function recentOutput(p, days) {
  const recs = Array.isArray(p.records) ? p.records : [];
  const cutoff = Date.now() - days * 86400000;
  let out = 0;
  for (const r of recs) {
    const t = parseDay(r.date);
    if (Number.isNaN(t) || t < cutoff) continue;
    if (p.type === 'exercise') {
      const s = Number(r.startPage) || 0;
      const e = Number(r.endPage) || s;
      out += (e - s);
    } else {
      out += 1; // recite/mistake 按打卡条数计
    }
  }
  return out;
}

/** 背书 item 的下次复习日期（近似：learnedDate 后累加已用间隔档） */
function nextReviewDay(item, intervals) {
  const iv = Array.isArray(intervals) && intervals.length ? intervals : [1, 2, 4, 7, 15, 30];
  const learned = parseDay(item.learnedDate);
  if (Number.isNaN(learned)) return null;
  const n = Array.isArray(item.reviews) ? item.reviews.length : 0;
  let add = 0;
  for (let i = 0; i < n; i++) add += Number(iv[i % iv.length]) || 0;
  return new Date(learned + add * 86400000).toISOString().slice(0, 10);
}

/** 汇总单项目进度（通用） */
function projectStats(p) {
  const today = todayStr();
  const type = p.type || 'exercise';
  const deadline = p.deadline || DEFAULT_EXAM_ANCHOR;
  const daysLeft = dayDiff(today, deadline);
  const s = {
    id: p.id,
    name: p.name || '(未命名)',
    type,
    subjectKey: p.subjectKey || null,
    deadline,
    daysLeft: daysLeft == null ? null : r1(daysLeft),
    dailyCapacity: Number(p.dailyCapacity) || 0,
    minutesPerUnit: Number(p.minutesPerUnit) || 0,
    targetScoreTier: p.targetScoreTier || null,
  };

  if (type === 'exercise') {
    const bStart = Number(p.bookStartPage) || 0;
    const bEnd = Number(p.bookEndPage) || Number(p.total) || 0;
    const total = Math.max(bEnd - bStart, 0);
    const done = Math.min(exerciseDonePages(p), total);
    s.total = r1(total);
    s.done = r1(done);
    s.completionRate = total > 0 ? r1((done / total) * 100) : 0;
    s.recent7Rate = r1(recentOutput(p, 7) / 7);
    const remain = Math.max(total - done, 0);
    s.requiredRate = (daysLeft && daysLeft > 0) ? r1(remain / daysLeft) : 0;
    s.gap = s.requiredRate > 0 ? r1((s.recent7Rate - s.requiredRate) / s.requiredRate * 100) : 0;
  } else if (type === 'recite') {
    const items = Array.isArray(p.items) ? p.items : [];
    const total = items.length;
    const mastered = items.filter((it) => it.mastered || it.manualMastered).length;
    let due = 0;       // 今日到期（含逾期）
    let backlog = 0;   // 已逾期（nextReview < today 且未掌握）
    for (const it of items) {
      if (it.mastered || it.manualMastered) continue;
      const nd = nextReviewDay(it, p.intervals);
      if (!nd) continue;
      if (nd <= today) { due++; if (nd < today) backlog++; }
    }
    const highRisk = items.filter((it) => {
      const rv = Array.isArray(it.reviews) ? it.reviews : [];
      if (!rv.length) return false;
      const last = rv[rv.length - 1];
      return ['forget', '忘记', '模糊', 'hard'].includes(String(last.result));
    }).length;
    s.totalItems = total;
    s.mastered = mastered;
    s.masteryRate = total > 0 ? r1(mastered / total * 100) : 0;
    s.dueToday = due;
    s.backlog = backlog;
    s.highRisk = highRisk;
  } else if (type === 'mistake') {
    const items = Array.isArray(p.items) ? p.items : [];
    const tags = {};
    let streaky = 0;
    for (const it of items) {
      for (const t of Array.isArray(it.errTags) ? it.errTags : []) {
        tags[t] = (tags[t] || 0) + 1;
      }
      if ((Number(it.wrongStreak) || 0) >= 2) streaky++;
    }
    s.totalItems = items.length;
    s.streakyCount = streaky;
    s.errTagDist = tags;
  }
  return s;
}

// ── 对外聚合函数 ────────────────────────────────────────────────────────────

/**
 * 全项目概览（用于首次画像）：科目、类型、完成率、deadline、近7天速率。
 */
function getUserProfileSummary(userId) {
  const store = loadStore(userId);
  const list = projectList(store).map(projectStats);
  const byType = { exercise: 0, recite: 0, mistake: 0 };
  for (const s of list) byType[s.type] = (byType[s.type] || 0) + 1;
  return {
    examAnchor: DEFAULT_EXAM_ANCHOR,
    daysLeft: dayDiff(todayStr(), DEFAULT_EXAM_ANCHOR),
    projectCount: list.length,
    byType,
    subjects: [...new Set(list.map((s) => s.subjectKey).filter(Boolean))],
    projects: list,
  };
}

/**
 * 单项目进度：完成率、日均速率、距 deadline 缺口、今日到期复习数。
 */
function getProgressSummary(userId, projectId) {
  const store = loadStore(userId);
  const p = findProject(store, projectId);
  if (!p) return { found: false };
  const s = projectStats(p);
  s.found = true;
  // exercise 额外给缺口判断
  if (s.type === 'exercise') {
    s.status = s.gap < -20 ? '落后' : s.gap > 30 ? '超前' : '正常';
  }
  return s;
}

/**
 * 错题诊断数据：errTags 分布、按章节/题型/语义三维聚类、wrongStreak、
 * 伪掌握检测、跨年顽固检测。
 */
function getMistakeReport(userId, projectIdOrIds) {
  const store = loadStore(userId);
  let p;
  if (Array.isArray(projectIdOrIds) && projectIdOrIds.length) {
    // 多选视角：仅汇总用户勾选的错题本
    const selected = projectIdOrIds
      .map((id) => findProject(store, id))
      .filter((x) => x && x.type === 'mistake');
    if (!selected.length) return { found: false, reason: '所选项目中没有错题本' };
    p = {
      name: '多选错题',
      type: 'mistake',
      items: selected.flatMap((x) => Array.isArray(x.items) ? x.items : []),
      units: selected.flatMap((x) => Array.isArray(x.units) ? x.units : []),
      intervals: selected[0].intervals || null,
    };
  } else if (projectIdOrIds) {
    p = findProject(store, projectIdOrIds);
    if (!p || p.type !== 'mistake') return { found: false, reason: '不是错题项目或项目不存在' };
  } else {
    // 全局视角：聚合所有错题项目
    const allMistake = projectList(store).filter((x) => x.type === 'mistake');
    if (!allMistake.length) return { found: false, reason: '暂无错题项目' };
    p = {
      name: '全部错题',
      type: 'mistake',
      items: allMistake.flatMap((x) => Array.isArray(x.items) ? x.items : []),
      units: allMistake.flatMap((x) => Array.isArray(x.units) ? x.units : []),
      intervals: allMistake[0].intervals || null,
    };
  }

  const items = Array.isArray(p.items) ? p.items : [];
  const units = Array.isArray(p.units) ? p.units : [];

  // errTags 分布
  const errTagDist = {};
  for (const it of items) {
    for (const t of Array.isArray(it.errTags) ? it.errTags : []) {
      errTagDist[t] = (errTagDist[t] || 0) + 1;
    }
  }

  // 章节聚类：按 pageStart 映射到 units 叶子章
  const unitClusters = {};
  function walkUnits(nodes) {
    const out = {};
    for (const u of nodes || []) {
      out[u.name] = u;
      if (Array.isArray(u.children)) Object.assign(out, walkUnits(u.children));
    }
    return out;
  }
  const leafByName = walkUnits(units);
  const unitRanges = units.map((u) => ({ name: u.name, s: Number(u.startPage) || 0, e: Number(u.endPage) || 0 }));

  // 题型聚类（questionType）
  const typeClusters = {};
  // 语义聚类：content 关键词（简单取前 6 字做桶）
  const semanticClusters = {};

  const streaky = [];
  const pseudoMastered = [];
  const crossYear = [];
  const thisYear = new Date().getFullYear();

  for (const it of items) {
    // 章节
    const ps = Number(it.pageStart) || 0;
    let unitName = '未分类';
    for (const ur of unitRanges) {
      if (ps >= ur.s && ps <= ur.e) { unitName = ur.name; break; }
    }
    (unitClusters[unitName] = unitClusters[unitName] || []).push(it);

    // 题型
    const qt = it.questionType || '未标注';
    typeClusters[qt] = (typeClusters[qt] || 0) + 1;

    // 语义（按 content 前 8 字）
    const key = cut40(it.content).slice(0, 8);
    semanticClusters[key] = (semanticClusters[key] || 0) + 1;

    // wrongStreak 高危清单
    if ((Number(it.wrongStreak) || 0) >= 2) {
      streaky.push({ content: cut40(it.content), wrongStreak: it.wrongStreak, unit: unitName });
    }
    // 伪掌握：manualMastered 且后续 reviews 仍有忘记
    if (it.manualMastered) {
      const rvForget = (Array.isArray(it.reviews) ? it.reviews : [])
        .some((r) => ['forget', '忘记', '模糊'].includes(String(r.result)));
      if (rvForget) pseudoMastered.push({ content: cut40(it.content) });
    }
    // 跨年顽固：learnedDate 年份早于今年且仍在错
    if (it.learnedDate) {
      const y = new Date(parseDay(it.learnedDate)).getFullYear();
      if (Number.isFinite(y) && y < thisYear && (Number(it.wrongStreak) || 0) >= 1) {
        crossYear.push({ content: cut40(it.content), learnedYear: y, unit: unitName });
      }
    }
  }

  // 章节聚类汇总（每章错题数、高危数）
  const unitSummary = Object.keys(unitClusters).map((name) => {
    const arr = unitClusters[name];
    return {
      unit: name,
      count: arr.length,
      streaky: arr.filter((it) => (Number(it.wrongStreak) || 0) >= 2).length,
    };
  }).sort((a, b) => b.count - a.count);

  streaky.sort((a, b) => b.wrongStreak - a.wrongStreak);

  return {
    found: true,
    total: items.length,
    errTagDist,
    byUnit: unitSummary,
    byQuestionType: typeClusters,
    semanticTop: Object.entries(semanticClusters).sort((a, b) => b[1] - a[1]).slice(0, 10),
    streakyTop: streaky.slice(0, 10),
    pseudoMastered,
    crossYear: crossYear.slice(0, 10),
  };
}

/**
 * 套卷趋势：逐套 score、各 section 用时与正确率。
 * 现有 records 可能没有 score/sections 字段，缺省时返回空并提示。
 */
function getPaperTrend(userId, projectId) {
  const store = loadStore(userId);
  const p = findProject(store, projectId);
  if (!p) return { found: false };
  const recs = Array.isArray(p.records) ? p.records : [];
  const points = recs
    .filter((r) => r.date)
    .map((r, i) => ({
      seq: i + 1,
      date: r.date,
      score: Number(r.score) || null,
      sections: Array.isArray(r.sections) ? r.sections.map((s) => ({
        name: s.name, score: Number(s.score) || null, timeMin: Number(s.timeSpentMin) || null,
      })) : [],
    }));
  const hasScore = points.some((pt) => pt.score != null);
  return {
    found: true,
    projectName: p.name,
    hasScore,
    points,
    hint: hasScore ? '' : '该项目记录尚未录入 score / sections 字段，暂无法输出套卷趋势。',
  };
}

/**
 * 背书状态：今日到期数、高危条目、积压情况、掌握率。
 */
function getReciteStatus(userId, projectIdOrIds) {
  const store = loadStore(userId);
  let p;
  if (Array.isArray(projectIdOrIds) && projectIdOrIds.length) {
    // 多选视角：仅汇总用户勾选的背书本
    const selected = projectIdOrIds
      .map((id) => findProject(store, id))
      .filter((x) => x && x.type === 'recite');
    if (!selected.length) return { found: false, reason: '所选项目中没有背书本' };
    p = {
      name: '多选背书',
      type: 'recite',
      items: selected.flatMap((x) => Array.isArray(x.items) ? x.items : []),
      intervals: selected[0].intervals || null,
    };
  } else if (projectIdOrIds) {
    p = findProject(store, projectIdOrIds);
    if (!p || p.type !== 'recite') return { found: false, reason: '不是背书项目或项目不存在' };
  } else {
    const allRecite = projectList(store).filter((x) => x.type === 'recite');
    if (!allRecite.length) return { found: false, reason: '暂无背书项目' };
    p = {
      name: '全部背书',
      type: 'recite',
      items: allRecite.flatMap((x) => Array.isArray(x.items) ? x.items : []),
      intervals: allRecite[0].intervals || null,
    };
  }
  const items = Array.isArray(p.items) ? p.items : [];
  const today = todayStr();
  let dueToday = 0;
  let backlog = 0; // 已逾期（nextReview < today 且未掌握）
  let mastered = 0;
  const highRisk = [];
  for (const it of items) {
    const isMastered = it.mastered || it.manualMastered;
    if (isMastered) { mastered++; continue; }
    const nd = nextReviewDay(it, p.intervals);
    if (!nd) continue;
    if (nd <= today) {
      dueToday++;
      if (nd < today) backlog++;
      const rv = Array.isArray(it.reviews) ? it.reviews : [];
      const last = rv[rv.length - 1];
      if (last && ['forget', '忘记', '模糊'].includes(String(last.result))) {
        highRisk.push({ content: cut40(it.content), nextDay: nd });
      }
    }
  }
  return {
    found: true,
    total: items.length,
    mastered,
    masteryRate: items.length ? r1(mastered / items.length * 100) : 0,
    dueToday,
    backlog,
    highRisk: highRisk.slice(0, 10),
  };
}

/**
 * 多科目平衡：全部项目（exercise + recite + mistake）统一算"紧迫度"，
 * 落后的排前面，回答"先救谁"。
 *  - exercise：requiredRate vs recent7Rate，gap< -20 视为落后
 *  - recite：掌握率 + 今日到期/逾期积压，有到期/积压视为落后
 *  - mistake：高危重错(streaky)数，>=3 视为落后
 */
function getMultiSubjectBalance(userId) {
  const store = loadStore(userId);
  const list = projectList(store).map(projectStats);

  const rows = list.map((s) => {
    if (s.type === 'exercise') {
      const status = s.gap < -20 ? '落后' : s.gap > 30 ? '超前' : '正常';
      return {
        id: s.id, name: s.name, subjectKey: s.subjectKey, type: s.type,
        requiredRate: s.requiredRate, actualRate: s.recent7Rate, gap: s.gap,
        status, urgency: s.gap < 0 ? -s.gap : 0,
      };
    }
    if (s.type === 'recite') {
      const backlog = s.backlog || 0;
      const due = s.dueToday || 0;
      const behind = due > 0 || backlog > 0;
      return {
        id: s.id, name: s.name, subjectKey: s.subjectKey, type: s.type,
        masteryRate: s.masteryRate, dueToday: due, backlog,
        status: behind ? '落后' : '正常',
        urgency: backlog * 2 + due, // 逾期权重更高
      };
    }
    // mistake
    const streaky = s.streakyCount || 0;
    return {
      id: s.id, name: s.name, subjectKey: s.subjectKey, type: s.type,
      totalItems: s.totalItems, streakyCount: streaky,
      status: streaky >= 3 ? '落后' : '正常',
      urgency: streaky * 2,
    };
  });

  // 紧迫度高（越该先救）排前面
  rows.sort((a, b) => b.urgency - a.urgency);
  return {
    today: todayStr(),
    rows,
    behind: rows.filter((r) => r.status === '落后').map((r) => r.name),
    ahead: rows.filter((r) => r.status === '超前').map((r) => r.name),
  };
}

/**
 * 今日计划：基于时间预算 budgetMin 的全局调度，各科分配（此消彼长，总和=预算）。
 */
function getTodayPlan(userId, budgetMin) {
  const store = loadStore(userId);
  // budgetMin 为 0 / 空 / 非法时，按"全天"上限 720 分钟（12 小时），不再静默回退 240
  const n = Number(budgetMin);
  const budget = Number.isFinite(n) && n > 0 ? Math.min(n, 720) : 720;
  const list = projectList(store).map(projectStats);

  // 收集需要安排的项：落后的刷题 + 到期背书 + 高危错题
  const blocks = [];
  for (const s of list) {
    const mpu = s.minutesPerUnit || (s.type === 'exercise' ? 7 : s.type === 'recite' ? 3 : 5);
    if (s.type === 'exercise' && s.gap < -20) {
      blocks.push({ projectId: s.id, name: s.name, kind: 'exercise', minutesPerUnit: mpu, gap: s.gap, priority: 'P0' });
    } else if (s.type === 'recite' && s.dueToday > 0) {
      blocks.push({ projectId: s.id, name: s.name, kind: 'recite', units: s.dueToday, minutesPerUnit: mpu, gap: -10, priority: s.backlog > 5 ? 'P0' : 'P1' });
    } else if (s.type === 'mistake' && s.streakyCount > 0) {
      blocks.push({ projectId: s.id, name: s.name, kind: 'mistake', units: Math.min(s.streakyCount, 5), minutesPerUnit: mpu, gap: -5, priority: 'P1' });
    }
  }
  // ROI：gap 越小（越落后）越优先
  blocks.sort((a, b) => a.gap - b.gap);

  // 在预算内做时间守恒分配
  let used = 0;
  const plan = [];
  for (const b of blocks) {
    if (used >= budget) { b.priority = 'P2'; b.estMin = 0; continue; }
    let estMin;
    if (b.kind === 'exercise') estMin = Math.round(b.minutesPerUnit * (b.gap < -40 ? 8 : 4));
    else estMin = Math.round((b.units || 3) * b.minutesPerUnit);
    if (used + estMin > budget) estMin = Math.max(budget - used, 0);
    b.estMin = estMin;
    used += estMin;
    plan.push(b);
  }
  return { budgetMin: budget, allocatedMin: used, plan };
}

// ── Function Calling 新增只读 helper（§3.13）────────────────────────────────

/**
 * 本地时区格式化"今天偏移 offset 天"的日期（offset=0 即今天）。
 * 与 todayStr() 同口径，避免 UTC/本地跨日导致按天聚合错位。
 */
function offsetDateStr(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 近 N 天学习量趋势（§3.5）。
 * 遍历所有未归档项目 records，按 date 聚合：exercise 累加 endPage-startPage 页数，
 * recite/mistake 每条 record 记 1 次打卡；补齐最近 N 天每天的键（无记录为 0）。
 * @param {number} [days=7] 回看天数，调用方已夹在 1~30
 */
function getWeeklyStats(userId, days) {
  const store = loadStore(userId);
  let n = Number(days);
  if (!Number.isFinite(n) || n <= 0) n = 7;
  n = Math.min(Math.floor(n), 30);

  // 按 date 聚合原始 records
  const byDate = {};
  for (const p of projectList(store)) {
    const recs = Array.isArray(p.records) ? p.records : [];
    for (const r of recs) {
      const d = String(r.date || '').slice(0, 10);
      if (!d) continue;
      if (!byDate[d]) byDate[d] = { exercisePages: 0, reciteCheckins: 0, mistakeCheckins: 0 };
      if (p.type === 'exercise') {
        const s = Number(r.startPage) || 0;
        const e = Number(r.endPage) || s;
        byDate[d].exercisePages += Math.max(e - s, 0);
      } else if (p.type === 'recite') {
        byDate[d].reciteCheckins += 1;
      } else if (p.type === 'mistake') {
        byDate[d].mistakeCheckins += 1;
      }
    }
  }

  // 补齐最近 n 天（含今天），无记录补 0
  const totals = { exercisePages: 0, reciteCheckins: 0, mistakeCheckins: 0 };
  const daysArr = [];
  for (let i = n - 1; i >= 0; i--) {
    const ds = offsetDateStr(-i);
    const cell = byDate[ds] || { exercisePages: 0, reciteCheckins: 0, mistakeCheckins: 0 };
    totals.exercisePages += cell.exercisePages;
    totals.reciteCheckins += cell.reciteCheckins;
    totals.mistakeCheckins += cell.mistakeCheckins;
    daysArr.push({
      date: ds,
      exercisePages: r1(cell.exercisePages),
      reciteCheckins: cell.reciteCheckins,
      mistakeCheckins: cell.mistakeCheckins,
    });
  }
  return { days: daysArr, totals };
}

/**
 * 近期打卡/学习记录明细（§3.10），最新在前。
 * 收集 records，每条补 projectName/projectType/detail：
 *   exercise → `P${startPage}-P${endPage}`；recite/mistake → "打卡"。
 * @param {string} [projectId] 不传则汇总所有未归档项目
 * @param {number} [limit=10] 调用方已夹在 1~30
 */
function getRecentRecords(userId, projectId, limit) {
  const store = loadStore(userId);
  let n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) n = 10;
  n = Math.min(Math.floor(n), 30);

  let projects;
  if (projectId) {
    const p = findProject(store, projectId);
    projects = p ? [p] : [];
  } else {
    projects = projectList(store);
  }

  const records = [];
  for (const p of projects) {
    const recs = Array.isArray(p.records) ? p.records : [];
    for (const r of recs) {
      if (!r.date) continue;
      let detail;
      if (p.type === 'exercise') {
        const sp = Number(r.startPage) || 0;
        const ep = Number(r.endPage) || sp;
        detail = `P${sp}-P${ep}`;
      } else {
        detail = '打卡';
      }
      records.push({
        date: String(r.date).slice(0, 10),
        projectName: p.name || '(未命名)',
        projectType: p.type,
        detail,
      });
    }
  }
  // 按日期倒序（同日保持原顺序，稳定排序）
  records.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { records: records.slice(0, n) };
}

/**
 * 结构化排期建议（§3.11）：今日分配 + 各项目按当前速率的完成时间投影。纯查询，不写库。
 * - exercise：daysToFinish = remain / recent7Rate（rate≤0 给 null 并标注"近7天无产出"）
 * - recite：给 masteryRate / backlog 消化天数估计
 * - overallVerdict：后端按规则拼好中文短句，不让模型自己编数字
 */
function generateSchedule(userId, budgetMin) {
  const todayPlan = getTodayPlan(userId, budgetMin);
  const store = loadStore(userId);
  const list = projectList(store).map(projectStats);

  const projection = [];
  let worstBehind = null; // { name, over } over=预计超期天数

  for (const s of list) {
    if (s.type === 'exercise') {
      const remain = Math.max((s.total || 0) - (s.done || 0), 0);
      const rate = s.recent7Rate || 0;
      let daysToFinish = null;
      if (rate > 0) daysToFinish = Math.round(remain / rate);
      const status = s.gap < -20 ? '落后' : s.gap > 30 ? '超前' : '正常';
      projection.push({
        projectId: s.id, name: s.name, type: 'exercise',
        remainingPages: r1(remain), requiredRate: s.requiredRate, actualRate: s.recent7Rate,
        daysToFinishAtCurrentPace: daysToFinish,
        paceNote: rate > 0 ? null : '近7天无产出',
        deadlineGap: status,
      });
      // 记录预计超期最严重的项目，用于 overallVerdict
      if (status === '落后' && Number.isFinite(s.daysLeft) && daysToFinish != null) {
        const over = daysToFinish - s.daysLeft;
        if (over > 0 && (!worstBehind || over > worstBehind.over)) {
          worstBehind = { name: s.name, over };
        }
      }
    } else if (s.type === 'recite') {
      projection.push({
        projectId: s.id, name: s.name, type: 'recite',
        totalItems: s.totalItems, masteryRate: s.masteryRate,
        dueToday: s.dueToday, backlog: s.backlog,
        deadlineGap: (s.dueToday > 0 || s.backlog > 0) ? '落后' : '正常',
      });
    } else {
      projection.push({
        projectId: s.id, name: s.name, type: 'mistake',
        totalItems: s.totalItems, streakyCount: s.streakyCount,
        deadlineGap: (s.streakyCount || 0) >= 3 ? '落后' : '正常',
      });
    }
  }

  let overallVerdict;
  if (worstBehind) {
    overallVerdict = `按当前速率，${worstBehind.name}将比截止日晚约 ${worstBehind.over} 天完成，需要提速或调整目标。`;
  } else {
    overallVerdict = '按当前速率，各项目基本能在截止日前完成，保持现在的节奏即可。';
  }

  return { today: todayPlan, projection, overallVerdict };
}

/**
 * 未来 N 天复习压力预测（§3.12）。
 * 遍历 recite/mistake 项目未掌握 items，复用 nextReviewDay(item, intervals) 算下次复习日，
 * 按日聚合 dueRecite/dueMistake；逾期(nd<今天)的条目归到今天。
 * 与各项目 dailyComfort 之和对比，标 overComfort（当天总量超过舒适量之和）。
 * @param {number} [days=7] 预测天数，调用方已夹在 1~21
 */
function getReviewForecast(userId, days) {
  const store = loadStore(userId);
  let n = Number(days);
  if (!Number.isFinite(n) || n <= 0) n = 7;
  n = Math.min(Math.floor(n), 21);

  const today = todayStr();
  const projects = projectList(store).filter((p) => p.type === 'recite' || p.type === 'mistake');

  // 按日聚合（key=YYYY-MM-DD）
  const byDate = {};
  function ensureDay(ds) {
    if (!byDate[ds]) byDate[ds] = { dueRecite: 0, dueMistake: 0 };
    return byDate[ds];
  }

  let comfortTotal = 0;
  for (const p of projects) {
    comfortTotal += Number(p.dailyComfort) || 20;
    const items = Array.isArray(p.items) ? p.items : [];
    for (const it of items) {
      if (it.mastered || it.manualMastered) continue;
      const nd = nextReviewDay(it, p.intervals);
      if (!nd) continue;
      // 已逾期的条目归到今天，体现积压压力
      const bucketDate = parseDay(nd) < parseDay(today) ? today : nd;
      const cell = ensureDay(bucketDate);
      if (p.type === 'recite') cell.dueRecite += 1;
      else cell.dueMistake += 1;
    }
  }

  // 生成 [today, today+n-1] 的天槽
  const dayList = [];
  let peakDate = null;
  let peakLoad = -1;
  for (let i = 0; i < n; i++) {
    const ds = offsetDateStr(i);
    const cell = byDate[ds] || { dueRecite: 0, dueMistake: 0 };
    const total = cell.dueRecite + cell.dueMistake;
    dayList.push({
      date: ds,
      dueRecite: cell.dueRecite,
      dueMistake: cell.dueMistake,
      overComfort: comfortTotal > 0 && total > comfortTotal,
    });
    if (total > peakLoad) { peakLoad = total; peakDate = ds; }
  }

  return { days: dayList, peakDate, peakLoad: Math.max(peakLoad, 0) };
}

module.exports = (function () {
  // 防御：任一聚合函数内部出错都不允许把 chat 流水线打崩，返回安全空结果。
  function safe(fn, fallback) {
    return function () {
      try {
        return fn.apply(null, arguments);
      } catch (e) {
        console.error('[aiDataAggregator]', fn.name || 'agg', 'failed:', e.message);
        return typeof fallback === 'function' ? fallback() : fallback;
      }
    };
  }
  return {
    getUserProfileSummary: safe(getUserProfileSummary, () => ({ projectCount: 0, projects: [] })),
    getProgressSummary: safe(getProgressSummary, () => ({ found: false })),
    getMistakeReport: safe(getMistakeReport, () => ({ found: false })),
    getPaperTrend: safe(getPaperTrend, () => ({ found: false })),
    getReciteStatus: safe(getReciteStatus, () => ({ found: false })),
    getMultiSubjectBalance: safe(getMultiSubjectBalance, () => ({ rows: [], behind: [], ahead: [] })),
    getTodayPlan: safe(getTodayPlan, () => ({ budgetMin: 240, allocatedMin: 0, plan: [] })),
    // Function Calling 新增只读 helper
    getWeeklyStats: safe(getWeeklyStats, () => ({ days: [], totals: { exercisePages: 0, reciteCheckins: 0, mistakeCheckins: 0 } })),
    getRecentRecords: safe(getRecentRecords, () => ({ records: [] })),
    generateSchedule: safe(generateSchedule, () => ({ today: { budgetMin: 240, allocatedMin: 0, plan: [] }, projection: [], overallVerdict: '' })),
    getReviewForecast: safe(getReviewForecast, () => ({ days: [], peakDate: null, peakLoad: 0 })),
    // 导出供路由复用
    loadStore, findProject, projectStats, r1, cut40, todayStr, DEFAULT_EXAM_ANCHOR,
  };
})();
