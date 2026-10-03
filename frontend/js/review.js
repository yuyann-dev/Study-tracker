/* Study Tracker — 复习算法、排期引擎、评价、掌握度、教练文案 */
/* 自动从 app.js 拆分，对应原文件 L1498-5130 */

import { $, DEFAULT_INTERVALS, addDays, diffDays, fmtCN, todayStr } from './utils.js';
import { cur, saveStore, store } from './storage.js';
import { render } from './render.js';
import { countRanges, editingProjectId, getBookDoneRanges, getTargetPageRanges, getTodayReviewedCount, modalTop, unlockBodyScroll } from './ui.js';

/* ============ 回车自动跳转下一个输入框（统一表单键盘流） ============
 * 在文本/数字/日期等输入框按 Enter，自动聚焦到容器内下一个"当前可见且可填"的框；
 * 在最后一个框按 Enter 触发该表单提交。桌面 Enter 与移动端虚拟键盘"下一步/完成"均生效。
 * 字段在每次按键时实时计算，自动适配各模式下输入框的显示/隐藏。 */
export function _navFieldVisible(el) {
  if (!el || el.disabled || el.readOnly) return false;
  const t = ((el.type || el.tagName || '') + '').toLowerCase();
  if (['hidden','checkbox','radio','button','submit','reset','file','range','color','image'].includes(t)) return false;
  if (el.hidden) return false;
  let node = el;
  while (node && node !== document.body) {
    if (node.hidden) return false;
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    node = node.parentElement;
  }
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
  return true;
}
export function getNavFields(container) {
  if (!container) return [];
  return [...container.querySelectorAll('input, textarea, select')].filter(_navFieldVisible);
}
export function setupEnterNav(container, submitBtn) {
  if (!container) return;
  container.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    // 中文/日文输入法组词中（含 keyCode 229），回车是确认候选词，不跳转
    if (e.isComposing || e.keyCode === 229) return;
    const t = e.target;
    if (!t || !t.closest || !t.matches('input, textarea, select')) return;
    // 原生下拉框：保留 Enter 展开/选择选项的原生行为，不拦截跳转
    if (t.tagName === 'SELECT') return;
    const tt = ((t.type || '') + '').toLowerCase();
    if (['button','submit','checkbox','radio','file','hidden','range','color','image'].includes(tt)) return;
    // textarea 默认 Enter 换行，需 Ctrl/Cmd+Enter 才跳转（本应用暂无多行框，预留）
    if (t.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const fields = getNavFields(container);
    const idx = fields.indexOf(t);
    if (idx === -1) return;
    if (idx < fields.length - 1) {
      const next = fields[idx + 1];
      next.focus();
      const nt = ((next.type || '') + '').toLowerCase();
      if (['text','number','search','tel','url','email','password'].includes(nt)) {
        try { next.select(); } catch (_) {}
      }
    } else if (submitBtn) {
      const btn = typeof submitBtn === 'function' ? submitBtn() : submitBtn;
      if (btn && !btn.disabled) btn.click();
    }
  });
}

/* ============ 页码辅助 ============ */
export function getItemPageStart(it) {
  if (it.pageStart != null) return it.pageStart;
  if (it.page != null) return it.page;
  return 0;
}
export function getItemPageEnd(it) {
  if (it.pageEnd != null) return it.pageEnd;
  if (it.pageStart != null) return it.pageStart;
  if (it.page != null) return it.page;
  return 0;
}
// 判断条目是否有有效的页码定位（pageStart > 0 才算有）
export function hasPageLocator(it) {
  return getItemPageStart(it) > 0;
}
// 判断条目是否有有效的套卷号定位（setNo > 0 才算有）
export function hasSetLocator(it) {
  return it.setNo != null && it.setNo > 0;
}
export function fmtPageRange(it) {
  const s = getItemPageStart(it);
  const e = getItemPageEnd(it);
  if (s === e) return `P${s}`;
  return `P${s}-${e}`;
}
/* 错题出处：根据当前模式返回定位信息
   - free模式：优先source自由文本，回退页码
   - page模式：只显示页码，不显示旧source文本（转换后旧source保留但不展示）
   - set模式：只显示套卷号，不显示旧source文本 */
export function getItemSource(it, p) {
  const mode = p && p.mistakeMode ? p.mistakeMode : 'free';
  if (mode === 'set') {
    if (hasSetLocator(it)) return paperLabel(p, it.setNo);
    return ''; // set模式下不显示旧source文本
  }
  if (mode === 'page') {
    if (hasPageLocator(it)) return fmtPageRange(it);
    return ''; // page模式下不显示旧source文本
  }
  // free模式：优先source，回退页码
  if (it.source != null && String(it.source).trim() !== '') return String(it.source).trim();
  if (hasPageLocator(it)) return fmtPageRange(it);
  if (hasSetLocator(it)) return paperLabel(p, it.setNo);
  return '';
}
/* 列表/看板里条目的定位文字：错题显示出处（可空），背书显示页码区间 */
export function fmtItemLocator(p, it) {
  if (p.type === 'mistake') return getItemSource(it, p);
  return fmtPageRange(it);
}

/* ============ 核心计算 ============ */
export function getIntervals(p) {
  return (p.intervals && p.intervals.length) ? p.intervals : DEFAULT_INTERVALS;
}

/* 一条内容从首次学习到"走完最后一轮、毕业"所需的累计天数 = 各档间隔之和。
   默认 [1,2,4,7,15,30] → 59 天。背书要保证所有内容在考试前毕业，
   最后一批新内容最晚必须在 deadline - cycleDays 天学完，之后只复习不学新。 */
export function getReviewCycleDays(p) {
  const iv = getIntervals(p);
  let sum = 0;
  for (let i = 0; i < iv.length; i++) sum += Math.max(1, parseInt(iv[i], 10) || 1);
  return sum;
}

export function calcNextReviewDateFromLearn(learnDate, completedReviews, intervals) {
  if (completedReviews >= intervals.length) return null;
  let total = 0;
  for (let i = 0; i <= completedReviews; i++) total += intervals[i];
  return addDays(learnDate, total);
}

export function isSetMode(p) { return !!p && p.type === 'exercise' && p.unit === 'set'; }
/* 错题本模式辅助 */
export function isMistakeFreeMode(p) { return !!p && p.type === 'mistake' && (!p.mistakeMode || p.mistakeMode === 'free'); }
export function isMistakePageMode(p) { return !!p && p.type === 'mistake' && p.mistakeMode === 'page'; }
// 能否用"只做部分页（跳着做）"：按页推进的模式（刷题页模式 / 错题按页 / 背书）；套卷、自由错题不适用
export function isPageScopeCapable(p) {
  if (!p) return false;
  if (p.type === 'exercise') return p.unit !== 'set';
  if (p.type === 'mistake') return isMistakePageMode(p);
  if (p.type === 'recite') return true;
  return false;
}
export function isMistakeSetMode(p) { return !!p && p.type === 'mistake' && p.mistakeMode === 'set'; }
export function mistakeUsesUnits(p) { return isMistakePageMode(p) && p.unitMode && Array.isArray(p.units) && p.units.length > 0; }
export function unitName(p) {
  if (isSetMode(p)) return '套';
  // 错题本所有模式统一按"条"统计（收录→攻克），套卷号只是归类维度
  if (p && p.type === 'mistake') return '条';
  return '页';
}
export function fmtUnitNum(n) {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/* ============ 区间合并 & 已完成页数 ============ */
export function mergeRanges(ranges) {
  if (!ranges.length) return [];
  const sorted = ranges.filter(r => r.end >= r.start).slice().sort((a, b) => a.start - b.start);
  if (!sorted.length) return [];
  const merged = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end + 1) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ start: sorted[i].start, end: sorted[i].end });
    }
  }
  return merged;
}
export function countMergedPages(merged) {
  return merged.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
}
/* 把原始区间 merge 后裁剪到目标范围（单元范围/正文范围），再计页数。
   所有"已完成页数"口径都应走这里，避免一个裁一个不裁导致 delta/今日新增/速度估计对不上。 */
export function countClippedRanges(ranges, p) {
  const targets = getTargetPageRanges(p);
  if (!targets.length) return 0; // 与 getBookDoneRanges 一致：无目标范围视为 0 页
  const merged = mergeRanges(ranges);
  const clipped = [];
  merged.forEach(r => targets.forEach(t => {
    const s = Math.max(t.start, r.start), e = Math.min(t.end, r.end);
    if (e >= s) clipped.push({ start: s, end: e });
  }));
  return countMergedPages(mergeRanges(clipped));
}
export function getRecordRange(r, p) {
  if (r.startPage != null) {
    const s = r.startPage;
    const e = r.endPage != null ? r.endPage : s;
    return { start: s, end: e };
  }
  const end = r.endPage != null ? r.endPage : (r.page != null ? r.page : 0);
  return { start: 1, end };
}
export function getPaperSections(p) {
  return Array.isArray(p.paperSections) ? p.paperSections.filter(s => s && s.name) : [];
}
export function getNormalizedSections(p) {
  const secs = getPaperSections(p);
  const sum = secs.reduce((s, x) => s + Math.max(0, Number(x.weight) || 0), 0);
  if (!secs.length) return [];
  if (sum <= 0) {
    const eq = 1 / secs.length;
    return secs.map(s => ({ ...s, wt: eq }));
  }
  return secs.map(s => ({ ...s, wt: Math.max(0, Number(s.weight) || 0) / sum }));
}
export function paperLabel(p, n) {
  if (p && p.paperLabelMode === 'year' && p.paperYearStart) {
    const y = parseInt(p.paperYearStart, 10) + n - 1;
    return `${y}年`;
  }
  return `第${n}套`;
}
export function getSetState(p, targetDate) {
  const secs = getNormalizedSections(p);
  const state = {};
  const recs = (p.records || []).slice().sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
  // 追踪每个 (套号, 板块) 最近一次录入的日期与 pct：
  // 同一天重复录入同板块 = 覆盖（后填替换先填），跨天录入才累加，避免 50%+80%=130% 被 cap 到 100%
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
        // 同一天重复：用新 pct 替换旧 pct（先减旧再加新）
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
export function getSetFraction(p, no, state) {
  const st = (state || getSetState(p))[no];
  if (!st) return 0;
  const secs = getNormalizedSections(p);
  if (secs.length) {
    let f = 0;
    secs.forEach(s => { f += ((st.secs[s.id] || 0) / 100) * s.wt; });
    return Math.max(0, Math.min(1, f));
  }
  return st.legacy;
}
export function getCompletedSets(p, targetDate) {
  const state = getSetState(p, targetDate);
  return Object.keys(state).reduce((sum, no) => sum + getSetFraction(p, no, state), 0);
}
export function getCompletedPages(p) {
  if (isSetMode(p)) return getCompletedSets(p);
  // 错题：按已攻克条数统计（mastered 或 manualMastered），而非收录条数
  if (p.type === 'mistake') return (p.items || []).filter(it => it.mastered || it.manualMastered).length;
  // 刷题(练习册)与背书：按"页码区间合并"算进度。getBookDoneRanges 已自动裁剪到目标范围（单元范围或正文范围）
  return countRanges(getBookDoneRanges(p));
}
export function getCompletedPagesAtDate(p, targetDate) {
  if (isSetMode(p)) return getCompletedSets(p, targetDate);
  if (p.type === 'mistake') {
    // 用 masteredDate 精确回溯：在目标日期或之前已攻克/熟知的才算；
    // 极少数老数据没有 masteredDate 时退回 learnedDate，避免已攻克条目在历史曲线里"消失"。
    return (p.items || []).filter(it => {
      if (!(it.mastered || it.manualMastered)) return false;
      const d = it.masteredDate || it.learnedDate;
      return d && d <= targetDate;
    }).length;
  }
  let ranges;
  if (p.type === 'exercise') {
    ranges = (p.records || []).filter(r => r.date <= targetDate).map(r => getRecordRange(r, p));
  } else {
    ranges = (p.items || []).filter(it => it.learnedDate <= targetDate)
      .map(it => ({ start: getItemPageStart(it), end: getItemPageEnd(it) }));
  }
  // 与 getBookDoneRanges 同口径：裁剪到目标范围，避免历史/当前累计一个裁一个不裁
  return countClippedRanges(ranges, p);
}

/* ============ 节奏估计：活跃率 × 学习日产能 ============
 * 旧算法把"剩余量/剩余自然日"当每日目标，并把"14天内进度差/14"当速度，
 * 隐含两个错误假设：① 你每天都学；② 休息日也算学习日。
 * 新模型从历史打卡重建"每日新增完成量"，估计两个参数：
 *   activityPerDay —— 任一自然日你会学习的概率（贝叶斯 Beta 后验，先验≈每周5天）
 *   perStudyDayRaw —— 学习日当天的平均完成量（EWMA，半衰期14天，近期更重）
 * 自然日产能 = activityPerDay × perStudyDayRaw，才是外推 ETA 的正确速度。
 * 学习日目标 = (剩余量 + 已落后量) / 剩余预期学习日数，自动把过去的债分摊回来。
 */
/* getMetrics 缓存：按项目+日期，数据未变则直接复用 */
export const _metricsCache = {};
export function getMetrics(p) {
  const t = todayStr();
  // 清理过期缓存：只保留今天的
  Object.keys(_metricsCache).forEach(k => { if (!k.endsWith(':' + t)) delete _metricsCache[k]; });
  const cacheKey = p.id + ':' + t;
  const itemsLen = (p.items || []).length;
  // 缓存签名：包含所有影响指标的字段，避免改 paperSections/intervals/unitMode 等不刷新
  const dataSig = (p.updatedAt || 0) + '|' + (p.records || []).length + '|' + itemsLen
    + '|' + p.total + '|' + p.bookStartPage + '|' + p.bookEndPage + '|' + (p.deadline || '')
    + '|' + JSON.stringify(p.paperSections || []) + '|' + JSON.stringify(p.intervals || [])
    + '|' + (p.unitMode ? 1 : 0) + '|' + (p.reviewMode || '');
  if (_metricsCache[cacheKey] && _metricsCache[cacheKey].sig === dataSig) {
    return _metricsCache[cacheKey].result;
  }
  // 错题本：总量 = 当前已收录条数（随添加/删除动态变化，无需预估）
  // 刷题/背书：启用单元模式时用所有单元范围的总页数（自动排除习题等）；否则用整本书范围或 p.total
  let total;
  if (p.type === 'mistake') {
    total = itemsLen;
  } else if (p.unitMode && Array.isArray(p.units) && p.units.length) {
    total = countRanges(getTargetPageRanges(p));
  } else if (p.bookStartPage != null && p.bookEndPage != null) {
    total = Math.max(0, p.bookEndPage - p.bookStartPage + 1);
  } else {
    total = p.total;
  }
  const currentPage = getCompletedPages(p);
  const remaining = Math.max(0, total - currentPage);

  const daysLeft = p.deadline ? diffDays(t, p.deadline) : null;
  const daysAvailable = daysLeft === null ? null : daysLeft + 1;
  // 兼容旧通知/看板：假设"天天学"的保守自然日均值
  const needPerDay = daysAvailable > 0 ? remaining / daysAvailable : Infinity;

  // ---- 收集所有完成日期（exercise→records.date；recite/mistake→items.learnedDate + masteredDate）----
  const dateSet = new Set();
  if (p.type === 'exercise') {
    (p.records || []).forEach(r => { if (r.date) dateSet.add(r.date); });
  } else {
    (p.items || []).forEach(it => {
      if (it.learnedDate) dateSet.add(it.learnedDate);
      if (it.masteredDate) dateSet.add(it.masteredDate); // 攻克日也要有采样点
    });
  }
  const allDates = [...dateSet].sort();

  // 累计完成量（自动处理区间合并 / 套卷权重 / 背书 learnedDate）
  const cumByDate = {};
  allDates.forEach(d => { cumByDate[d] = getCompletedPagesAtDate(p, d); });
  const idxOf = {};
  allDates.forEach((d, i) => { idxOf[d] = i; });

  // 观察窗口：最近 60 个自然日，且不早于第一条记录（ISO 日期可按字符串字典序比较）
  const WINDOW_DAYS = 60;
  const cutoff = addDays(t, -(WINDOW_DAYS - 1));
  let windowStart = allDates.length ? (allDates[0] > cutoff ? allDates[0] : cutoff) : cutoff;
  if (windowStart > t) windowStart = t;
  const inWindowDates = allDates.filter(d => d >= windowStart && d <= t);

  // 窗口内每日新增完成量（与上一个记录日做差，区间合并保证 cum 单调不减）
  const dailyDelta = [];
  inWindowDates.forEach(d => {
    const i = idxOf[d];
    const prevCum = i > 0 ? cumByDate[allDates[i - 1]] : 0;
    dailyDelta.push({ date: d, delta: Math.max(0, cumByDate[d] - prevCum) });
  });

  const activeDays = dailyDelta.filter(x => x.delta > 0).length;
  const windowDays = Math.max(1, diffDays(windowStart, t) + 1);
  const activeSet = new Set(dailyDelta.filter(x => x.delta > 0).map(x => x.date));

  // ---- 活跃率：对窗口内每个自然日的 0/1 学习指示做 EWMA（半衰期10天），再向先验收缩 ----
  // v3.1：先验强度随观察到的学习日数自适应衰减。
  // 原固定 PRIOR_K=10 会让“每天都学”的重度用户被永久低估（上限约 0.884）。
  // 现在：activeDays 越少越依赖先验（每周约 5 天）；累积到 7 个学习日后完全相信历史数据。
  // v8.1：收敛上限从 10 调整为 7，经模拟验证：全职用户首周误差减半，在职用户提前约1周收敛，小样本仍有先验保护。
  const ACT_HALF = 10;
  const PRIOR_RATE = 5 / 7;
  const PRIOR_K = Math.max(0, 7 - Math.min(activeDays, 7));

  let wAll = 0, wActive = 0;
  // 全新项目（无任何学习记录）不虚构"过去 60 个自然日都没学"，否则会把先验（每周约 5 天）
  // 错误稀释成每周约 2 天。只有真正存在过记录（哪怕在 60 天前）时，才用窗口内的空白天数反映"最近没学"。
  const ewmaDays = allDates.length ? windowDays : 0;
  for (let age = 0; age < ewmaDays; age++) {
    const d = addDays(t, -age);
    const w = Math.pow(0.5, age / ACT_HALF);
    wAll += w;
    if (activeSet.has(d)) wActive += w;
  }
  const rawActivity = wAll > 0 ? wActive / wAll : 0;
  const activityPerDay = (wActive + PRIOR_RATE * PRIOR_K) / (wAll + PRIOR_K);
  const activityPerWeek = activityPerDay * 7;

  // ---- 学习日产能：EWMA，半衰期 14 天（只对真正推进了进度的日子加权）----
  const HALF_LIFE = 14;
  let wSum = 0, dwSum = 0;
  dailyDelta.forEach(x => {
    if (x.delta <= 0) return;
    const age = Math.max(0, diffDays(x.date, t));
    const w = Math.pow(0.5, age / HALF_LIFE);
    wSum += w; dwSum += w * x.delta;
  });
  const perStudyDayRaw = wSum > 0 ? dwSum / wSum : 0;

  // ---- 自然日产能（含休息日），与 ETA 同口径 ----
  const naturalDailyRate = activityPerDay * perStudyDayRaw;

  // ---- 置信度 ----
  // medium：累计 3 个学习日即启动个性化（不再要求窗口跨满 7 天，否则天天学的积极用户前 6 天都被当"样本不足"，
  // 与容量冷启动"3 个学习日就个性化"的门槛保持一致）；早期 medium 文案会标"范围偏宽、会随你修正"。
  // high：需 7 个学习日且跨满 2 周，才有稳定的活跃率/星期画像。
  let confidence = 'low';
  if (activeDays >= 7 && windowDays >= 14) confidence = 'high';
  else if (activeDays >= 3) confidence = 'medium';
  const enoughData = confidence !== 'low';

    // ---- 稀疏打卡检测：记录间隔越长，产能归因越不精确 ----
  // 系统只能把完成量归到「有打卡的那一天」，长间隔会让单日产能被高估。
  // 这里用相邻学习日的间隔中位数来判断，≥4 天就在 UI 上提示。
  let medianGap = null;
  if (activeDays >= 2) {
    const activeDates = dailyDelta.filter(x => x.delta > 0).map(x => x.date);
    const gaps = [];
    for (let i = 1; i < activeDates.length; i++) {
      gaps.push(diffDays(activeDates[i - 1], activeDates[i]));
    }
    if (gaps.length) {
      gaps.sort((a, b) => a - b);
      medianGap = gaps[Math.floor(gaps.length / 2)];
    }
  }
  const sparseLogging = medianGap != null && medianGap >= 4;

  // ---- 产能波动区间：给"乐观/保守"完成范围，而不是一个看似精确的单点日期 ----
  const activeVals = dailyDelta.filter(x => x.delta > 0).map(x => x.delta).sort((a, b) => a - b);
  const quantile = (arr, q) => {
    if (!arr.length) return null;
    const pos = (arr.length - 1) * q, b = Math.floor(pos), r = pos - b;
    return arr[b + 1] != null ? arr[b] + r * (arr[b + 1] - arr[b]) : arr[b];
  };
  let rateHigh = null, rateLow = null; // 状态好 / 状态差时，每个学习日的典型产能
  if (confidence === 'high' && activeVals.length >= 7) {
    // 经验分位，并保留 ±8% 的最小带宽（即使每天很规律，日常也难免波动，范围不应退化成一个点）
    rateHigh = Math.max(quantile(activeVals, 0.75), perStudyDayRaw * 1.08);
    rateLow  = Math.min(quantile(activeVals, 0.25), perStudyDayRaw * 0.92);
  } else if (enoughData && activeVals.length >= 3) {
    rateHigh = perStudyDayRaw * 1.3;   // 样本偏少，给较宽的启发式区间并在文案标注
    rateLow  = perStudyDayRaw * 0.7;
  }
  const natRateHigh = activityPerDay * (rateHigh || 0); // 乐观自然日产能（早完成）
  const natRateLow  = activityPerDay * (rateLow || 0);  // 保守自然日产能（晚完成）

  // ---- 速度（自然日口径，兼容旧 status/图表）----
  let speed = null, speedLabel = '';
  if (naturalDailyRate > 0) {
    speed = naturalDailyRate;
    speedLabel = `近${windowDays}天节奏（每周约${Math.round(activityPerWeek)}个学习日）`;
  }
  if (speed === null) {
    const fbDate = allDates[0] || p.startDate;
    if (fbDate) {
      const span = diffDays(fbDate, t) + 1;
      if (span >= 1 && currentPage > 0) { speed = currentPage / span; speedLabel = '自开始以来（粗估）'; }
    }
  }

  // ---- ETA（基准 + 乐观/保守区间）----
  let etaDate = null, etaEarlyDate = null, etaLateDate = null;
  if (remaining === 0) { etaDate = etaEarlyDate = etaLateDate = t; }
  else if (speed !== null && speed > 0) {
    etaDate = addDays(t, Math.ceil(remaining / speed));
    if (enoughData) {
      if (natRateHigh > 0) etaEarlyDate = addDays(t, Math.ceil(remaining / natRateHigh));
      if (natRateLow > 0)  etaLateDate  = addDays(t, Math.ceil(remaining / natRateLow));
    }
  }

  // ---- 有效开始日：填了 startDate 且不早于/等于最早打卡日时用它；否则用最早打卡日；全新项目无记录则为 null ----
  const effStart = (p.startDate && (!allDates.length || p.startDate <= allDates[0]))
    ? p.startDate : (allDates.length ? allDates[0] : null);

  // ---- 落后量（仅用于文案解释；不重复加进目标，因为 remaining 已含落后）----
  let behind = 0;
  if (effStart && p.deadline && total > 0) {
    const totalSpan = diffDays(effStart, p.deadline);
    const elapsed = diffDays(effStart, t);
    if (totalSpan > 0) {
      const idealAtToday = total * Math.max(0, Math.min(1, elapsed / totalSpan));
      behind = Math.max(0, idealAtToday - currentPage);
    }
  }
  // 剩余预期学习日数（含今天）；无截止日时不存在"追赶目标"，下面不计算每学习日目标
  const hasDeadline = daysAvailable != null && daysAvailable > 0;
  // ===== 背书本：要保证"所有内容在考试前走完所有复习轮次并毕业"，
  // 新学必须提前一个完整复习周期（默认约59天）结束，之后只滚动复习。据此计算新学有效窗口。 =====
  let cycleDays = 0, newLearnEnd = null, sprint = false, cycleTight = false;
  let planDaysAvailable = daysAvailable; // 新学进度/可行性使用的有效天数（背书=到新学截止日，其余=到考试日）
  if (p.type === 'recite' && hasDeadline) {
    cycleDays = getReviewCycleDays(p);
    newLearnEnd = addDays(p.deadline, -cycleDays);
    const daysToNewLearnEnd = diffDays(t, newLearnEnd) + 1;
    if (daysToNewLearnEnd < 1) {
      // 剩余时间已放不下一个完整复习周期：进入冲刺，新学目标按考试日算（至少把要考的过一遍），由状态卡给冲刺策略
      sprint = true;
      planDaysAvailable = daysAvailable;
    } else {
      planDaysAvailable = daysToNewLearnEnd;
    }
  }
  const studyDaysRemaining = hasDeadline ? Math.max(0.5, planDaysAvailable * activityPerDay) : null;
  // 每个学习日该做多少 = 剩余 / 剩余学习日（落后已体现在 remaining 里，不再叠加，否则会堆到做不到）
  let perStudyDay = null;
  // 可行性分级：把"目标负荷"和"历史产能"对比，做不到时给出路而不是硬塞数字
  let feasibility = null, ratio = null, feasiblePerWeek = null, feasibleDays = null, feasibleDaysLong = null;
  let needWkNormal = null, needWkBest = null; // 按平时节奏 / 拼尽全力，每周需学几天
  // 近 7 天「势头」：产能用半衰期 14 天的 EWMA，用户刚提速时反应偏慢，会让"来不及"提示挂很久。
  // 额外统计最近 7 天的自然日产能作为乐观信号（至少 3 个学习日才采信，避免一两天的异常误导），
  // 让"刚开始努力"能在几天内被看见；这是只上抬、不压低的信号。
  let momentumNatRate = null, momentumDays = 0;
  if (remaining > 0) {
    const deltaByDate = {};
    dailyDelta.forEach(x => { deltaByDate[x.date] = x.delta; });
    let mActive = 0, mTotal = 0;
    for (let o = 0; o < 7; o++) {
      const dl = deltaByDate[addDays(t, -o)] || 0;
      if (dl > 0) { mActive++; mTotal += dl; }
    }
    momentumDays = mActive;
    if (mActive >= 3) momentumNatRate = (mActive / 7) * (mTotal / mActive);
  }
  if (enoughData && remaining > 0 && hasDeadline) {
    perStudyDay = remaining / studyDaysRemaining;
    if (perStudyDayRaw > 0) {
      ratio = perStudyDay / perStudyDayRaw;
      // 乐观边界 = 长期最好状态 与 最近 7 天势头 取较高者；保守边界仍用长期低值，不轻易承诺"轻松"
      const effectiveHigh = momentumNatRate != null
        ? Math.max(natRateHigh || 0, momentumNatRate) : natRateHigh;
      // 用"最快/最慢"完成所需自然日数与可用天数比较来分档，比单点均值更稳健、更好解释
      const daysNeededEarly = effectiveHigh > 0 ? remaining / effectiveHigh : Infinity; // 状态最好/最近势头
      const daysNeededLate  = natRateLow  > 0 ? remaining / natRateLow  : Infinity; // 状态较差时
      // 背书本按"新学窗口"判断能否在留出完整复习周期的前提下学完；其余类型按考试日总天数
      if (daysNeededLate <= planDaysAvailable) feasibility = 'easy';  // 即使慢一点也来得及
      else if (daysNeededEarly > planDaysAvailable) {
        if (p.type === 'recite' && !sprint && daysNeededEarly <= daysAvailable) {
          // 新学窗口（考试日-复习周期）赶不上，但在考试前还能学完：复习周期会被压缩，
          // 最后一批内容只能做短期冲刺。标记 cycleTight，由状态卡给出"加量/提前"建议，而不是简单判来不及。
          cycleTight = true;
          feasibility = 'stretch';
        } else if (sprint) {
          // 已进入冲刺期（完整周期放不下）：新学目标按考试日算，不再判 impossible，交由冲刺文案
          feasibility = 'stretch';
        } else {
          // 数据有限（medium，通常是刚用 1~2 周）时不轻易判"无法完成"：样本噪声大、用户正在适应，
          // 太早挂"来不及"会很打击人；降级为 stretch，攒满约 2 周数据后再如实判断。
          feasibility = confidence === 'high' ? 'impossible' : 'stretch';
        }
      }
      else feasibility = 'stretch';                                      // 正常发挥有风险、加把劲可赶上
      // 每周需学几天：主指标用平时产能（用户最可能达到的水平）；分母用新学窗口天数
      needWkNormal = remaining / perStudyDayRaw / (planDaysAvailable / 7);
      // 拼尽全力（每次都达到最好状态）时每周需学几天，用于判断"学满7天到底行不行"
      needWkBest = rateHigh ? remaining / rateHigh / (planDaysAvailable / 7) : needWkNormal;
      feasiblePerWeek = needWkNormal;
      // 预计完成所需自然日：若近期势头明显更快，按势头给一个更贴近当下的口径（状态卡展示"最近势头"）
      const effectiveNat = momentumNatRate != null ? Math.max(naturalDailyRate, momentumNatRate) : naturalDailyRate;
      if (effectiveNat > 0) feasibleDays = remaining / effectiveNat;
      // 长期可持续口径（不含近7天爆发）：用于"延期兜底"建议，避免爆发期算出比截止日还早的日期
      if (naturalDailyRate > 0) feasibleDaysLong = remaining / naturalDailyRate;
    }
  }
  // 冷启动（尚无个人节奏）：仍给一个粗略"每学习日目标"，让看板大字、今日目标横幅、状态卡三处口径一致，
  // 避免新用户前几天看板是空目标或用错口径。按固定先验"每周约 5 个学习日"；planDaysAvailable 对背书
  // 已自动用"新学窗口（目标日−完整复习周期）"、其余模式用目标日。攒满 3 个学习日进入 medium 后，
  // 由上面的真实节奏 perStudyDay 覆盖。
  if (perStudyDay == null && remaining > 0 && hasDeadline) {
    perStudyDay = remaining / Math.max(0.5, planDaysAvailable * (5 / 7));
  }
  // 数据不足时，告诉用户再补多少天打卡预测才稳
  // “再积累多少学习日”，而不是“再连续打卡多少天”——后者对低频用户不准确
  // 两阶段：累计 3 个学习日即开始个性化（宽范围），7 个学习日且跨 2 周后范围稳定（high）。
  const daysToMedium = confidence === 'low' ? Math.max(0, 3 - activeDays) : 0;
  const needMoreActiveDays = confidence === 'high' ? 0 : Math.max(0, 7 - activeDays);
  const needMoreDays = needMoreActiveDays; // 兼容旧调用点

  // 今天已推进多少（用于"今日是否达标"提示）：当前累计 − 昨天及以前的累计
  const cumYesterday = getCompletedPagesAtDate(p, addDays(t, -1));
  const todayDone = Math.max(0, currentPage - cumYesterday);

  // ---- 坚持度 & 趋势（供看板/完成情况使用）----
  const isActiveDay = d => activeSet.has(d);
  // 当前连续：今天学了从今天算；今天还没学则从昨天往回算（不因今天尚未学就清零）
  let streakNow = 0;
  let cursor = isActiveDay(t) ? t : addDays(t, -1);
  while (cursor >= windowStart && isActiveDay(cursor)) { streakNow++; cursor = addDays(cursor, -1); }
  // 窗口内最长连续 & 最长停摆（无活跃日时停摆为0）
  // 与连续打卡逻辑一致：今天没学则从昨天开始统计，不把"今天还没来得及学"算入停摆
  let longestStreak = 0, runOn = 0, longestBreak = 0, runOff = 0;
  if (allDates.length) {
    const startAge = isActiveDay(t) ? 0 : 1; // 今天学了从今天算，没学从昨天算
    // 当前这一段连续（从 startAge 起 streakNow 天）不计入"历史最长"，否则刷新纪录永远不成立
    const currentRunEndAge = startAge + streakNow - 1;
    for (let age = windowDays - 1; age >= startAge; age--) {
      const d = addDays(t, -age);
      if (isActiveDay(d)) {
        runOn++;
        if (age > currentRunEndAge) longestStreak = Math.max(longestStreak, runOn);
        runOff = 0;
      } else {
        runOff++; longestBreak = Math.max(longestBreak, runOff); runOn = 0;
      }
    }
  }
  const lastStudyDate = allDates.length ? allDates[allDates.length - 1] : null;
  // 今天之前的上一个学习日（用于"中断后回归"判断，lastStudyDate可能包含今天）
  const prevStudyDate = allDates.filter(d => d < t).slice(-1)[0] || null;
  // 趋势：近 7 天学习日平均产能 vs 之前 3 周（8~28 天前）学习日平均产能
  const meanActive = dates => {
    const vals = dailyDelta.filter(x => dates.includes(x.date) && x.delta > 0).map(x => x.delta);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const recentDates = [], prevDates = [];
  for (let o = 0; o <= 6; o++) recentDates.push(addDays(t, -o));
  for (let o = 7; o <= 27; o++) prevDates.push(addDays(t, -o));
  const recentRate = meanActive(recentDates), prevRate = meanActive(prevDates);
  let trendPct = null;
  if (recentRate != null && prevRate != null && prevRate > 0) trendPct = (recentRate - prevRate) / prevRate;

  // 按最近 7 天势头的预计完成日（比长期 EWMA 更贴近"现在的你"，用于鼓励刚提速的用户）
  let momentumEtaDate = null;
  if (remaining > 0 && momentumNatRate != null && momentumNatRate > 0) {
    momentumEtaDate = addDays(t, Math.ceil(remaining / momentumNatRate));
  }
  // 最近势头是否足以在截止日前完成（状态卡据此及时给出"按这个势头能赶上"）
  let momentumOnTime = false;
  if (hasDeadline && momentumEtaDate) {
    // 背书正常窗口下按"新学截止日"判断（赶上新学截止才留得出完整复习周期）；冲刺/其余按考试日
    const onTimeTarget = (p.type === 'recite' && newLearnEnd && !sprint) ? newLearnEnd : p.deadline;
    momentumOnTime = momentumEtaDate <= onTimeTarget;
  }
  // 近期势头改善：最近 7 天自然日产能比长期均值高出 ≥25%，但还没高到能按期。
  // 用于在"暂时落后"时也及时把进步反馈出来（缺口在缩小），而不是让红灯一直挂着。只上抬、不压低。
  let momentumImproving = false;
  if (!momentumOnTime && momentumDays >= 3 && momentumNatRate != null && naturalDailyRate > 0 && remaining > 0) {
    momentumImproving = momentumNatRate >= naturalDailyRate * 1.25;
  }

  const result = {
    t, total, currentPage, remaining, daysLeft, daysAvailable,
    needPerDay, speed, speedLabel, etaDate, etaEarlyDate, etaLateDate,
    activeDays, windowDays, activityPerWeek, perStudyDayRaw, rateHigh, rateLow,
    perStudyDay, studyDaysRemaining, behind, confidence, enoughData,
    feasibility, ratio, feasiblePerWeek, feasibleDays, feasibleDaysLong, needWkNormal, needWkBest, needMoreDays, needMoreActiveDays, daysToMedium,
    sparseLogging, medianGap,
    todayDone, streakNow, longestStreak, longestBreak, lastStudyDate, prevStudyDate,
    recentRate, prevRate, trendPct,
    momentumNatRate, momentumDays, momentumEtaDate, momentumOnTime, momentumImproving,
    cycleDays, newLearnEnd, sprint, cycleTight, planDaysAvailable,
    effStart
  };
  _metricsCache[cacheKey] = { sig: dataSig, result };
  return result;
}

export function getDueItems(p) {
  if (p.type === 'exercise') return [];
  const today = todayStr();
  return (p.items || []).filter(it => !it.mastered && !it.manualMastered && it.nextReviewDate && it.nextReviewDate <= today);
}
export function getOverdueItems(p) {
  if (p.type === 'exercise') return [];
  const today = todayStr();
  return (p.items || []).filter(it => !it.mastered && !it.manualMastered && it.nextReviewDate && it.nextReviewDate < today);
}

/* ============ 保持期复习（已掌握内容的定期唤醒，防止遗忘） ============ */
// 保持间隔：前2次30天，第3次45天，之后60天（逐渐拉长，符合记忆曲线）
export function getRetentionGap(passCount) {
  if (passCount <= 0) return 30;
  if (passCount === 1) return 30;
  if (passCount === 2) return 45;
  return 60;
}
// 每日保持复习软上限：同一天掌握的内容，到期日自动摊到多天，避免几十条扎堆
export const RETENTION_DAILY_CAP = 5;
export const RETENTION_STAGGER_WINDOW = 21; // 最多向后顺延的天数
// 复习列表中保持复习默认展示条数（超出折叠，避免长期未处理时列表冗长）
export const RETENTION_SHOWN_CAP = 5;
export const _retentionExpanded = new Set(); // 已展开全部保持复习的项目 id
/* 在目标日期当天及之后找一个"已排保持复习最少"的日子（只顺延、不提前）。
   逐条掌握时反复调用：前面刚排的条目会被计入，于是同日掌握的一批自然均匀摊开。 */
export function staggerRetentionDate(p, target, excludeId) {
  if (!p || !Array.isArray(p.items)) return target;
  const counts = {};
  p.items.forEach(it => {
    if (it.id === excludeId) return;
    if (it.mastered && !it.manualMastered && it.retentionDate) {
      counts[it.retentionDate] = (counts[it.retentionDate] || 0) + 1;
    }
  });
  // 叠加当天正常复习负载（未掌握条目的排期）：保持复习错峰要避开已被正常复习占满的日子，
  // 用项目舒适量作总容量上限，避免某天总负载远超舒适量
  const cap = getComfortCap(p);
  p.items.forEach(it => {
    if (it.mastered) return; // 已掌握条目不进正常复习排期
    if (it.nextReviewDate) {
      counts[it.nextReviewDate] = (counts[it.nextReviewDate] || 0) + 1;
    }
  });
  // 优先：目标日期起，找到第一个"总负载未达舒适量上限"的日子
  for (let i = 0; i <= RETENTION_STAGGER_WINDOW; i++) {
    const d = addDays(target, i);
    if ((counts[d] || 0) < cap) return d;
  }
  // 兜底：窗口内都满了，选总负载最少的一天
  let best = target, bestN = Infinity;
  for (let i = 0; i <= RETENTION_STAGGER_WINDOW; i++) {
    const d = addDays(target, i);
    const n = counts[d] || 0;
    if (n < bestN) { bestN = n; best = d; }
  }
  return best;
}
// 安排下一次保持复习（掌握时调用，或保持复习通过后调用）。传入 p 以启用自动错峰。
export function scheduleRetention(item, baseDate, passCount, p) {
  item.retentionPass = passCount;
  const target = addDays(baseDate, getRetentionGap(passCount));
  item.retentionDate = p ? staggerRetentionDate(p, target, item.id) : target;
}
// 清除保持复习安排（取消掌握/手动熟知时调用）
export function clearRetention(item) {
  item.retentionDate = null;
  item.retentionPass = 0;
}
// 今日到期的保持复习条目（已掌握、非手动熟知、retentionDate <= 今天）
export function getRetentionDueItems(p) {
  if (p.type === 'exercise') return [];
  const today = todayStr();
  return (p.items || []).filter(it =>
    it.mastered && !it.manualMastered && it.retentionDate && it.retentionDate <= today
  );
}
// 保持复习逾期条目
export function getRetentionOverdueItems(p) {
  if (p.type === 'exercise') return [];
  const today = todayStr();
  return (p.items || []).filter(it =>
    it.mastered && !it.manualMastered && it.retentionDate && it.retentionDate < today
  );
}
/* 保持复习评价：pass=还记得（继续保持，间隔拉长）；fail=模糊了（退出掌握，回到正常复习） */
export function applyRetentionReview(item, result, p) {
  const today = todayStr();
  item.retentionReviews = item.retentionReviews || [];
  item.retentionReviews.push({ date: today, result });
  if (result === 'pass') {
    // 还记得：继续保持，安排下一次（间隔逐渐拉长，同日批量通过时自动错峰）
    const nextPass = (item.retentionPass || 0) + 1;
    scheduleRetention(item, today, nextPass, p);
  } else {
    // 模糊了：退出保持期，追加一条 forgot 评价后重算，让正常复习流程接管
    item.mastered = false;
    item.masteredDate = null;
    item.retentionDate = null;
    item.retentionPass = 0;
    item.reviews = item.reviews || [];
    item.reviews.push({ date: today, quality: 'forgot' });
    recomputeItemMastery(item, p);
  }
  p.updatedAt = Date.now();
  saveStore();
}

/* ============ 条目优先级（保留今天 / 先分散谁的统一口径） ============ */
/* 高优先级 = 更该留在今天：逾期久 > 更薄弱 > 被分散次数多（防饥饿）> stage 低 */
export function compareItemPriority(a, b) {
  const today = todayStr();
  const oa = a.nextReviewDate < today ? diffDays(a.nextReviewDate, today) : 0;
  const ob = b.nextReviewDate < today ? diffDays(b.nextReviewDate, today) : 0;
  if (oa !== ob) return ob - oa;
  const sa = getItemScore(a) ?? 0.5;
  const sb = getItemScore(b) ?? 0.5;
  if (sa !== sb) return sa - sb;
  if ((a.spreadCount || 0) !== (b.spreadCount || 0)) return (b.spreadCount || 0) - (a.spreadCount || 0);
  return (a.stage || 0) - (b.stage || 0);
}

/* 逾期分散：为今天原本排期的条目预留名额，只把"超出今日舒适量"的逾期条目摊到未来。
   返回 { moved, blocked }：moved=改到未来的条数；blocked=被防饥饿锁死、强制移回今天的紧急条数。 */
export function spreadOverdueItems(p, days) {
  const today = todayStr();
  const cap = getComfortCap(p, today);
  const onTimeToday = getDueItems(p).filter(it => it.nextReviewDate === today);
  const reserve = onTimeToday.length;
  const overdueSorted = getOverdueItems(p).slice().sort(compareItemPriority);
  // 今天最该还的逾期 = 舒适量减去今天已有排期；防饥饿锁死的条目由 spreadItems 强制留在今天
  const keepN = Math.max(0, cap - reserve);
  const keepIds = new Set(overdueSorted.slice(0, keepN).map(it => it.id));
  const overflow = overdueSorted.filter(it => !keepIds.has(it.id));
  if (!overflow.length) return { moved: 0, blocked: 0 };
  const blockedN = overflow.filter(it => !canBeSpread(it, p)).length;
  const changed = spreadItems(p, overflow, days);
  // spreadItems 的改动 = 锁死条目移回今天（blockedN）+ 可分散条目改到未来
  return { moved: Math.max(0, changed - blockedN), blocked: Math.min(blockedN, changed) };
}

/* 通用分散引擎（v2：每日硬上限 + 全局最佳适配，绝不抬高本就忙的日子）
   - 每日上限 = 舒适量 与 当日排期容量 的较小值（经典模式/容量0 时只看舒适量）
   - 在 1..days 天窗口内，把每条放到"负载/容量比最低"的日子；并列取最近
   - 窗口内全部满载时，仍放入最低负载日（有界超量，保证条目不会无限期滞留）
   - 防饥饿：canBeSpread=false 的条目强制留在今天
*/
export function spreadItems(p, items, days) {
  const today = todayStr();
  days = Math.max(1, parseInt(days, 10) || 1);
  if (!items || !items.length) return 0;

  const spreadable = items.filter(it => canBeSpread(it, p));
  const blocked = items.filter(it => !canBeSpread(it, p));
  let changed = 0;
  // 防饥饿锁死的逾期条目强制回到今天（已在今天的不算变更）
  blocked.forEach(it => {
    if (it.nextReviewDate !== today) { it.nextReviewDate = today; changed++; }
  });

  if (!spreadable.length) {
    if (changed) { p.updatedAt = Date.now(); saveStore(); }
    return changed;
  }

  // 背书本冲刺期：摊派窗口不得越过考试日（把复习排到考试之后没有意义）。
  // 考试就在今天/已到期时，无可摊派的日子，全部留在今天（考前能过多少过多少）。
  let windowDays = days;
  if (p.type === 'recite' && p.deadline) {
    const toDeadline = diffDays(today, p.deadline);
    if (toDeadline < windowDays) windowDays = Math.max(0, toDeadline);
  }
  if (windowDays <= 0) {
    spreadable.forEach(it => { if (it.nextReviewDate !== today) { it.nextReviewDate = today; changed++; } });
    if (changed) { p.updatedAt = Date.now(); saveStore(); }
    return changed;
  }

  spreadable.sort(compareItemPriority);

  // 未来 days 天的逐日容量与已有负载（负载表随分配实时更新）
  const days_ = [];
  for (let d = 1; d <= windowDays; d++) {
    const date = addDays(today, d);
    days_.push({ date, cap: getSpreadDayCap(p, date), load: getReviewLoadOnDate(p, date) });
  }

  spreadable.forEach(it => {
    const oldDate = it.nextReviewDate;
    // 第一轮：只在未满的日子里选相对负载最低、并列最近的
    let best = null;
    for (const col of days_) {
      if (col.load >= col.cap) continue;
      const ratio = col.load / col.cap;
      const dist = diffDays(today, col.date);
      if (!best || ratio < best.ratio - 1e-9 || (Math.abs(ratio - best.ratio) < 1e-9 && dist < best.dist)) {
        best = { col, ratio, dist };
      }
    }
    // 第二轮：窗口全满 → 选绝对负载最低的，并列选最远（保护近期，把溢出推到远端）
    if (!best) {
      let col = days_[0];
      for (const c of days_) {
        if (c.load < col.load || (c.load === col.load && c.date > col.date)) col = c;
      }
      best = { col };
    }
    it.nextReviewDate = best.col.date;
    it.spreadCount = (it.spreadCount || 0) + 1;
    it.lastSpreadDate = today;
    best.col.load++;
    if (oldDate !== best.col.date) changed++;
  });

  if (changed) { p.updatedAt = Date.now(); saveStore(); }
  return changed;
}

/* 当日超额分散：按优先级保留前 N 条在今天，其余分散到未来 days 天。
   - 主模式（keepRatio 未指定）：保留舒适量内的量，其余全部分散
   - 温和模式（keepRatio 指定，如 0.5）：保留当前待复习量的 keepRatio 倍，其余分散
   返回实际改动条数；若超额条目全部被防饥饿锁死，返回 0（调用方应提示用户这些不能再推）。 */
export function spreadExcessToday(p, days, keepRatio) {
  const today = todayStr();
  const due = getDueItems(p).slice();
  const cap = getComfortCap(p, today);
  let keepN;
  if (keepRatio != null && keepRatio >= 0 && keepRatio < 1) {
    keepN = Math.max(1, Math.ceil(due.length * keepRatio));
  } else {
    if (due.length <= cap) return 0;
    keepN = cap;
  }
  if (due.length <= keepN) return 0;

  due.sort(compareItemPriority);
  const keep = due.slice(0, keepN);
  const excess = due.slice(keepN);
  let changed = 0;
  keep.forEach(it => { if (it.nextReviewDate !== today) { it.nextReviewDate = today; changed++; } });
  return changed + spreadItems(p, excess, days);
}

/* 重新均匀排期所有未掌握的条目（切换到均匀模式时调用，v2 双向最佳适配） */
export function rebalanceAllItems(p) {
  const today = todayStr();
  const items = (p.items || []).filter(it =>
    !it.mastered && !it.manualMastered && it.nextReviewDate
  );
  if (!items.length) return;

  if (p.reviewMode === 'balanced') {
    // 一次性建立未来 60 天的负载表，避免 O(n²) 全表扫描
    const HORIZON = 60;
    const loadMap = new Map();
    const bump = (date, delta) => { if (date) loadMap.set(date, (loadMap.get(date) || 0) + delta); };
    items.forEach(it => bump(it.nextReviewDate, 1));
    const tomorrow = addDays(today, 1);

    // 关键修复：模式切换绝不能把"今天到期 / 已逾期"的复习推到明天，否则用户切换当天会看到
    // "没有任何复习任务"，记忆上也不安全。做法：把这些条目一律锚定到今天；若超出当日容量，
    // 交给 render 时的 autoBalanceIfNeeded（按容量+防饥饿规则）自动摊派——该留今天的（逾期太久）
    // 会被强制留下，其余均匀摊到未来。未来才到期的条目才参与错峰。
    const dueItems = items.filter(it => it.nextReviewDate <= today);
    const futureItems = items.filter(it => it.nextReviewDate > today);
    dueItems.forEach(it => {
      if (it.nextReviewDate !== today) {
        bump(it.nextReviewDate, -1);
        bump(today, 1);
        it.nextReviewDate = today;
      }
    });

    // 未来条目：一次性重排，给略宽的窗口（gap×0.5、绝对上限 21 天），允许向前借位最多 2 天，
    // 但 minDate=tomorrow，绝不把未来内容提前到今天（避免切换当天额外增加负担）
    futureItems.sort(compareItemPriority);
    futureItems.forEach(it => {
      const intervals = getItemIntervals(it, p);
      const stage = Math.min(it.stage || 0, intervals.length - 1);
      const gap = intervals[stage] || 1;
      const maxForward = Math.min(21, Math.max(3, Math.round(gap * 0.5)));
      const maxBack = Math.min(2, Math.floor(gap * 0.25));
      const oldDate = it.nextReviewDate;
      const target = findAvailableDate(p, oldDate, {
        maxForward, maxBack, minDate: tomorrow, gap, loadMap
      });
      if (target !== oldDate) {
        bump(oldDate, -1);
        bump(target, 1);
        it.nextReviewDate = target;
      }
    });
  } else {
    // 经典间隔：未到期的保持原计划；已逾期的也保持其逾期日期（经典模式下它们本来就在今日清单里，
    // 切模式不应把欠账"推到明天再补"，也不应让用户切换当天看不到任何复习任务）。
    // 经典模式不做自动摊派，逾期多少就如实显示多少，由用户按优先级尽快清。
  }
  p.lastAutoBalanceDate = null; // 模式切换后允许今天再做一次启动自动均衡
  p.updatedAt = Date.now();
  saveStore();
}

/* ============ 智能排期引擎 v2（EWMA 产能 + 星期画像 + 双向最佳适配） ============ */

/* 汇总每个自然日的"复习评价次数"（排除首次录入；用索引而非对象引用，导入/重算后依然稳健） */
export function getReviewCountsByDate(p) {
  const counts = {};
  (p.items || []).forEach(it => {
    (it.reviews || []).forEach((r, i) => {
      if (i > 0 && r.date) counts[r.date] = (counts[r.date] || 0) + 1;
    });
  });
  return counts;
}

/* 汇总每个自然日的"学习动作条数"：新学（learnedDate 每条 1 次）+ 复习评价（reviews i>0）。
   只统计复习会陷入冷启动死锁——系统每天只排几条、用户只能做几条、容量就永远停在几条；
   新学动作同样反映"你每天能处理多少条"，必须计入产能。 */
export function getActivityCountsByDate(p) {
  const counts = {};
  (p.items || []).forEach(it => {
    if (it.learnedDate) counts[it.learnedDate] = (counts[it.learnedDate] || 0) + 1;
    (it.reviews || []).forEach((r, i) => {
      if (i > 0 && r.date) counts[r.date] = (counts[r.date] || 0) + 1;
    });
  });
  return counts;
}

/* 学习日比例：近 28 个自然日里有学习动作的天数占比（clamp 到 0.35~1）。
   冷启动（不足 3 个学习日）按"天天可学"=1 处理，宁可任务略多也不把进度拖到最后。 */
export function getStudyDayRatio(p, counts) {
  counts = counts || getActivityCountsByDate(p);
  const today = todayStr();
  let active = 0;
  for (let age = 0; age < 28; age++) {
    if ((counts[addDays(today, -age)] || 0) > 0) active++;
  }
  if (active < 3) return 1;
  return Math.max(0.35, Math.min(1, active / 28));
}

/* 按期均摊下限（deadline-aware leveling）：为了让"已学但未毕业"的内容都在目标日前走完，
   从今天起每个学习日至少要处理的复习条数。
   - 这是排期容量的硬下限，防止智能容量被"低速率历史"锁死后，任务被一路摊到最后一天集中爆发；
   - 只统计已学内容的剩余复习（确定的硬需求）；未学内容由新学目标（perStudyDay）单独驱动；
   - 已在最后一轮但因模糊未毕业的，保守按"再复习 1 次"计；
   - 目标日 120 天以外不启用（远期不制造数字压力）。
   返回 { cap, need, studyDaysLeft }；无目标日或无需求时 cap=0。 */
export function getDeadlineLevelCap(p, date) {
  // 背书（封闭总量）与错题（已收录的是确定硬需求）都做"目标日前走完已学内容"的复习均摊，
  //   这是防止被低速率历史锁死、任务一路摊到最后集中爆发的硬下限；
  //   错题未来新收录的随时进来再重算；"新学均摊"只对背书（按页推进）启用，错题不按页新学。
  if (!p || (p.type !== 'recite' && p.type !== 'mistake') || !p.deadline) return { cap: 0, need: 0, studyDaysLeft: 0 };
  const today = date || todayStr();
  const daysLeft = diffDays(today, p.deadline) + 1; // 含今天
  if (daysLeft <= 0 || daysLeft > 120) return { cap: 0, need: 0, studyDaysLeft: 0 };
  const intervals = getIntervals(p);
  const totalStages = intervals.length;
  const ratio = getStudyDayRatio(p);
  const studyDaysLeft = Math.max(1, daysLeft * ratio);
  // ① 复习需求：已学未毕业内容的剩余复习轮次（均摊到目标日前的学习日）
  let reviewNeed = 0;
  let learnedItems = 0, learnedItemPages = 0;
  (p.items || []).forEach(it => {
    if (it.mastered || it.manualMastered || it.finalReviewDate || !it.learnedDate) return;
    learnedItems++;
    if (it.pageStart != null && it.pageEnd != null) learnedItemPages += Math.max(0, it.pageEnd - it.pageStart + 1);
    const stage = Math.min(it.stage || 0, totalStages - 1);
    let remain = totalStages - stage;
    if (remain < 1) remain = 1;
    reviewNeed += remain;
  });
  const reviewCap = reviewNeed / studyDaysLeft;
  // ② 新学需求：仅在新学窗口内（目标日 - 一个完整复习周期之前），把未学内容均摊到剩余新学学习日
  let newCap = 0;
  const cycleDays = getReviewCycleDays(p);
  const newLearnEnd = addDays(p.deadline, -cycleDays);
  // 新学均摊仅对背书（按页推进）；错题不按页新学、新错题随时收录，newCap 保持 0。
  if (p.type === 'recite' && (!p.deadline || today <= newLearnEnd)) {
    // 总页 / 已学页（与 getMetrics 同口径）
    let totalPages;
    if (p.unitMode && Array.isArray(p.units) && p.units.length) totalPages = countRanges(getTargetPageRanges(p));
    else if (p.bookStartPage != null && p.bookEndPage != null) totalPages = Math.max(0, p.bookEndPage - p.bookStartPage + 1);
    else totalPages = p.total;
    const learnedPages = getCompletedPages(p) || 0;
    const unlearnedPages = Math.max(0, (totalPages || 0) - learnedPages);
    if (unlearnedPages > 0) {
      // 用已学条目估算"平均每条多少页"，把未学页换算成条；无数据时按 1 条=1 页（保守偏小，容量不足再由复习级量兜底）
      const avgPages = learnedItems > 0 ? Math.max(0.5, learnedItemPages / learnedItems) : 1;
      const unlearnedItems = unlearnedPages / avgPages;
      const newWindowDays = Math.max(1, diffDays(today, newLearnEnd) + 1);
      const newStudyDays = Math.max(1, newWindowDays * ratio);
      newCap = unlearnedItems / newStudyDays;
    }
  }
  const need = reviewNeed;
  const cap = Math.ceil(reviewCap + newCap);
  return { cap, need, studyDaysLeft, newCap: Math.round(newCap * 10) / 10, reviewCap: Math.round(reviewCap * 10) / 10 };
}

/* 舒适量默认值按项目类型区分：背书单条内容量大（十几页），默认6；错题单条是一道题，默认10 */
export function defaultComfortCap(p) {
  return p && p.type === 'recite' ? 6 : 10;
}

/* 舒适量：用户希望每天最多面对多少条（背书默认6，错题默认10） */
export function getComfortCap(p) {
  return Math.max(1, Math.min(50, parseInt(p.spreadThreshold, 10) || defaultComfortCap(p)));
}

/* 舒适量智能建议：基于最近14天日均实际完成复习条数，给出推荐值
   数据不足（<2个活跃日）返回 null；建议值 clamp 在 3~15 */
export function getComfortAdvice(p) {
  if (!p || p.type === 'exercise') return null;
  const counts = getReviewCountsByDate(p);
  const today = todayStr();
  let total = 0, activeDays = 0;
  for (let age = 0; age < 14; age++) {
    const c = counts[addDays(today, -age)] || 0;
    if (c > 0) { total += c; activeDays++; }
  }
  if (activeDays < 2) return null;
  const avg = total / activeDays;
  const suggested = Math.max(3, Math.min(15, Math.round(avg * 1.2)));
  return { avg: Math.round(avg * 10) / 10, suggested, current: getComfortCap(p), activeDays };
}

/* 渲染设置页舒适量建议区域（容量透明化 + 智能建议 + 一键应用） */
export function renderComfortAdvice(p) {
  const el = document.getElementById('comfortAdvice');
  if (!el || !p || p.type === 'exercise') { if (el) el.style.display = 'none'; return; }
  // 当前舒适量优先读输入框（用户可能刚改了还没保存），其次读项目配置
  const inputEl = document.getElementById('sSpreadThreshold');
  const inputVal = inputEl ? parseInt(inputEl.value, 10) : NaN;
  const currentComfort = !isNaN(inputVal) && inputVal >= 1 ? inputVal : getComfortCap(p);
  const parts = [];
  // 容量透明化：均匀模式下显示当前智能容量估算
  // 容量透明化（仅均匀模式）：区分"积压追赶"与"日常节奏"两种状态
  const cu = getBacklogCatchUp(p);
  const backlogHeavy = p.reviewMode === 'balanced' && cu.backlog > currentComfort;
  if (p.reviewMode === 'balanced') {
    const cap = getDailyCapacity(p);
    const daily = Math.min(cap, currentComfort);
    if (backlogHeavy) {
      const clearDays = Math.ceil(cu.backlog / Math.max(1, daily));
      parts.push(`<div style="margin-bottom:6px">📊 当前有 <b>${cu.backlog}</b> 条到期/逾期，系统正按每天 <b>${daily}</b> 条安排，约 <b>${clearDays}</b> 天清完；每天的量不会超过你的舒适量，不会被一次性压垮。</div>`);
    } else {
      const bottleneck = currentComfort < cap ? '舒适量是当前瓶颈' : '容量在控制排题，舒适量是安全上限';
      parts.push(`<div style="margin-bottom:6px">📊 当前智能容量约 <b>${cap}</b> 条/天，实际每日排题 = min(${cap}, ${currentComfort})，${bottleneck}。</div>`);
    }
  }
  // 智能建议：积压较重时不再按"近期完成量"建议下调（越积压越压容量会形成死循环），改为提速引导
  const advice = getComfortAdvice(p);
  if (backlogHeavy) {
    parts.push(`<div style="color:#d97706">💡 有较多积压时，系统已在你的舒适量范围内自动提速。保持当前舒适量即可，每天完成一点就能稳步清完；若想更快，可把舒适量小幅上调 1~2 条试试。</div>`);
  } else if (advice) {
    advice.current = currentComfort;
    const diff = advice.suggested - advice.current;
    let tag = '';
    if (Math.abs(diff) <= 1) tag = '<span style="color:#16a34a">当前设置合理</span>';
    else if (diff > 0) tag = `<span style="color:#d97706">建议上调</span>`;
    else tag = `<span style="color:#dc2626">建议下调</span>`;
    parts.push(`<div style="margin-bottom:6px">💡 你最近14天（${advice.activeDays}个学习日）日均完成 <b>${advice.avg}</b> 条复习，建议舒适量设为 <b>${advice.suggested}</b> 条。${tag}</div>`);
    if (Math.abs(diff) > 1) {
      parts.push(`<button type="button" class="ghost-btn" id="btnApplyComfortAdvice" style="padding:5px 12px;font-size:12px;margin-top:2px">一键应用建议（${advice.suggested}条）</button>`);
    }
  } else {
    parts.push(`<div style="color:var(--muted)">💡 再积累几天复习数据后，这里会根据你的实际节奏给出舒适量建议。</div>`);
  }
  el.innerHTML = parts.join('');
  el.style.display = 'block';
  const btn = document.getElementById('btnApplyComfortAdvice');
  if (btn) {
    btn.addEventListener('click', () => {
      const advice = getComfortAdvice(p);
      if (advice) {
        document.getElementById('sSpreadThreshold').value = advice.suggested;
        updateSpreadPressureHint();
        updatePressurePanel();
        renderComfortAdvice(p);
        showToast('✅', '已应用建议', `舒适量已设为 ${advice.suggested} 条，保存后生效。`, 3000);
      }
    });
  }
}

/* 手动/自动分散时，未来某天的每日排期上限
   - 经典间隔/严格容量：只看舒适量
   - 固定容量（用户显式设了每天 N 条）：尊重用户，min(舒适量, N)
   - 智能容量：按期均摊主导，允许抬到"为在目标日前完成所需"的量（可能高于默认舒适量），
     这样任务会被均匀摊开，而不是被舒适量锁死、最后一天集中爆发；
     当所需量明显高于舒适量时，由状态卡给出"一键后移目标/缩小范围"的温和选项，不强迫用户改设置。 */
export function getSpreadDayCap(p, date) {
  const comfort = getComfortCap(p);
  if (p.reviewMode !== 'balanced') return comfort;
  if (p.dailyCapacity === 0) return comfort;
  if (p.dailyCapacity != null) return Math.max(1, Math.min(comfort, Math.round(p.dailyCapacity)));
  const cap = getDailyCapacity(p, date);
  if (cap <= 0) return comfort;
  // 今天：到期/逾期的是"已经该面对"的硬需求，只要在舒适量内就全部保留——
  //   不被"近期完成少"压出的低容量推走（否则今天莫名只剩几条、反而越堆越多，是死锁的根源）；
  //   背书为赶目标日所需若高于舒适量，今天也排得下。
  const isToday = !date || date === todayStr();
  if (isToday) return Math.max(comfort, cap);
  // 未来日子：作为摊派目标按个人节奏接收——
  //   错题走"前紧后松"目标（前期略多、为后期新增预留，后期回落，硬上限封顶不焦虑）；
  //   背书封闭总量、有硬截止，允许抬到按期所需的量，可行性由状态卡/风险横幅单独、温和提示。
  if (p.type === 'mistake') return getMistakeDayPlan(p, date).target;
  return Math.max(1, Math.min(50, cap));
}

/* 积压追赶信息：今天及以前到期、尚未掌握的内容量（backlog），
   以及"按约一周清完"所需的每日下限（need）、理论消化天数（catchDays）。
   背书单条耗时长，给 10 天；错题单题量小，给 7 天。供容量算法与设置页文案共用同一口径。 */
export function getBacklogCatchUp(p) {
  if (!p || p.type === 'exercise') return { backlog: 0, catchDays: 0, need: 0, days: null };
  const backlog = getDueItems(p).length;
  const catchDays = p.type === 'recite' ? 10 : 7;
  const need = backlog > 0 ? Math.ceil(backlog / catchDays) : 0;
  return { backlog, catchDays, need, days: need > 0 ? catchDays : null };
}

/* 获取某一天的排期容量（均匀模式每天最多安排多少条）
   - 固定值：直接返回（0 = 严格按间隔，不自动错峰）
   - 智能：取三者的较大者——「节奏容量」「积压追赶」「按期均摊」，再用星期画像只上抬：
     · 节奏容量 = 近 28 天"新学+复习"动作速率的 EWMA（半衰期 14 天），中性反映真实节奏；
       计入新学动作是关键，否则会陷入"系统每天只排几条→只能做几条→容量永远停在低位"的死锁。
     · 冷启动（活跃日<3）给适中值（背书4、错题5），不再低到2/3；能学多的人很快被抬升，
       一条很重的人由真实速率回落。
     · 按期均摊 = 已学内容为在目标日前走完所需的每日下限，这是硬约束，绝不被舒适量锁死。
   智能模式不用舒适量硬封顶（否则按期所需一旦超过舒适量，任务会被压到最后一天集中爆发）；
   是否"超出舒适量、需要调整范围或目标日"由状态卡的可行性判断单独、温和地提示。 */
export function getDailyCapacity(p, date) {
  if (p.dailyCapacity != null) return Math.max(0, Math.round(p.dailyCapacity));
  const today = todayStr();
  const counts = getActivityCountsByDate(p);

  // 28 天 EWMA 速率（自然日口径，含新学与复习）
  const HALF = 14, WIN = 28;
  let wSum = 0, cwSum = 0, activeDays = 0;
  for (let age = 0; age < WIN; age++) {
    const d = addDays(today, -age);
    const c = counts[d] || 0;
    const w = Math.pow(2, -age / HALF);
    wSum += w; cwSum += c * w;
    if (c > 0) activeDays++;
  }
  let rateCap;
  if (activeDays < 3) {
    // 冷启动：适中节奏，不做星期画像。
    rateCap = p.type === 'recite' ? 4 : 5;
  } else {
    // 先验速率按类型区分，随学习日数快速让位于个人真实节奏（能学多的人约 5 个学习日后就按其速率）。
    const K0 = p.type === 'recite' ? 5 : 8;
    const K = Math.max(0, K0 - Math.min(activeDays, K0));
    const PRIOR = p.type === 'recite' ? 4 : 6;
    const baseRate = (cwSum + PRIOR * K) / (wSum + K);
    rateCap = Math.max(1, Math.round(baseRate));
  }
  let cap = rateCap;

  // 积压追赶：今天及以前到期的未掌握内容，需要在约一周内清完的每日下限。
  if (p.type !== 'exercise') {
    const cu = getBacklogCatchUp(p);
    if (cu.need > cap) cap = cu.need;
  }

  // 按期均摊硬下限：已学内容必须在目标日前走完（不被低速率锁死后摊到最后）。
  if (p.type !== 'exercise') {
    const lv = getDeadlineLevelCap(p, date || today);
    if (lv.cap > cap) cap = lv.cap;
  }

  // 星期画像只用于"抬高"符合你习惯的日子（如周末更有空）
  if (date && activeDays >= 3) {
    const dowCap = getWeekdayAwareCap(p, date, counts, activeDays);
    if (dowCap > cap) cap = dowCap;
  }

  // 下限至少 1，绝对硬顶 50（防异常数据）；智能模式不以舒适量硬封顶。
  return Math.max(1, Math.min(50, Math.round(cap)));
}


/* 指定日期的容量：在全局 EWMA 速率基础上，用"该星期几"的历史速率做收缩估计
   （贝叶斯 shrinkage：样本越少越向全局靠拢），窗口 56 天、半衰期 28 天。 */
export function getWeekdayAwareCap(p, date, counts, activeDays) {
  const dow = new Date(date + 'T00:00:00').getDay();
  const HALF = 28, WIN = 56;
  let gW = 0, gCW = 0;
  const agg = { w: 0, cw: 0, n: 0 };
  for (let age = 0; age < WIN; age++) {
    const d = addDays(todayStr(), -age);
    const c = counts[d] || 0;
    const w = Math.pow(2, -age / HALF);
    gW += w; gCW += c * w;
    if (new Date(d + 'T00:00:00').getDay() === dow) {
      agg.w += w; agg.cw += c * w;
      if (c > 0) agg.n++;
    }
  }
  if (agg.n < 2 || agg.w <= 0) {
    // 该星期几样本不足：回退到全局 28 天口径（冷启动已在外层处理）
    return Math.max(1, Math.round((gCW / gW) * 0.9));
  }
  const globalRate = gCW / gW;
  const dowRate = agg.cw / agg.w;
  const shrink = agg.n / (agg.n + 4); // n=2→0.33, n=4→0.5, n=8→0.67
  const rate = shrink * dowRate + (1 - shrink) * globalRate;
  return Math.max(1, Math.min(30, Math.round(rate * 0.9)));
}

/* 查询某一天已排的复习量（不含已掌握的）；可传负载表用于批量排期 */
export function getReviewLoadOnDate(p, date, loadMap) {
  if (loadMap) return loadMap.get(date) || 0;
  return (p.items || []).filter(it =>
    !it.mastered && !it.manualMastered && it.nextReviewDate === date
  ).length;
}

/* 更新设置页的压力评估面板 */
export function updatePressurePanel() {
  const p = store.projects[editingProjectId];
  if (!p || p.type !== 'mistake') return;
  const panel = $('#pressurePanel');
  if (!panel || panel.hidden) return;

  // 用舒适量（spreadThreshold）判断超量，和复习区横幅一致
  const thVal = parseInt($('#sSpreadThreshold').value, 10);
  const threshold = isNaN(thVal) ? 10 : Math.max(1, Math.min(50, thVal));
  // 排期容量（仅均匀模式下有意义，用于自动错峰）
  let scheduleCap;
  if ($('#sCapacityMode').value === 'fixed') {
    const v = parseInt($('#sCapacityFixed').value, 10);
    scheduleCap = isNaN(v) ? 0 : Math.max(0, Math.min(50, v));
  } else {
    scheduleCap = getDailyCapacity(p);
  }
  // 系统推荐：容量是已留过 10% 余量的保守估计，舒适量再取其 80%；积压重时不建议下调
  const capForRec = getDailyCapacity(p);
  const backlogHeavyRec = getBacklogCatchUp(p).backlog > threshold;
  let recTxt = '';
  if (capForRec > 0) {
    if (backlogHeavyRec) {
      recTxt = `当前有较多到期/逾期内容，系统正以你的舒适量满负荷安排（每天约 ${Math.min(capForRec, threshold)} 道、不会超出 ${threshold}）。保持现状即可稳步清完，若想更快可小幅上调舒适量，不建议下调。`;
    } else {
      const recThreshold = Math.max(3, Math.round(capForRec * 0.8));
      recTxt = `每日复习容量当前约 ${capForRec} 道，与舒适量取较小值决定实际每日排题量；建议舒适量设为约 ${recThreshold} 道，与容量相近。`;
    }
  }

  // 计算未来7天负载
  const today = todayStr();
  const days = [];
  let maxLoad = 0;
  let overDays = 0;
  let totalLoad = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const load = getReviewLoadOnDate(p, d);
    days.push({ date: d, load, label: i === 0 ? '今' : (i === 1 ? '明' : `+${i}`) });
    if (load > maxLoad) maxLoad = load;
    if (load > threshold) overDays++;
    totalLoad += load;
  }

  // 渲染柱状图
  const barsHtml = days.map(d => {
    const h = maxLoad > 0 ? Math.max(6, (d.load / maxLoad) * 36) : 6;
    const over = d.load > threshold;
    const color = over ? '#e3a0a4' : (d.load > 0 ? '#2e6b4f' : '#e8dfd0');
    return `<div class="pressure-bar">
      <div class="pressure-bar-fill" style="height:${h}px;background:${color}" title="${d.date}: ${d.load}道"></div>
      <span class="pressure-bar-label">${d.label}</span>
    </div>`;
  }).join('');
  $('#pressureBars').innerHTML = barsHtml;

  // 压力等级（基于舒适量）
  const avg = totalLoad / 7;
  let level, levelCls, hint;
  if (overDays === 0 && avg <= threshold * 0.6) {
    level = '轻松'; levelCls = 'pressure-ok';
    hint = `舒适量 ${threshold} 道/天，未来7天无超量，平均每天 ${avg.toFixed(1)} 道。${recTxt}`;
  } else if (overDays === 0) {
    level = '适中'; levelCls = 'pressure-ok';
    hint = `舒适量 ${threshold} 道/天，未来7天无超量，平均每天 ${avg.toFixed(1)} 道。${recTxt}`;
  } else if (overDays <= 2) {
    level = '偏紧'; levelCls = 'pressure-high';
    hint = `舒适量 ${threshold} 道/天，未来7天有 ${overDays} 天超量（红色柱），平均每天 ${avg.toFixed(1)} 道。可用复习区横幅的「分散到未来」把部分内容摊开；如果你每天确实能多做，也可调高舒适量。${recTxt}`;
  } else {
    level = '过载'; levelCls = 'pressure-over';
    hint = `舒适量 ${threshold} 道/天，未来7天有 ${overDays} 天超量（红色柱），平均每天 ${avg.toFixed(1)} 道。建议先用「分散到未来」摊开逾期内容，再考虑调高每日容量；硬扛容易再次堆积。${recTxt}`;
  }
  if (scheduleCap === 0) {
    hint += ' 排期容量设为0：不自动错峰，严格按间隔提醒。';
  }
  const levelEl = $('#pressureLevel');
  levelEl.textContent = level;
  levelEl.className = 'pressure-tag ' + levelCls;
  $('#pressureHint').textContent = hint;
}

/* 更新分散阈值的实时提示 */
export function updateSpreadPressureHint() {
  const p = store.projects[editingProjectId];
  if (!p) return;
  const hintEl = $('#spreadPressureHint');
  if (!hintEl || hintEl.closest('[hidden]')) return;

  const th = parseInt($('#sSpreadThreshold').value, 10);
  const threshold = isNaN(th) ? 5 : Math.max(1, Math.min(50, th));
  const due = getDueItems(p).length;
  const overdue = getOverdueItems(p).length;

  let msg;
  if (due > threshold) {
    msg = `⚠️ 今天有 ${due} 道待复习（含 ${overdue} 道逾期），已超过你设的舒适量 ${threshold}。保存后复习区会出现「分散到未来」按钮。`;
  } else if (due > 0) {
    msg = `✅ 今天有 ${due} 道待复习，在舒适量 ${threshold} 以内，可以从容完成。`;
  } else {
    msg = `今天暂无待复习。设为 ${threshold} 意味着超过 ${threshold} 道时会提示你分散。`;
  }

  // 系统推荐：积压重时以舒适量满负荷消化、不建议下调；平时按容量的 80% 建议
  const cap = getDailyCapacity(p);
  if (cap > 0) {
    if (due > threshold) {
      msg += ` 当前有较多到期/逾期内容，系统正按每天最多 ${Math.min(cap, threshold)} 道（不超过舒适量）安排，稳步清完即可；想更快可小幅上调舒适量，不建议下调。`;
    } else {
      const rec = Math.max(3, Math.round(cap * 0.8));
      msg += ` 每日复习容量当前约 ${cap} 道，与舒适量取较小值决定实际每日排题量；建议舒适量设为约 ${rec} 道，与容量相近。`;
    }
  }

  hintEl.textContent = msg;
}

/* 活动日集合（比"完成日"更宽：收录、复习、攻克、刷题打卡都算"今天学了"）。
   专用于连续打卡、启动鼓励、中断检测这类"有没有在学"的判断；
   产能与 ETA 仍按 getMetrics 的实际完成口径，两者不混用。 */
export function getActivityDateSet(p) {
  const set = new Set();
  (p.items || []).forEach(it => {
    if (it.learnedDate) set.add(it.learnedDate);
    if (it.masteredDate) set.add(it.masteredDate);
    (it.reviews || []).forEach((r, i) => {
      if (r.date && i > 0) set.add(r.date); // i=0 是首次录入，已由 learnedDate 覆盖
    });
  });
  if (p.type === 'exercise') {
    (p.records || []).forEach(r => { if (r.date) set.add(r.date); });
  }
  return set;
}

/* 活动日总数 + 当前连续活动天数（今天学了从今天算，否则从昨天算，不因今天尚未学就清零） */
export function getActivityStreak(p, t) {
  t = t || todayStr();
  const set = getActivityDateSet(p);
  let streak = 0;
  let cursor = set.has(t) ? t : addDays(t, -1);
  while (set.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
  // 当前连续段最早那天距今天数（今天学了从 streak-1，否则从 streak）
  const curStartAge = set.has(t) ? Math.max(0, streak - 1) : streak;
  // 历史最长连续（只统计当前段之前的 60 天，避免把当前段算成"历史纪录"）
  let priorLongest = 0, run = 0;
  for (let age = 59; age > curStartAge; age--) {
    const d = addDays(t, -age);
    if (set.has(d)) { run++; priorLongest = Math.max(priorLongest, run); }
    else run = 0;
  }
  // 上一个活动日（不含今天），用于回归/中断判断
  let prev = null;
  set.forEach(d => { if (d < t && (!prev || d > prev)) prev = d; });
  return { activeDays: set.size, streak, priorLongest, prevDate: prev };
}

/* 摆烂检测：计算连续未复习天数（不含今天），返回 {days, lastReviewDate} */
export function getLazyInfo(p) {
  const activeDates = getActivityDateSet(p);
  if (!activeDates.size) return { days: 0, lastReviewDate: null }; // 从未活跃，不触发摆烂提醒
  const today = todayStr();
  let last = null;
  activeDates.forEach(d => { if (!last || d > last) last = d; });
  if (!last) return { days: 0, lastReviewDate: null };
  const days = diffDays(last, today);
  return { days: Math.max(0, days), lastReviewDate: last };
}

/* 因材施教的中断提醒：按"中断天数梯度 × 项目类型"差异化
   轻度(3-4天)轻推+最小行动；中度(5-7天)自我关怀、强调捡起来比从零快；
   长期(8天+)降低重启门槛、必要时引导调目标，避免"干脆放弃"。绝不制造内疚。 */
export function getLazyMessage(p, m, lazy) {
  const days = lazy.days;
  const u = unitName(p);
  const verb = p.type === 'exercise' ? '推进' : '复习';
  let head = `😴 你已经连续 ${days} 天没${verb}了`;
  if (lazy.lastReviewDate) head += `（上次${verb} ${fmtCN(lazy.lastReviewDate)}）`;
  head += '。';

  // 最小启动量：行为激活，先做一个"一定能完成"的小动作
  const micro = p.type === 'exercise'
    ? `今天先推进 1 ${u}，把节奏找回来就好。`
    : `今天只复习 1 条，记忆会很快接上。`;

  // 按模式的核心提醒
  let modeLine;
  if (p.type === 'mistake') {
    const overdue = getOverdueItems(p).length;
    modeLine = overdue > 0
      ? `目前有 ${overdue} 道逾期，不用一次清完，先从最久没复习的那条开始。`
      : '错题靠间隔滚动，停几天后它们会更早地回到队列，正好趁现在接上。';
  } else if (p.type === 'recite') {
    modeLine = '背诵间隔一拉长，之前的记忆会变模糊，今天复习一条就能把它重新激活。';
  } else {
    modeLine = '进度不会因为停几天就清零，今天往前推一点点，节奏就回来了。';
  }

  if (days <= 4) {
    return head + modeLine + micro;
  }
  if (days <= 7) {
    return head + '断几天很正常，不用有负罪感——之前学的都还在，捡起来比从零开始快得多。' + modeLine + micro;
  }
  // 长期：明确"不需要补回欠下的，只需今天重新开始"；目标不现实时引导调整
  const recal = (m && m.feasibility === 'impossible')
    ? '如果最近目标确实太满，看看状态卡的建议，把截止日或每日目标调到够得着，比硬扛更重要。'
    : '不用去补落下的量，把今天的目标定小一点，让"重新开始"足够容易。';
  return head + '停得久了，最容易想"干脆放弃"——但你不需要补回欠下的，只需今天重新迈出第一步。' + recal + micro;
}

/* 双向最佳适配找空位（v2）
   在 [baseDate-maxBack, baseDate+maxForward]（且不早于 minDate）窗口内：
   1) 优先选"负载/容量比 < 1"中相对最空的日子，并列取离 baseDate 最近、再并列取更早（记忆更安全）
   2) 窗口全满时，继续向后逐日扩展搜索（最多再找 14 天），优先把批量录入摊到更远的空位
   3) 扩展后仍全满，才在原窗口内选相对负载最低的日子（有界超量，保证不无限顺延）
   opts: { maxForward, maxBack=0, minDate=null, gap, loadMap=null, maxExtend=14 }
   容量为 0（严格模式）时直接返回 baseDate。 */
export function findAvailableDate(p, baseDate, opts) {
  if (typeof opts === 'number') opts = { maxForward: opts }; // 兼容旧签名 (p, base, maxOffset)
  opts = opts || {};
  const maxForward = Math.max(0, opts.maxForward != null ? opts.maxForward : 1);
  const maxBack = Math.max(0, opts.maxBack || 0);
  const minDate = opts.minDate;
  const maxExtend = opts.maxExtend != null ? Math.max(0, opts.maxExtend) : 14;

  let start = addDays(baseDate, -maxBack);
  const end = addDays(baseDate, maxForward);
  if (minDate && start < minDate) start = minDate;

  const consider = (d, best) => {
    const cap = getDailyCapacity(p, d);
    if (cap <= 0) return { strict: true }; // 严格模式：不错峰
    const load = getReviewLoadOnDate(p, d, opts.loadMap);
    const ratio = load / cap;
    const offset = diffDays(baseDate, d); // 负=提前，正=顺延
    const absOff = Math.abs(offset);
    if (ratio < 1) {
      if (!best.found
        || ratio < best.found.ratio - 1e-9
        || (Math.abs(ratio - best.found.ratio) < 1e-9 && absOff < best.found.absOff)
        || (Math.abs(ratio - best.found.ratio) < 1e-9 && absOff === best.found.absOff && offset < best.found.offset)) {
        best.found = { d, ratio, absOff, offset };
      }
    }
    if (!best.fallback
      || ratio < best.fallback.ratio - 1e-9
      || (Math.abs(ratio - best.fallback.ratio) < 1e-9 && offset > best.fallback.offset)) {
      best.fallback = { d, ratio, offset };
    }
    return best;
  };

  const acc = { found: null, fallback: null };
  for (let d = start; ; d = addDays(d, 1)) {
    const r = consider(d, acc);
    if (r && r.strict) return baseDate;
    if (d >= end) break;
  }
  if (acc.found) return acc.found.d;

  // 窗口全满：向后扩展（默认14天；早期复习调用方会传更短的 maxExtend，保证首次复习不被推到太远）寻找真正的空位
  const outerEnd = addDays(end, maxExtend);
  for (let d = addDays(end, 1); d <= outerEnd; d = addDays(d, 1)) {
    const cap = getDailyCapacity(p, d);
    if (cap <= 0) break;
    const load = getReviewLoadOnDate(p, d, opts.loadMap);
    if (load < cap) return d;
  }
  // 扩展仍满：在原窗口内有界超量
  return (acc.fallback || { d: baseDate }).d;
}

/* 智能排期：根据模式计算下次复习日期
   - classic：严格按间隔
   - balanced：以间隔为基础，在容量约束下双向错峰；顺延窗口随间隔收窄（后期不再被推 +50%） */
export function scheduleNextReview(p, item, baseDate, stage, gapOverride) {
  const intervals = getItemIntervals(item, p);
  const st = Math.min(stage != null ? stage : (item.stage || 0), intervals.length - 1);
  let gap = gapOverride || intervals[st] || intervals[0] || 1;
  // 提前复习过的条目，间隔缩短15%（主动提前复习说明需要多巩固）
  if (item.earlyReviewed) gap = Math.max(1, Math.round(gap * 0.85));

  // 背书本冲刺期（距考试不足一个完整复习周期）：
  // 1) 任何复习都不能被排到考试之后（否则模糊条目会因间隔×1.3 越拉越长，等于考前不再复习）；
  // 2) "模糊/忘记"的内容要在考前高频复现（2~3 天内再见），"记得"的也保证考前再见到至少一次。
  let sprintClamp = null;
  let sprintTail = false; // 冲刺最后 7 天：把复习均匀撒到剩余所有天，而非堆到目标日
  let sprintFinal = false; // 已完成"考前最后一遍"，不再排到目标日
  if (p.type === 'recite' && p.deadline) {
    const d2d = diffDays(baseDate, p.deadline);
    if (d2d >= 0 && d2d <= getReviewCycleDays(p)) {
      const lastQ = item.reviews && item.reviews.length ? item.reviews[item.reviews.length - 1].quality : null;
      const capGap = (d2d === 0) ? 1
        : (lastQ === 'good') ? Math.max(1, Math.min(d2d, Math.round(d2d * 0.6)))
        : Math.max(1, Math.min(3, d2d));
      gap = Math.min(gap, capGap);
      sprintClamp = d2d; // 错峰扩展也不得越过目标日
      if (d2d <= 7) {
        sprintTail = true;
        // 非"记得"的内容（模糊/忘记），若按间隔下次再见已落到目标日当天或之后，
        // 这次就作为考前最后一遍（再排只会在目标日堆积），记录并把下次放在目标日之后。
        if (lastQ !== 'good' && addDays(baseDate, gap) >= p.deadline) sprintFinal = true;
      }
    }
  }
  if (sprintFinal) {
    item.finalReviewDate = baseDate;
    return addDays(p.deadline, 1);
  }

  const base = addDays(baseDate, gap);
  if (p.reviewMode === 'balanced' && p.type !== 'exercise') {
    let maxForward, maxBack, maxExtend;
    if (sprintTail) {
      // 冲刺最后 7 天：在 [明天, 目标日] 全范围内找负载最低的一天，把本条均匀撒开，
      // 避免 fuzzy/forgot 条目每次都排到"今天+1~3天"、最后在目标日集中爆发。
      maxBack = 1; // start 被 minDate 抬到"明天"
      maxForward = Math.max(0, sprintClamp - gap); // end ≈ 目标日
      maxExtend = 0;
    } else {
      // 错题本与背书本在均匀模式下都做即时错峰（背书单条内容可多可少，错峰窗口仍按当前间隔自适应，避免某天扎堆）
      maxForward = Math.max(1, Math.round(gap * 0.25));
      maxBack = Math.min(2, Math.floor(gap * 0.25));
      // 早期复习（间隔≤2天，尤其是刚学的首次复习）是记忆最关键的窗口：即使当天批量录入，
      // 也只允许在近几天内错峰，绝不把"本应明天复习"的内容一路推到十几天后（那会拖垮整体毕业节奏）。
      maxExtend = gap <= 2 ? 3 : 14;
      if (sprintClamp != null) maxExtend = Math.min(maxExtend, sprintClamp);
    }
    let d = findAvailableDate(p, base, {
      maxForward, maxBack, minDate: addDays(baseDate, 1), gap, maxExtend
    });
    // 冲刺期硬上限：错峰后仍不得越过目标日
    if (p.deadline && d > p.deadline) d = p.deadline;
    return d;
  }
  if (p.deadline && base > p.deadline) return p.deadline;
  return base;
}

/* 背书本冲刺重排：进入冲刺期（距目标日不足一个完整复习周期）后，做一次"全窗口负载均衡"。
   处理两类会造成考前扎堆/沉睡的内容：
   ① 下次复习为空或已被排到目标日之后的条目（尤其全 fuzzy 用户，间隔×1.3 容易越界沉睡）；
   ② 未来某天（尤其目标日当天）排期超过当日容量的溢出条目。
   把它们按"薄弱者优先、顺序填入最早未饱和日"的方式，均匀分摊到 [明天, 目标日]，
   每天不超过当日容量，避免最后一天集中爆发。对 classic / balanced 都生效。
   今天的条目不动（今天该复习的今天做）；只改 nextReviewDate，不删数据、不强制毕业。 */
export function rebalanceForSprint(p) {
  if (!p || p.type !== 'recite' || !p.deadline) return 0;
  const today = todayStr();
  const d2d = diffDays(today, p.deadline);
  if (d2d < 0 || d2d > getReviewCycleDays(p)) return 0;

  const live = (p.items || []).filter(it => !it.mastered && !it.manualMastered && !it.finalReviewDate);
  const capOf = d => (p.reviewMode === 'balanced') ? getSpreadDayCap(p, d) : getComfortCap(p);

  // 负载表
  const loadMap = new Map();
  live.forEach(it => {
    if (it.nextReviewDate) loadMap.set(it.nextReviewDate, (loadMap.get(it.nextReviewDate) || 0) + 1);
  });

  // 候选①：无日期 / 越界到目标日之后
  const toMove = live.filter(it => !it.nextReviewDate || it.nextReviewDate > p.deadline);
  const moveIds = new Set(toMove.map(it => it.id));

  // 候选②：未来某天（不含今天）超容量的溢出
  const buckets = {};
  live.forEach(it => {
    const d = it.nextReviewDate;
    if (d && d > today && d <= p.deadline) (buckets[d] = buckets[d] || []).push(it);
  });
  Object.keys(buckets).sort().forEach(d => {
    const arr = buckets[d].slice().sort(compareItemPriority); // 优先级高者在前（更该保留在近期）
    const cap = capOf(d);
    if (arr.length > cap) {
      arr.slice(cap).forEach(it => {
        if (!moveIds.has(it.id)) { moveIds.add(it.id); toMove.push(it); }
      });
    }
  });
  if (!toMove.length) return 0;

  // 从负载表移除待移动条目的占位
  toMove.forEach(it => {
    const d = it.nextReviewDate;
    if (d && loadMap.has(d)) loadMap.set(d, loadMap.get(d) - 1);
  });

  // 未来日期列表（今天不动）
  const dayList = [];
  for (let d = addDays(today, 1); d <= p.deadline; d = addDays(d, 1)) dayList.push(d);

  // 薄弱者优先，顺序填入最早未饱和日（全满则选相对最空日，均摊而非堆到目标日）
  toMove.sort(compareItemPriority);
  let moved = 0;
  toMove.forEach(it => {
    let bestD = null;
    for (const d of dayList) {
      if ((loadMap.get(d) || 0) < capOf(d)) { bestD = d; break; } // 最早未饱和
    }
    if (!bestD) {
      let bestRatio = Infinity;
      for (const d of dayList) {
        const ratio = (loadMap.get(d) || 0) / Math.max(1, capOf(d));
        if (ratio < bestRatio - 1e-9) { bestRatio = ratio; bestD = d; }
      }
    }
    if (!bestD) bestD = p.deadline;
    it.nextReviewDate = bestD;
    it.spreadCount = (it.spreadCount || 0) + 1;
    it.lastSpreadDate = today;
    loadMap.set(bestD, (loadMap.get(bestD) || 0) + 1);
    moved++;
  });
  return moved;
}

/* 启动自动均衡：均匀模式下，今天待复习超过当日容量时，
   自动把优先级最低的超额条目摊到未来若干天。
   v10 修正：不再"每天只跑一次"（旧逻辑用 lastAutoBalanceDate 硬幂等，会导致
   当天首次均衡之后又新增到期——批量录入、补录、复习"又错了"等——再也无法被摊派，
   今天越堆越多）。改为"按超额触发、收敛即停"：
   - 今天到期量 ≤ 当日容量：天然收敛，不动作、不写盘；
   - 超出容量：只摊走真正超出的部分，摊完 today 回到容量内即停；
   - 防饥饿（逾期太久，canBeSpread=false）的条目强制留今天，宁可今天多做也不继续后推；
   - spreadItems 内每条最多被摊 3 次（canBeSpread），不会无限推、也不会与用户复习操作冲突。 */
/* ===== 错题"前紧后松"排期 =====
   错题动态增长、后期可能集中收录。系统在前期主动多排、提前消化，给后期留空间；
   后期每日量平滑回落、设硬上限，不堆量、不制造焦虑。 */

// 历史收录速率（条/自然日；近28天为主，数据少时用全周期平均）
export function getMistakeCollectRate(p) {
  const today = todayStr();
  const learned = (p.items || []).map(it => it.learnedDate).filter(Boolean).sort();
  if (!learned.length) return 0;
  const recent = learned.filter(d => d >= addDays(today, -27));
  if (recent.length >= 2) return recent.length / 28;
  const span = Math.max(1, diffDays(learned[0], today) + 1);
  return learned.length / span;
}

// 某天的"前紧后松"目标量 / 硬上限 / 是否吃紧
export function getMistakeDayPlan(p, date) {
  const d = date || todayStr();
  const dl = getDeadlineLevelCap(p, d);
  const base = dl.cap || 0;                    // 已学内容按期走完所需（硬下限）
  let addon = 0;
  if (p.deadline) {
    const daysLeft = diffDays(d, p.deadline) + 1;
    if (daysLeft > 0) {
      const rate = getMistakeCollectRate(p);
      const predictedNew = Math.max(0, rate * Math.max(0, daysLeft - 1)); // 今天之后预计新增
      const studyDays = Math.max(1, daysLeft * getStudyDayRatio(p));
      addon = predictedNew / studyDays;       // 为未来新题保底复习，提前均摊（前期多、后期衰减）
    }
  }
  const comfort = getComfortCap(p);
  const hardMax = Math.min(20, Math.max(12, Math.round(comfort * 1.5)));
  let raw = base + addon;
  const target = Math.max(1, Math.min(hardMax, Math.ceil(raw)));
  return { target, raw, base, addon, hardMax, risk: raw > hardMax };
}

// 全局可行性：预测总复习工作量 vs 剩余时间的舒适/最大容量，提前判断是否会完不成
export function getMistakeFeasibility(p) {
  if (!p || p.type !== 'mistake' || !p.deadline) return { level: 'ok' };
  const today = todayStr();
  if (p.deadline <= today) return { level: 'ok' };
  const daysLeft = diffDays(today, p.deadline) + 1;
  if (daysLeft > 120) return { level: 'ok' };
  const studyDays = Math.max(1, daysLeft * getStudyDayRatio(p));
  const iv = getIntervals(p), N = iv.length;
  let remainRounds = 0;
  (p.items || []).forEach(it => {
    if (it.mastered || it.manualMastered || it.finalReviewDate || !it.learnedDate) return;
    remainRounds += Math.max(1, N - (it.stage || 0));
  });
  const predictedNew = Math.max(0, getMistakeCollectRate(p) * Math.max(0, daysLeft - 1)); // 保底1轮
  const work = remainRounds + predictedNew;
  const comfort = getComfortCap(p);
  const hardMax = Math.min(20, Math.max(12, Math.round(comfort * 1.5)));
  let level = 'ok';
  if (work > studyDays * hardMax) level = 'risk';
  else if (work > studyDays * comfort) level = 'tight';
  return { level, work: Math.round(work), daysLeft, comfort, hardMax };
}

// 主动提前复习：当天第一次进入错题本时，若今日到期少于前期目标，把"近期将到期、薄弱优先"的题提前到今天。
// 一天只检查一次（无论是否拉题），避免用户做完一题后被反复补拉，观感不好。
export function pullForwardIfNeeded(p) {
  if (!p || p.type !== 'mistake' || !p.deadline) return 0;
  const today = todayStr();
  if (p.todayMetDate === today) return 0; // 今天已达标，不再加题
  if (p.lastPullForwardDate === today || p.deadline < today) return 0; // 今天已检查过，不再重复
  // 仅"均匀分布"模式主动提前；经典间隔是用户主动选择的严格节奏，不自动加量
  if (p.reviewMode !== 'balanced' || p.dailyCapacity === 0) return 0;

  // 无论本次是否真的拉题，都记下今天已检查过（关键：避免做题后反复补拉）
  p.lastPullForwardDate = today;
  p.updatedAt = Date.now();

  const plan = getMistakeDayPlan(p, today);
  let want = plan.target - getDueItems(p).length;
  if (want <= 0) return 0; // 今天够目标，不加

  const horizon = addDays(today, 14);
  let cands = (p.items || []).filter(it =>
    !it.mastered && !it.manualMastered && it.nextReviewDate &&
    it.nextReviewDate > today && it.nextReviewDate <= horizon);
  cands.sort((a, b) => {
    const sa = getItemScore(a) ?? 0.5, sb = getItemScore(b) ?? 0.5;
    if (sa !== sb) return sa - sb;
    if (a.nextReviewDate !== b.nextReviewDate) return a.nextReviewDate < b.nextReviewDate ? -1 : 1;
    return (a.stage || 0) - (b.stage || 0);
  });
  let pulled = 0;
  for (const it of cands) { if (pulled >= want) break; it.nextReviewDate = today; it.earlyReviewed = true; pulled++; }
  return pulled;
}

// 安全网：每条错题截止日前至少重做一遍（stage=0 还没重做的，下次复习不得晚于截止日）
export function ensureAtLeastOneReview(p) {
  if (!p || p.type !== 'mistake' || !p.deadline || p.deadline < todayStr()) return 0;
  const today = todayStr();
  let changed = 0;
  (p.items || []).forEach(it => {
    if (it.mastered || it.manualMastered || it.finalReviewDate || (it.stage || 0) >= 1) return;
    if (!it.nextReviewDate) { it.nextReviewDate = today < p.deadline ? addDays(today, 1) : p.deadline; changed++; }
    else if (it.nextReviewDate > p.deadline) { it.nextReviewDate = p.deadline; changed++; }
  });
  if (changed > 0) p.updatedAt = Date.now();
  return changed;
}

// 今日达标收尾：已做够当天目标后，把"误提前、今天没做"的多余题顺延到明天，并记录今日已达标
export function settleToday(p) {
  if (!p || p.type !== 'mistake' || !p.deadline) return 0;
  const today = todayStr();
  const target = getMistakeDayPlan(p, today).target;
  const reviewed = getTodayReviewedCount(p);
  if (reviewed < target) return 0;
  let changed = 0;
  getDueItems(p).forEach(it => {
    const did = (it.reviews || []).filter(r => r.date === today).length > (it.learnedDate === today ? 1 : 0);
    if (it.earlyReviewed && !did) { it.nextReviewDate = addDays(today, 1); changed++; }
  });
  if (getDueItems(p).length === 0 && p.todayMetDate !== today) { p.todayMetDate = today; changed++; }
  if (changed > 0) p.updatedAt = Date.now();
  return changed;
}

export function autoBalanceIfNeeded(p) {
  if (!p || p.type === 'exercise') return 0;
  if (p.reviewMode !== 'balanced') return 0;
  if (p.dailyCapacity === 0) return 0;
  const today = todayStr();
  // 错题：与"前紧后松"共用同一个今日目标，避免"均衡摊走、前紧又拉回"互相打架；
  // 背书无提前机制，仍用分散容量。
  const cap = p.type === 'mistake' ? getMistakeDayPlan(p, today).target : getSpreadDayCap(p, today);
  const due = getDueItems(p).slice().sort(compareItemPriority);
  if (due.length <= cap) {
    p.lastAutoBalanceDate = today;
    return 0;
  }
  // 先把锁死条目（canBeSpread=false，逾期太久不能再推）强制归入 keep 留今天，
  // 不进 excess；否则切到 excess 后又被 spreadItems 强制放回今天，造成今日实际负载虚高、重复处理
  const blocked = due.filter(it => !canBeSpread(it, p));
  const spreadable = due.filter(it => canBeSpread(it, p));
  const keepN = Math.max(0, cap - blocked.length);
  const keep = blocked.concat(spreadable.slice(0, keepN));
  const excess = spreadable.slice(keepN);
  keep.forEach(it => { it.nextReviewDate = today; });
  if (!excess.length) {
    // 超额条目全部因"逾期太久不能再推"而锁死，今日负载无法再后摊（记忆安全优先）。
    // 标记今天已处理，交由状态卡如实提示"优先做逾期"，不做无效写盘。
    p.lastAutoBalanceDate = today;
    return 0;
  }
  // 摊派窗口按"积压量 / 每日容量"自适应（至少 3 天、至多 3 周）：
  // 积压少时维持原来的 3 天（记忆更安全）；积压多时拉长，避免超额内容全挤在未来 3 天形成新的爆量日
  const tomorrowCap = getSpreadDayCap(p, addDays(today, 1));
  const spreadDays = Math.max(3, Math.min(21, Math.ceil(excess.length / Math.max(1, tomorrowCap))));
  p.lastAutoBalanceDate = today;
  return spreadItems(p, excess, spreadDays);
}

/* 防饥饿：判断这条是否还能被分散（注意：调用方需保证能拿到项目配置） */
export function canBeSpread(it, p) {
  if (it.spreadCount >= 3) return false; // 被分散过3次，不能再推
  if (!it.nextReviewDate) return false;
  const intervals = p ? getItemIntervals(it, p) : (it.customIntervals || DEFAULT_INTERVALS);
  const stage = it.stage || 0;
  const maxGap = (intervals[Math.min(stage, intervals.length - 1)] || 1) * 2;
  const overdue = diffDays(it.nextReviewDate, todayStr());
  if (overdue > maxGap) return false; // 超过最大间隔2倍，不能再推
  return true;
}

/* ============ 复习评价 ============ */
export let pendingConfirmItem = null;
export let pendingConfirmProject = null;
export let pendingConfirmFromSkip = false; // 标记确认弹窗是否来自"已熟知"按钮
export let __autoBalanceToastShown = {}; // 自动均衡 toast 当日去重（key: projectId:date）

export function getItemIntervals(item, p) {
  return (item.customIntervals && item.customIntervals.length) ? item.customIntervals : getIntervals(p);
}

/* 统一三档复习质量模型（错题本 / 背书本共用，Anki Again/Hard/Good 思路）
   - good（做对/记得）：进入下一轮，间隔 = 下一轮标准间隔
   - fuzzy（看答案/模糊）：也进轮，但新间隔 ≤ 当前间隔×1.3，薄弱内容不会被快速放到长间隔
   - forgot（做错/忘记）：停留本轮、间隔回到首轮；连续 rollbackAfter 次 forgot 再退一轮
   纯函数：传入当前 stage / wrongStreak，返回 { stage, gap, wrongStreak }。 */
export function transitionReview(intervals, s0, wrongStreak0, quality, isFirstLearn, rollbackAfter) {
  rollbackAfter = rollbackAfter || 2;
  const last = intervals.length - 1;
  const firstGap = intervals[0] || 1;
  if (isFirstLearn) {
    let gap = firstGap;
    // 首次学习三档按首间隔比例缩放，避免默认 firstGap=1 时 good/fuzzy/forgot 都排 1 天无区分度；
    // fuzzy≈0.5×、forgot≈0.3×（天粒度最小 1 天，间隔调大后梯度自然拉开）
    if (quality === 'fuzzy') gap = Math.max(1, Math.round(firstGap * 0.5));
    else if (quality === 'forgot') gap = Math.max(1, Math.round(firstGap * 0.3));
    return { stage: 0, gap, wrongStreak: quality === 'forgot' ? 1 : 0 };
  }
  const curGap = intervals[Math.min(s0, last)] || firstGap;
  if (quality === 'good') {
    const stage = Math.min(s0 + 1, last);
    return { stage, gap: intervals[stage] || firstGap, wrongStreak: 0 };
  }
  if (quality === 'fuzzy') {
    if (s0 >= last) {
      // 已在最后一轮仍模糊：不毕业，间隔小幅拉长
      return { stage: last, gap: Math.max(curGap + 1, Math.round(curGap * 1.3)), wrongStreak: 0 };
    }
    const stage = s0 + 1;
    const nextGap = intervals[stage] || curGap;
    const gap = Math.min(nextGap, Math.max(curGap + 1, Math.round(curGap * 1.3)));
    return { stage, gap, wrongStreak: 0 };
  }
  // forgot
  const wrongStreak = wrongStreak0 + 1;
  const stage = wrongStreak >= rollbackAfter ? Math.max(0, s0 - 1) : s0;
  return { stage, gap: firstGap, wrongStreak };
}

/* 根据 reviews 历史重算 stage / mastered / masteredDate（修改历史评价后调用） */
export function recomputeItemMastery(item, p) {
  const reviews = item.reviews || [];
  const wasEarlyReviewed = !!item.earlyReviewed; // 先保存，重置后 scheduleNextReview 要用
  if (!reviews.length) {
    item.stage = 0;
    item.mastered = false;
    item.masteredDate = null;
    item.spreadCount = 0;
    item.earlyReviewed = false;
    clearRetention(item);
    return;
  }
  const intervals = getItemIntervals(item, p);
  // 回放首次学习：第一条 review 的 quality 决定首个 gap（good/fuzzy/forgot 按比例缩放首间隔），
  // 否则重算后 lastGap 永远退回首间隔，丢失首次学习质量带来的排期差异
  const firstT = transitionReview(intervals, 0, 0, reviews[0].quality, true, p.lapseRollback);
  let stage = firstT.stage;
  let wrongStreak = firstT.wrongStreak;
  let lastGap = firstT.gap;
  // 统一三档模型回放：good 进轮；fuzzy 进轮但间隔受限；forgot 停留（连续2次退一轮）；错题/背书一致
  for (let i = 1; i < reviews.length; i++) {
    const t = transitionReview(intervals, stage, wrongStreak, reviews[i].quality, false, p.lapseRollback);
    stage = t.stage;
    wrongStreak = t.wrongStreak;
    lastGap = t.gap;
  }
  item.stage = stage;
  item.wrongStreak = wrongStreak;
  item.spreadCount = 0; // 重算后清零分散次数
  item.earlyReviewed = false;
  // 判断是否掌握：最后一轮 + 满3次 + 最近3次全对（最后一次必须是 good）才直接标记（后台重算不弹窗）
  const isLastRound = stage >= intervals.length - 1;
  const recent = reviews.slice(-3);
  const allGood = recent.length >= 1 && recent.every(r => r.quality === 'good');
  const lastQuality = reviews[reviews.length - 1].quality;
  if (isLastRound && lastQuality === 'good' && allGood && reviews.length >= 3) {
    item.mastered = true;
    item.masteredDate = reviews[reviews.length - 1].date;
    item.nextReviewDate = null;
    // 进入保持期（手动熟知的条目不安排）
    if (!item.manualMastered) scheduleRetention(item, item.masteredDate, item.retentionPass || 0, p);
    else clearRetention(item);
  } else {
    item.mastered = false;
    item.masteredDate = null;
    clearRetention(item);
    // 提前复习过的条目，临时设回 earlyReviewed 让 scheduleNextReview 能缩短间隔
    if (wasEarlyReviewed) item.earlyReviewed = true;
    item.nextReviewDate = scheduleNextReview(p, item, reviews[reviews.length - 1].date, stage, lastGap);
    item.earlyReviewed = false; // 算完再重置
  }
}

export function applyReview(item, quality, p, note) {
  const intervals = getItemIntervals(item, p);
  const today = todayStr();

  item.reviews = item.reviews || [];
  const isFirstLearn = item.reviews.length === 0;

  // 统一三档质量模型（错题/背书一致）：good 进轮；fuzzy 进轮但间隔受限；forgot 停留、连续2次退一轮
  const tr = transitionReview(intervals, item.stage || 0, item.wrongStreak || 0, quality, isFirstLearn, p.lapseRollback);
  const newStage = tr.stage;
  item.wrongStreak = tr.wrongStreak;

  const review = { date: today, quality, stage: isFirstLearn ? 0 : newStage };
  if (note && note.trim()) review.note = note.trim().slice(0, 60);
  if (note !== undefined) item.note = (note || '').trim().slice(0, 60);
  item.reviews.push(review);
  item.stage = newStage;
  item.spreadCount = 0; // 正常复习后，分散次数清零
  const wasEarlyReviewed = !!item.earlyReviewed; // 先保存，重置后 scheduleNextReview 要用
  item.earlyReviewed = false;
  delete item.originalNextReviewDate; // 已复习，清掉提前复习的追踪字段
  p.updatedAt = Date.now();
  saveStore(); // 立即存盘，避免弹出确认弹窗时刷新导致本次评价丢失

  if (isFirstLearn) {
    item.mastered = false;
    item.masteredDate = null;
    // 首次学习也走统一排期（均匀模式下自动错峰；新录入不计入当天任务量）
    if (wasEarlyReviewed) item.earlyReviewed = true;
    item.nextReviewDate = scheduleNextReview(p, item, today, 0, tr.gap);
    item.earlyReviewed = false;
    p.updatedAt = Date.now();
    return;
  }

  // 毕业逻辑：只有 good 走到最后一轮才考虑毕业（fuzzy/forgot 永不触发毕业）
  // - 最后一轮 + 复习≥3次 + 最近3次全对 → 直接毕业（不弹窗）
  // - 最后一轮 good 但不满足上述条件 → 弹确认掌握弹窗
  // - 其他情况 → 按三档模型正常排期，不弹窗
  const recent = item.reviews.slice(-3);
  const allGood = recent.length >= 1 && recent.every(r => r.quality === 'good');
  const tooFew = item.reviews.length < 3;
  const isLastRound = newStage >= intervals.length - 1;

  if (quality === 'good' && isLastRound) {
    if (allGood && !tooFew) {
      // 最后一轮 + 满3次 + 最近3次全对 → 直接毕业，进入保持期
      item.mastered = true;
      item.masteredDate = today;
      item.nextReviewDate = null;
      scheduleRetention(item, today, 0, p);
    } else {
      // 最后一轮但不满足直接毕业条件 → 弹窗确认
      // 弹窗前先落一个默认的下次复习日期（最长间隔），避免用户杀进程/刷新后 stage 已推进但 nextReviewDate 还是旧值的不一致状态
      const lastGap = intervals[intervals.length - 1] || 30;
      item.mastered = false;
      item.masteredDate = null;
      item.nextReviewDate = scheduleNextReview(p, item, today, newStage, lastGap);
      p.updatedAt = Date.now();
      saveStore();
      pendingConfirmItem = item;
      pendingConfirmProject = p;
      pendingConfirmFromSkip = false;
      const reason = tooFew ? 'few' : 'notAllGood';
      showConfirmMaster(item, p, recent, reason);
      return;
    }
  } else {
    // 未到最后一轮，或 fuzzy/forgot → 不掌握，按三档模型安排下次复习
    item.mastered = false;
    item.masteredDate = null;
    clearRetention(item);
    if (wasEarlyReviewed) item.earlyReviewed = true;
    item.nextReviewDate = scheduleNextReview(p, item, today, newStage, tr.gap);
    item.earlyReviewed = false;
  }
  p.updatedAt = Date.now();
}

export function showConfirmMaster(item, p, recentReviews, reason) {
  const mask = $('#confirmMasterMask');
  const text = $('#confirmMasterText');
  const opts = $('#confirmMasterOptions');
  $('#skipConfirmMask').hidden = true;

  const qLabels = p.type === 'mistake'
    ? { good: '做对了', fuzzy: '看答案', forgot: '又错了' }
    : { good: '记得', fuzzy: '模糊', forgot: '忘记' };
  const evalSequence = recentReviews.map(r => qLabels[r.quality] || r.quality).join(' → ');
  const badReviews = recentReviews.filter(r => r.quality !== 'good');
  const badDesc = badReviews.map(r => qLabels[r.quality] || r.quality).join('、');

  // 根据触发原因显示不同建议文案
  // pendingConfirmFromSkip 为 true 表示用户主动点「已熟知」，不一定是最后一轮
  const isNaturalGraduation = !pendingConfirmFromSkip;
  let suggestText = '';
  if (reason === 'few') {
    if (isNaturalGraduation) {
      suggestText = `这条已经走到<strong>最后一轮</strong>，即将毕业～但目前只复习了 <strong>${recentReviews.length}</strong> 次，记得还不够牢，建议再巩固几轮。`;
    } else {
      suggestText = `目前只复习了 <strong>${recentReviews.length}</strong> 次，记得还不够牢，建议再巩固几轮。`;
    }
  } else if (reason === 'notAllGood') {
    if (isNaturalGraduation) {
      suggestText = `这条已经走到<strong>最后一轮</strong>，但最近有「${badDesc}」的情况，还不够稳定。确认已经掌握了吗？还是再复习几轮？`;
    } else {
      suggestText = `最近有「${badDesc}」的情况，还不够稳定，建议再复习几轮。`;
    }
  } else {
    if (isNaturalGraduation) {
      suggestText = `这条已经走到<strong>最后一轮</strong>，即将毕业！最近 <strong>${recentReviews.length}</strong> 次都答对了，确认已经真正掌握了吗？`;
    } else {
      suggestText = `最近 <strong>${recentReviews.length}</strong> 次都答对了，确认已经真正掌握了吗？`;
    }
  }

  text.innerHTML = `
    <div class="cm-item-name">「${esc(item.content)}」</div>
    <div class="cm-eval">最近 ${recentReviews.length} 次评价：<strong>${evalSequence}</strong></div>
    <div class="cm-suggest">${suggestText}</div>
  `;

  opts.innerHTML = '';

  // 选项1：确认已掌握/已攻克（主色调高亮）
  const masteredWord = p.type === 'mistake' ? '攻克' : '掌握';
  const opt1 = document.createElement('button');
  opt1.className = 'cm-opt cm-opt-primary';
  opt1.innerHTML = `<span class="cm-opt-icon">✅</span><span class="cm-opt-main"><span class="cm-opt-title">确认已${masteredWord}</span><span class="cm-opt-desc">不再复习这条内容</span></span>`;
  opt1.addEventListener('click', () => { mask.hidden = true; confirmMasterItem(true); });
  opts.appendChild(opt1);

  // 选项2：重新开始
  const opt2 = document.createElement('button');
  opt2.className = 'cm-opt';
  opt2.innerHTML = `<span class="cm-opt-icon">🔄</span><span class="cm-opt-main"><span class="cm-opt-title">重新开始复习</span><span class="cm-opt-desc">清空记录，从第1轮重新复习</span></span>`;
  opt2.addEventListener('click', () => { mask.hidden = true; confirmMasterItem(false, 'restart'); });
  opts.appendChild(opt2);

  // 选项3：自定义间隔（可展开）
  // 用 div role=button 而非 button，避免 button 内嵌套 input/button 违反 HTML 规范
  const opt3 = document.createElement('div');
  opt3.className = 'cm-opt';
  opt3.setAttribute('role', 'button');
  opt3.tabIndex = 0;
  const curIntervals = getItemIntervals(item, p);
  opt3.innerHTML = `
    <span class="cm-opt-icon">⚙️</span>
    <span class="cm-opt-main">
      <span class="cm-opt-title">自定义复习间隔</span>
      <span class="cm-opt-desc">只影响这条内容，有几个间隔就复习几轮</span>
      <div class="cm-custom-panel">
        <input type="text" id="customIntervals" value="${curIntervals.join(', ')}" placeholder="例如：1, 2, 4, 7, 15, 30">
        <div class="cm-preview" id="customIntervalPreview"></div>
        <button class="primary" id="btnApplyCustom" style="padding:7px 16px;font-size:13px">应用此间隔</button>
      </div>
    </span>`;
  opt3.addEventListener('click', (e) => {
    // 点击选项卡片本身时展开/收起，点击输入框和按钮时不触发
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
      opt3.classList.toggle('expanded');
    }
  });
  opts.appendChild(opt3);

  // 选项4：暂不处理
  const opt4 = document.createElement('button');
  opt4.className = 'cm-opt';
  opt4.innerHTML = `<span class="cm-opt-icon">⏸️</span><span class="cm-opt-main"><span class="cm-opt-title">暂不处理</span><span class="cm-opt-desc">按最长一档间隔安排下次复习</span></span>`;
  opt4.addEventListener('click', () => { mask.hidden = true; closeConfirmMaster(); });
  opts.appendChild(opt4);

  // 自定义间隔的实时预览和应用
  setTimeout(() => {
    const input = $('#customIntervals');
    const preview = $('#customIntervalPreview');
    if (!input) return;
    const updatePreview = () => {
      const str = input.value.trim();
      const intervals = str.split(/[,，\s]+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n > 0);
      if (!intervals.length) { preview.textContent = '请填写有效的间隔天数'; return; }
      preview.innerHTML = `共 <strong>${intervals.length}</strong> 轮：` +
        intervals.map((d, i) => `第${i+1}轮=${d}天`).join(' → ');
    };
    input.addEventListener('input', updatePreview);
    input.addEventListener('click', e => e.stopPropagation());
    updatePreview();

    const btn = $('#btnApplyCustom');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const str = input.value.trim();
        const intervals = str.split(/[,，\s]+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n > 0);
        if (!intervals.length) { alert('请填写有效的间隔天数'); return; }
        mask.hidden = true;
        confirmMasterItem(false, 'custom', intervals);
      });
    }
  }, 0);

  mask.hidden = false;
  modalTop(mask);
}

export function confirmMasterItem(confirm, mode, customIntervals) {
  const item = pendingConfirmItem;
  const p = pendingConfirmProject;
  if (!item || !p) return;
  unlockBodyScroll(); // 打开 confirmMasterMask 时 modalTop 同步 lockBodyScroll，此处必须解锁（opt1确认/opt2重新开始/自定义间隔三条路径都走这里）
  pendingConfirmItem = null;
  pendingConfirmProject = null;
  const fromSkip = pendingConfirmFromSkip;
  pendingConfirmFromSkip = false;

  if (confirm) {
    if (fromSkip) {
      item.manualMastered = true; // 来自"已熟知"按钮，标记为已熟知（不安排保持复习）
      clearRetention(item);
    } else {
      item.mastered = true; // 来自复习评价，标记为已掌握，进入保持期
      scheduleRetention(item, todayStr(), 0, p);
    }
    item.masteredDate = todayStr();
    item.nextReviewDate = null;
  } else if (mode === 'restart') {
    item.stage = 0;
    item.reviews = [];
    item.wrongStreak = 0;
    item.mastered = false;
    item.masteredDate = null;
    item.customIntervals = null;
    clearRetention(item);
    const intervals = getIntervals(p);
    item.nextReviewDate = scheduleNextReview(p, item, todayStr(), 0, intervals[0]);
  } else if (mode === 'custom' && customIntervals && customIntervals.length) {
    item.stage = 0;
    item.reviews = [];
    item.wrongStreak = 0;
    item.mastered = false;
    item.masteredDate = null;
    item.customIntervals = customIntervals;
    clearRetention(item);
    item.nextReviewDate = scheduleNextReview(p, item, todayStr(), 0, customIntervals[0]);
  }
  p.updatedAt = Date.now();
  saveStore();
  render();
}

export function closeConfirmMaster() {
  const mask = $('#confirmMasterMask');
  if (mask.hidden) return;
  const item = pendingConfirmItem;
  const p = pendingConfirmProject;
  mask.hidden = true;
  unlockBodyScroll();
  pendingConfirmItem = null;
  pendingConfirmProject = null;
  pendingConfirmFromSkip = false;
  if (item && p) {
    const iv = getItemIntervals(item, p);
    const lastGap = iv.length ? iv[iv.length - 1] : 30;
    item.mastered = false;
    item.masteredDate = null;
    // 均匀模式下同样走智能错峰，避免最长一档直接压到已繁忙的日子
    item.nextReviewDate = scheduleNextReview(p, item, todayStr(), item.stage || 0, lastGap);
    p.updatedAt = Date.now();
    saveStore();
    render();
  }
}
// 取消按钮：单纯关闭弹窗，不做任何数据操作（评价已在弹窗前落盘）
$('#cmCancel').addEventListener('click', () => {
  $('#confirmMasterMask').hidden = true;
  unlockBodyScroll();
  pendingConfirmItem = null;
  pendingConfirmProject = null;
  pendingConfirmFromSkip = false;
});
// 注意：不监听遮罩层点击关闭，必须主动选择一个选项或取消

/* ============ 掌握度 ============ */
export function getItemScore(it) {
  if (it.manualMastered) return 1.0;
  if (it.mastered) return 1.0;
  if (!it.reviews || !it.reviews.length) return null;

  let weightedSum = 0, totalWeight = 0;
  for (let i = it.reviews.length - 1; i >= 0; i--) {
    const rec = it.reviews[i];
    const recency = it.reviews.length - 1 - i;
    const weight = 1 / (recency + 1);
    const s = rec.quality === 'good' ? 1.0 : (rec.quality === 'fuzzy' ? 0.5 : 0);
    weightedSum += s * weight;
    totalWeight += weight;
  }
  let score = totalWeight > 0 ? weightedSum / totalWeight : 0;

  let streak = 0;
  for (let i = it.reviews.length - 1; i >= 0; i--) {
    if (it.reviews[i].quality === 'good') streak++;
    else break;
  }
  if (streak >= 3) score = Math.min(1.0, score + 0.1);

  if (it.reviews.length >= 2) {
    const last2 = it.reviews.slice(-2);
    if (last2.every(r => r.quality === 'forgot')) score = Math.min(score, 0.3);
  }

  return score;
}

export function getMasteryInfo(it, p) {
  const isMistake = p && p.type === 'mistake';
  const masteredWord = isMistake ? '攻克' : '掌握';
  if (it.manualMastered || it.mastered) return { key: 'mastered', label: '已' + masteredWord, cls: 'm-mastered' };
  if (!it.reviews || !it.reviews.length) return { key: 'new', label: '未复习', cls: 'm-new' };

  const score = getItemScore(it);
  if (score === null) return { key: 'new', label: '未复习', cls: 'm-new' };
  if (score >= 0.8) return { key: 'solid', label: isMistake ? '牢固攻克' : '牢固掌握', cls: 'm-solid' };
  if (score >= 0.6) return { key: 'good', label: masteredWord, cls: 'm-good' };
  if (score >= 0.4) return { key: 'fuzzy', label: '需要巩固', cls: 'm-fuzzy' };
  return { key: 'weak', label: '需要重点看', cls: 'm-weak' };
}

/* 取单元内的条目及其归属权重（按页码重叠比例分摊，跨页条不会被多个单元重复计数） */
export function getUnitItemEntries(p, unit) {
  // 递归获取单元及其所有子单元的页码范围
  const ranges = getUnitPageRanges(unit);
  const out = [];
  (p.items || []).forEach(it => {
    const s = getItemPageStart(it), e = getItemPageEnd(it);
    let matched = false;
    ranges.forEach(([us, ue]) => {
      if (matched) return;
      const ovS = Math.max(s, us), ovE = Math.min(e, ue);
      if (ovE >= ovS) {
        const span = Math.max(1, e - s + 1);
        const w = Math.min(1, (ovE - ovS + 1) / span);
        out.push({ it, w });
        matched = true;
      }
    });
  });
  return out;
}
// 递归获取单元及其所有子单元的页码范围
export function getUnitPageRanges(unit) {
  let ranges = [];
  if (unit.startPage != null && unit.endPage != null) ranges.push([unit.startPage, unit.endPage]);
  (unit.children || []).forEach(c => ranges = ranges.concat(getUnitPageRanges(c)));
  return ranges;
}
/* 获取关联刷题本中该单元的学习进度 */
export function getRefUnitProgress(p, unit) {
  if (!p || !p.refProjectId) return null;
  const ref = store.projects[p.refProjectId];
  if (!ref || ref.type !== 'exercise') return null;
  // 计量方式必须一致
  if (p.mistakeMode === 'set' && ref.unit !== 'set') return null;
  if (p.mistakeMode === 'page' && ref.unit !== 'page') return null;

  // 套卷模式：按套号直接匹配
  if (p.mistakeMode === 'set') {
    const setNo = unit.__setNo;
    if (!setNo) return null;
    const frac = getSetFraction(ref, setNo);
    return { unitPages: 1, learnedPages: frac, learnedRatio: frac };
  }

  // 页码模式：把刷题本的已完成区间裁剪到该单元范围内
  const ranges = getUnitPageRanges(unit);
  if (!ranges.length) return null;
  const unitPages = countRanges(ranges.map(([s, e]) => ({ start: s, end: e })));
  if (unitPages <= 0) return null;

  const done = getBookDoneRanges(ref);
  let learned = 0;
  ranges.forEach(([us, ue]) => {
    let covered = [];
    done.forEach(r => {
      const s = Math.max(r.start, us), e = Math.min(r.end, ue);
      if (e >= s) covered.push({ start: s, end: e });
    });
    learned += countRanges(mergeRanges(covered));
  });

  return { unitPages, learnedPages: learned, learnedRatio: learned / unitPages };
}
export function getUnitMastery(p, unit) {
  const entries = getUnitItemEntries(p, unit);
  const mistakeCount = entries.length;
  const masteredCount = entries.filter(({ it }) => it.mastered || it.manualMastered).length;

  // 掌握率：仅在有错题时有意义
  let masteryRate = null;
  if (mistakeCount > 0) {
    let sw = 0, sws = 0;
    entries.forEach(({ it, w }) => {
      // 从没复习过的条目：权重减半（还没暴露真实水平）
      const reviews = (it.reviews || []).length;
      const weightScale = reviews === 0 ? 0.5 : 1.0;
      const sc = (it.mastered || it.manualMastered) ? 1.0 : (getItemScore(it) ?? 0.5);
      sw += w * weightScale; sws += sc * w * weightScale;
    });
    masteryRate = sw > 0 ? sws / sw : 0;
  }

  // 学习进度：仅联动时可用
  const ref = getRefUnitProgress(p, unit);
  const learnedRatio = ref ? ref.learnedRatio : null;

  // 状态判定
  let state;
  if (mistakeCount > 0) {
    state = 'learned-with-mistake';
  } else if (ref) {
    state = learnedRatio === 0 ? 'unlearned' : 'learned-no-mistake';
  } else {
    state = 'no-data';
  }

  return {
    state,
    learnedRatio,
    refUnitPages: ref ? ref.unitPages : null,
    refLearnedPages: ref ? ref.learnedPages : null,
    mistakeCount,
    masteredCount,
    masteryRate
  };
}

export function masteryFromScore(score) {
  if (score === null || score === undefined) return { label: '未开始', cls: 'm-new' };
  if (score >= 0.8) return { label: '掌握良好', cls: 'm-solid' };
  if (score >= 0.4) return { label: '需要巩固', cls: 'm-fuzzy' };
  return { label: '需要重点看', cls: 'm-weak' };
}

/* ============ 状态卡 ============ */
/* 统一的"加量/缺口"措辞：既要让用户知道有缺口（首要目标是按时完成），又不用"多 358%、2.7 倍"
   这种击溃性数字。小样本（medium）速率不稳、不给精确倍数；高倍数引导调整计划（加天数/延后/缩范围）。
   short 用于卡片/脚注的短句；full 用于状态卡/看板的完整说明。 */
export function stretchShort(m) {
  const ratio = m.ratio || 1;
  if (!(ratio > 1.05)) return '';
  if (m.confidence !== 'high') return '需加量（早期估算）';
  const pct = Math.round((ratio - 1) * 100);
  if (ratio <= 1.5) return `比平时多 ${pct}%`;
  if (ratio <= 2.2) return '强度偏大，建议加天数';
  return '缺口较大，建议调整计划';
}
export function stretchFull(m) {
  const ratio = m.ratio || 1;
  if (!(ratio > 1.05)) return '';
  if (m.confidence !== 'high') return '需要比平时多做一些才能赶上；现在样本还少、这个估算并不稳定，先按节奏推进，具体以状态卡的调整方案为准。';
  const pct = Math.round((ratio - 1) * 100);
  if (ratio <= 1.5) return `比平时多约 ${pct}%`;
  if (ratio <= 2.2) return `每次约需比平时多 ${pct}%，强度偏大；更建议增加学习天数或把截止日适当延后，避免某天硬撑。`;
  return '按当前节奏缺口较大，硬加到每天很容易累垮；更建议在设置里延后截止日、增加每周学习天数，或缩小范围。';
}

/* ============ 按期方案（看板 / 今日目标 / 状态卡共用，保证同一数字） ============
   理念：按期完成是第一选择，延期只作兜底；从多个"按期组合"（每周几天 × 每次多少）里
   选一个综合最易坚持的作为系统推荐，其余最多留一个备选，避免用户在多个数字里纠结。 */
export function getCatchUpPlan(p, m) {
  const remaining = m.remaining;
  // 背书正常窗口下追赶分母用"新学窗口（到新学截止日）"，与 perStudyDay 口径一致；
  // 背书冲刺期、刷题/错题用"到目标日"。
  const daysAvailable = (p.type === 'recite' && m.newLearnEnd && !m.sprint)
    ? m.planDaysAvailable : m.daysAvailable;
  const curWk = Math.max(1, Math.round(m.activityPerWeek));
  const curRate = m.perStudyDayRaw > 0 ? m.perStudyDayRaw : 1;
  const out = { onTime: null, alt: null, delay: null, curWk, curRate };
  if (!(remaining > 0 && daysAvailable > 0)) return out;
  const perFor = (wk) => remaining / (daysAvailable * wk / 7); // 每周学 wk 天时，每个学习日的量
  const MAX_MULT = 2.5; // 每次量超过平时 2.5 倍视为硬撑，不放进"可行按期方案"

  // 1) 保持当前频率（改动最小，缺口小时优先）
  const keep = { wk: curWk, tag: `保持每周 ${curWk} 天`, per: perFor(curWk), mult: perFor(curWk) / curRate, keep: true };
  // 2) 加频率的方案（每周 6 天 / 每天都学 / 向 5 天补）
  const add = [];
  const addCand = (wk, tag) => {
    if (wk <= curWk || wk > 7) return;
    const per = perFor(wk);
    if (per <= curRate * MAX_MULT) add.push({ wk, tag, per, mult: per / curRate });
  };
  addCand(6, '每周 6 天');
  addCand(7, '每天都学');
  addCand(5, '每周 5 天');

  if (keep.mult <= 1.5) {
    // 缺口小：保持现有频率、每次稍微多做一点即可，不必改频率
    out.onTime = keep;
    out.alt = null;
  } else {
    const pool = add.filter(c => c.mult <= MAX_MULT);
    if (pool.length) {
      // 综合最易坚持：每次量倍数越低越好；倍数接近（≤15%）时优先每周 6 天（有缓冲、比每天都学更可持续）
      pool.sort((a, b) => (a.mult + (a.wk === 6 ? -0.12 : 0)) - (b.mult + (b.wk === 6 ? -0.12 : 0)));
      out.onTime = pool[0];
      out.alt = pool[1] || null;
    }
    // 保持频率就能在 3 倍内追上（强度大但数学上可行）时，作为首选/备选
    if (!out.onTime && keep.mult <= 3) out.onTime = keep;
    if (out.onTime && !out.alt && keep.mult <= MAX_MULT && out.onTime.wk !== curWk) out.alt = keep;
  }
  // 无任何可行按期方案：给"每天都学"的硬路径，并如实标注强度，让卡片去引导延期
  if (!out.onTime) {
    const per = perFor(7);
    out.onTime = { wk: 7, tag: '每天都学（冲刺）', per, mult: per / curRate, heavy: true };
  }
  // 3) 延期兜底：每周约 6 天、维持平时每次量，算出从容完成日（现实往往不允许逾期，故仅作最后兜底）
  if (m.perStudyDayRaw > 0) {
    const wk = Math.max(curWk, 6);
    const days = Math.ceil(remaining / (curRate * wk / 7));
    out.delay = { wk, per: curRate, days, date: addDays(m.t, days) };
  }
  return out;
}

// 统一的"每个学习日目标"：stretch/impossible 时采用推荐按期方案，其余按当前预测频率
export function getDailyTarget(p, m) {
  if (m.remaining <= 0) return { per: 0, wk: null, plan: null };
  if ((m.feasibility === 'stretch' || m.feasibility === 'impossible') && m.perStudyDayRaw > 0) {
    const plan = getCatchUpPlan(p, m);
    if (plan.onTime) return { per: plan.onTime.per, wk: plan.onTime.wk, plan, heavy: !!plan.onTime.heavy };
  }
  // 冷启动（数据不足）时 perStudyDay 是按"每周 5 天"先验折算的，频率口径也要用 5，避免大字与脚注打架
  const wk = m.enoughData ? Math.round(m.activityPerWeek) : 5;
  return { per: m.perStudyDay, wk: m.perStudyDay != null ? wk : null, plan: null };
}

/* ============ 动态学习教练文案池 ============
   多维度组合：时间段 × 连续天数 × 进度状态 × 日期种子轮换，保证新鲜感。 */
export const Coach = {
  pick(arr, seedKey) {
    if (!arr || !arr.length) return '';
    let h = 0;
    const s = todayStr() + '|' + (seedKey || '');
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return arr[Math.abs(h) % arr.length];
  },
  start: {
    morning: [
      '早上好！新的一天，先从今天的小目标开始，做完会很踏实～',
      '早晨状态最好，先把今天的量完成，剩下时间都是赚的～',
      '早！今天也按节奏来，先坐下开始，进入状态就顺了～',
      '清晨是高效时段，先完成目标，一天都轻松～',
    ],
    day: [
      '今天的目标已经安排好啦，找个时间开始吧～',
      '按节奏推进就好，先从今天的第一部分开始～',
      '今天也稳稳的，完成目标就是胜利～',
      '不用想太多，跟着今天的安排走就好～',
      '先开始，哪怕只做一点点，进入状态后会越做越顺～',
    ],
    evening: [
      '晚上好，今天还有时间完成目标，现在开始刚刚好～',
      '别拖到太晚哦，现在开始，做完安心休息～',
      '晚上效率也可以很高，先做起来，时间够用～',
      '今天还剩一点时间，完成目标再休息会更踏实～',
    ],
    night: [
      '夜深了，如果今天还没做，做一点点也好，别给自己压力～',
      '深夜了，量力而行，哪怕开始一点点都算数～',
    ],
  },
  streak: {
    hot: [
      '连续天数很亮眼，今天别断、保持住！',
      '这份坚持很了不起，今天也坐下来、接着保持～',
      '已经连续这么多天，惯性在你这边～',
    ],
    warm: [
      '连续几天了，节奏不错，今天也跟上～',
      '保持连续记录，今天做一点就续上了～',
    ],
  },
  back: [
    '歇了几天没关系，节奏很快就会回来～',
    '欢迎回来！不用补之前的，重新出发就好～',
    '断几天很正常，捡起来比从零开始快得多～',
    '回来就好，慢慢进入状态～',
    '休息也是学习的一部分，今天重新出发～',
    '之前学的都还在，不用有负担～',
  ],
  progress: {
    early: [
      '稳扎稳打，先完成一部分～',
      '已经启动，保持这个感觉～',
      '不错的开局，继续往下～',
      '踏踏实实，一步步来～',
    ],
    mid: [
      '稳扎稳打，保持这个节奏～',
      '中间阶段最考验坚持，你做得很好，继续～',
      '进度在稳步推进，继续保持～',
      '保持这个势头，再接再厉～',
    ],
    late: [
      '进入后半程，一鼓作气～',
      '快了，保持住这个状态～',
      '收尾阶段，再加把劲～',
      '手感正好，拿下它～',
    ],
  },
  done: [
    '今日目标达成，剩下时间自由安排～',
    '完成！今天的任务稳稳拿下，好好放松～',
    '达标了！按节奏走就是这么稳～',
    '今日份学习圆满完成，辛苦啦～',
    '目标完成，这份踏实感是你应得的～',
  ],
  // 今日只完成一部分时的收尾鼓励（句子自带动作引导，不再拼后缀，避免"继续~继续"重复）
  dashPartial: [
    '已经开了个好头，把剩下的完成，今天就更踏实了～',
    '进度不错，趁热打铁把今天的目标收尾～',
    '进度在往前走，今天的任务很快就能清完～',
    '状态已经热起来了，顺手把剩下的做完～',
    '继续保持这个节奏，再推进一点点，今天的目标就到手了～',
  ],
  overSmall: [
    '小超额，今天状态不错～',
    '多做了一些，很棒，剩下时间自由安排～',
    '超额完成，效率在线～',
    '比目标多做了点，今天很充实～',
  ],
  overMid: [
    '比目标多做了不少，今天的你很高效～',
    '状态正佳，多学了这么多，成就感满满～',
    '一口气推进了这么多，势头很足～',
    '今天发挥得很好，这份高效很提气～',
  ],
  overBig: [
    '今天彻底爆发了，状态太强了，剩下时间好好休息～',
    '这股劲头太棒了，不用每天都这样，今天已经很厉害～',
    '火力全开的一天，好好犒劳自己～',
    '今天效率拉满，爆发日是加分项，按自己的节奏来～',
    '学了这么多，今天的你超强，剩下时间完全自由～',
  ],
  cold: [
    '刚开始，数据还在积累，先按你的状态来，不用有压力～',
    '前几天是磨合期，做几天系统就更懂你的节奏了～',
    '开局阶段，目标只是参考，找到自己的感觉最重要～',
  ],
};
export function coachSlot() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 18) return 'day';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}
// 天数措辞统一处理：0 天说"就是今天"，负值说"已过 N 天"，正值说"还有 N 天"
export function fmtDaysLeft(n) {
  if (n === 0) return '就是今天';
  if (n < 0) return `已过 ${-n} 天`;
  return `还有 ${n} 天`;
}

export function getStatusMessage(p, m) {
  const u = unitName(p);
  const curN = fmtUnitNum(m.currentPage), tot = fmtUnitNum(m.total), rem = fmtUnitNum(m.remaining);
  const pct = m.total > 0 ? m.currentPage / m.total : 0;

  // 1. 全部完成：提前完成给正反馈
  if (pct >= 1 && m.currentPage > 0) {
    if (p.type === 'mistake') {
      return { icon:'🏁', cls:'ok', title:'已收录的错题全部攻克',
        desc:`共攻克 ${tot} 道错题，这些曾经的坑都被你填平了，它们就是你的得分点。以后遇到新错题随时收录，系统会继续自动提醒你重做。` };
    }
    let praise = '';
    if (p.deadline) {
      const early = diffDays(m.t, p.deadline);
      if (early > 0) praise = `比目标提前了 ${early} 天，太棒了！`;
      else if (early === 0) praise = '刚好在目标日完成，卡得很准！';
    }
    return { icon:'🏁', cls:'ok', title:'全部内容已完成',
      desc:`共 ${tot} ${u}，你在 ${fmtCN(m.t)} 完成了整个目标。${praise ? praise + '<br><br>' : ''}可以在设置中调整截止日期，或开始下一个任务。` };
  }

  // 2. 错题本：核心理念——攻克错题是最高效的提分，错题是"提前发现的薄弱点"而非负担。
  //    按间隔滚动复习，不采用"每天订正多少 / 攻克速度线性外推"的线性思维：
  //    每道题要走多轮才攻克，攻克速度天然非线性，小样本外推会得出"还需90周"这种荒谬且打击人的数字。
  if (p.type === 'mistake') {
    const today = todayStr();
    const due = getDueItems(p).length;
    const over = getOverdueItems(p).length;
    const totalNum = m.total || 0;
    const masteredNum = m.currentPage || 0;
    const mpct = totalNum > 0 ? masteredNum / totalNum : 0;
    const masteredPct = Math.round(mpct * 100);
    const justStarted = masteredNum === 0 && totalNum > 0;

    // 今天的动作（复习 / 攻克），用于"今天做完了"的即时满足
    let reviewedToday = 0, masteredToday = 0;
    (p.items || []).forEach(it => {
      const revs = it.reviews || [];
      if (revs.length >= 2 && revs[revs.length - 1].date === today) reviewedToday++;
      if (it.masteredDate === today && !it.manualMastered) masteredToday++;
    });
    // 高频薄弱点：反复错（连续 2 次及以上"又错了"）的未攻克题——考前最该拿下、提分最快的点
    const weakKey = (p.items || []).filter(it => !it.mastered && !it.manualMastered && (it.wrongStreak || 0) >= 2).length;

    const masteryLine = totalNum > 0
      ? (masteredNum > 0 ? `已攻克 ${curN} / ${tot} 道（${masteredPct}%）` : `已收录 ${tot} 道，还没开始复习`)
      : '';
    const progressPhrase = masteredNum > 0
      ? `已实打实攻克 ${curN} 道，这些曾经的薄弱点正在变成你的得分点。`
      : (totalNum > 0 ? '收录错题，就是在精准定位你自己的提分点，已经开了个好头。' : '');
    const weakPhrase = weakKey > 0
      ? `<strong>${weakKey}</strong> 道你反复错过，是考前最该拿下的高频薄弱点，优先做熟它们、提分最快。`
      : '';

    // 截止日：只在临近（≤14 天）或已过时温和提示；距离还远时不喊焦虑——每天清掉"今天到期"的就是最优策略
    let deadlineWarn = '';
    if (p.deadline && m.remaining > 0) {
      const daysLeft = diffDays(today, p.deadline);
      if (daysLeft < 0) {
        deadlineWarn = `<br><br>目标日已过 ${-daysLeft} 天，错题本仍会继续帮你滚动剩下的 ${rem} 道，不用焦虑；想设个新目标日，可以在设置里调整。`;
      } else if (daysLeft <= 14) {
        deadlineWarn = `<br><br>距目标日 ${fmtCN(p.deadline)} ${fmtDaysLeft(daysLeft)}。这段时间建议优先清「今天到期」和「反复错」的题——把已经暴露过的薄弱点做熟，比漫无目的地刷新题更针对考前提分。想筛查哪些题从收录后一次都没复习过，可以到「🎯 薄弱点 → 未复习」里看一眼。`;
      }
    }

    // (a) 有逾期：温和提醒 + 分批（自动均衡已控制今日量），进步前置，不制造"做不完"的恐慌
    if (over > 0) {
      const heavy = over >= Math.max(1, due * 0.5);
      const lead = heavy
        ? `今天有 ${due} 道待复习（含 ${over} 道逾期）。<strong>不用一次做完，也不用有负担</strong>，先从最久没复习的那条开始，其余的系统会自动摊到接下来几天。`
        : `今天有 ${due} 道待复习（含 ${over} 道逾期）。先把逾期的过一遍，哪怕只做几条，记忆也会重新接上。`;
      return { icon:'📌', cls:'info', title: heavy ? `有 ${over} 道逾期，分批消化就好` : `有 ${over} 道错题到期了`,
        desc:`${lead}<br>${progressPhrase}${weakPhrase ? '<br>' + weakPhrase : ''}错题按间隔滚动，做完当轮自动排下一轮，你只管清今天的。${deadlineWarn}` };
    }
    // (b) 正常待复习：强调"攻克 = 实打实进步"
    if (due > 0) {
      let tail = '今天从第一条开始订正，间隔就会开始滚动。';
      if (mpct >= 0.8) tail = '已经攻克大半，进入收尾，保持住，能看到头了。';
      else if (mpct >= 0.5) tail = '已经攻克过半，进展很实在。';
      else if (masteredNum > 0) tail = '做对会把间隔越拉越长，之后会越来越轻松。';
      return { icon:'📋', cls:'info', title:`今天有 ${due} 道错题等你过一遍`,
        desc:`每攻克一道错题，就是实打实补上一个提分点，比刷十道新题更值。${masteryLine ? masteryLine + '，' : ''}${tail}${weakPhrase ? '<br>' + weakPhrase : ''}${deadlineWarn}` };
    }
    // (c) 今天刚把队列清完（还没全攻克）：给即时满足
    if (due <= 0 && reviewedToday > 0 && m.remaining > 0) {
      const got = masteredToday > 0 ? `今天还攻克了 ${masteredToday} 道，又拿下 ${masteredToday} 个薄弱点。` : '';
      return { icon:'✅', cls:'ok', title:'今天的错题都过完了',
        desc:`今天已复习 ${reviewedToday} 道，${got}剩下的会在到期日自动提醒，不用提前惦记。${progressPhrase ? '<br>' + progressPhrase : ''}` };
    }
    if (m.remaining === 0 && m.currentPage > 0) {
      return { icon:'🎉', cls:'ok', title:'已收录的错题全部攻克',
        desc:`共攻克 ${curN} 道错题，这些曾经的坑都被你填平了。遇到新错题随时收录，到复习日会自动提醒你重做。` };
    }
    // (d) 刚收录、还没开始：把"收录错题"正面化
    if (justStarted) {
      return { icon:'📝', cls:'info', title:'错题已经帮你记下了',
        desc:`已收录 ${tot} 道错题，等于提前找到了 ${tot} 个提分点。现在还没有到期提醒，可以在复习区先过 1 道，间隔系统就开始运转，之后全自动提醒。` };
    }
    // (e) 队列暂时清空
    const calmTail = mpct >= 0.8
      ? `已攻克 ${masteredPct}%，进入收尾，队列暂时清空，遇到新错题随时收录。`
      : mpct >= 0.5
        ? `已攻克 ${masteredPct}%、过半了，暂无到期就是暂时清空了队列，保持节奏就好。`
        : masteredNum > 0
          ? `已攻克 ${curN} / ${tot} 道，队列暂时清空，今天可以轻松些。`
          : '暂无到期错题，遇到新错题随时收录即可。';
    return { icon:'✅', cls:'ok', title:'暂无到期错题',
      desc:`${calmTail}${deadlineWarn}` };
  }

  // 3. 背书本·冲刺期：剩余时间已不足一个完整复习周期（距考试 < cycleDays），
  //    目标从"把新内容学完"切换为"把已学的在考场上记住"，不判 impossible、给清晰的冲刺动作。
  if (p.type === 'recite' && m.sprint) {
    const due = getDueItems(p).length;
    const over = getOverdueItems(p).length;
    const finalRev = (p.items || []).filter(it => it.finalReviewDate).length;
    let body = `距你的目标日 ${fmtCN(p.deadline)} ${fmtDaysLeft(m.daysLeft)}，已不足一个完整复习周期（约 ${m.cycleDays} 天）。<br><br>`;
    body += `<b>这个阶段的目标不是"把没背的全背完"，而是"把已学的内容牢牢记住"。</b><br>`;
    body += `• 已学内容的复习最优先，这是性价比最高的巩固动作；<br>`;
    body += `• 新内容只挑最核心、最关键的部分，系统会用更短的间隔帮你快速过；<br>`;
    if (m.remaining > 0) body += `• 还有约 ${fmtUnitNum(m.remaining)} 页没学，不建议再大面积铺新，按"先复习、有余力再挑重点学新"走即可。<br>`;
    if (finalRev > 0) body += `• 已有 <b>${finalRev}</b> 条完成了目标前最后一遍，目标日前不再占用你，稳住状态即可。<br>`;
    if (due > 0) body += `<br>今天有 ${due} 条到期复习${over > 0 ? `（含 ${over} 条逾期）` : ''}，先把它们过一遍，就是此刻最有效的冲刺。`;
    else body += `<br>今天的复习已清完，有余力就挑重点学一点。`;
    return { icon:'⏰', cls:'warn', title:'进入冲刺期：先复习、再挑重点学新', desc: body };
  }

  // 背书本的"新学截止日"提示（正常窗口）：新内容应在 deadline-cycleDays 前学完，之后只滚动复习，
  // 才能保证所有内容在考试前走完所有轮次、形成长期记忆。
  const reciteCycleLine = (p.type === 'recite' && m.newLearnEnd && !m.sprint)
    ? (m.cycleTight
      ? `<br><b>注意：</b>按当前节奏，新内容可能赶不上 ${fmtCN(m.newLearnEnd)} 的新学截止日，最后一部分会来不及走完完整复习周期；建议近期加一点量或提前，实在来不及就优先保高频考点。`
      : `<br>新内容建议在 <b>${fmtCN(m.newLearnEnd)}</b> 前学完，之后约 ${m.cycleDays} 天只做滚动复习，这样到目标日每一块都能走完所有轮次、记得最牢。`)
    : '';

  // 4. 数据不足：用"已完成的小集合"框架肯定第一步，再给一个今天就能执行的小抓手
  if (!m.enoughData || !m.etaDate) {
    const verb0 = p.type === 'recite' ? '新学' : '做';
    const doneTxt = m.currentPage > 0
      ? `已完成 ${curN} ${u}、第 ${m.activeDays} 个学习日`
      : `第 ${m.activeDays} 个学习日`;
    if (p.deadline && m.remaining > 0 && m.daysAvailable > 0) {
      // 有截止日：早期也给一个粗略但可执行的小目标（只给一个数字，与看板/今日目标同源）。
      // 背书按"新学窗口（目标日−完整复习周期）"算，留得出复习时间；其余按到目标日。
      const reciteWin = (p.type === 'recite' && !m.sprint && m.newLearnEnd)
        ? Math.max(1, diffDays(m.t, m.newLearnEnd) + 1) : 0;
      const winDays = reciteWin || m.daysAvailable;
      const perStudy = m.perStudyDay != null ? m.perStudyDay : m.remaining / (winDays * 5 / 7); // 按每周约 5 个学习日
      const targetDate = reciteWin ? m.newLearnEnd : p.deadline;
      const grasp = reciteWin
        ? `按每个学习日约 ${perStudy.toFixed(1)} ${u}（每周约 5 天）推进，就能在 ${fmtCN(targetDate)} 前学完，之后还留约 ${m.cycleDays} 天滚动复习。`
        : `按每个学习日约 ${perStudy.toFixed(1)} ${u}（每周约 5 天）推进，就能在 ${fmtCN(targetDate)} 前完成。`;
      return { icon:'🌱', cls:'info', title:'刚开始，先把节奏跑起来',
        desc:`${doneTxt}。先有个粗略抓手：${grasp}这是早期估算，做几天就会按你的真实节奏自动修正，现在不用有压力。${reciteCycleLine}` };
    }
    if (m.activeDays >= 1) {
      return { icon:'🌱', cls:'info', title:'第一步已经完成',
        desc:`${doneTxt}已经记下了。再积累约 ${m.daysToMedium} 个学习日，系统就能开始结合你的节奏估算完成时间；现在只需定一个自己做得到的小量，连续几天完成它。` };
    }
    return { icon:'📊', cls:'info', title:'今天从第一个小目标开始',
      desc:'先完成今天的第一次打卡/复习，让系统看到你的节奏。把目标定小到"一定能完成"，连续几天比一次猛学更重要。' };
  }

  const verb = p.type === 'recite' ? '新学' : '做';
  const paceBits = `按你每周约 ${Math.round(m.activityPerWeek)} 个学习日、每次约 ${(Math.round(m.perStudyDayRaw * 10) / 10).toFixed(1)} ${u} 的节奏`;
  const confTxt = m.confidence === 'medium' ? '（样本还少，范围偏宽）' : '';
  const sparseNote = m.sparseLogging
    ? `（提示：你最近打卡间隔中位数约 ${m.medianGap} 天，产能估计可能有偏差，建议每天记录一次。）`
    : '';
  let rangeTxt = `预计 ${fmtCN(m.etaDate)} 完成`;
  if (m.etaEarlyDate && m.etaLateDate && m.etaEarlyDate !== m.etaLateDate) {
    rangeTxt = `预计 ${fmtCN(m.etaEarlyDate)}～${fmtCN(m.etaLateDate)} 之间完成`;
  }
  // 落后/超前量（与 getMetrics 同口径：填了 startDate 用它，否则用最早打卡日）
  let behindTxt = '';
  if (m.effStart && p.deadline && m.total > 0) {
    const totalSpan = diffDays(m.effStart, p.deadline);
    const elapsed = diffDays(m.effStart, m.t);
    if (totalSpan > 0) {
      const ideal = m.total * Math.max(0, Math.min(1, elapsed / totalSpan));
      const gap = Math.round(m.currentPage - ideal);
      if (gap < -1) behindTxt = `比理想进度慢了 ${-gap} ${u}。`;
      else if (gap > 1) behindTxt = `目前相对理想进度超前 ${gap} ${u}。`;
    }
  }

  // 4. 未设截止日：给预计完成 + 还需几周
  if (!p.deadline) {
    const weeksLeft = m.etaDate ? Math.ceil(diffDays(m.t, m.etaDate) / 7 * 10) / 10 : null;
    return { icon:'📈', cls:'ok', title:'保持节奏，持续推进',
      desc:`${paceBits}，${rangeTxt}全部 ${tot} ${u}${weeksLeft ? `，大约还需 ${weeksLeft} 周` : ''}。可在设置里添加截止日，获得每个学习日目标和可行性提醒。${confTxt}` };
  }

  // ---- 按期方案（看板 / 今日目标 / 状态卡共用同一数字）：按期首选、延期只作兜底 ----
  const plan = getCatchUpPlan(p, m);
  const remaining = m.remaining, daysAvailable = m.daysAvailable;
  const curWk = plan.curWk, curRate = plan.curRate;
  const n1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const planText = (c) => {
    if (!c) return '';
    if (c.keep) return `保持每周 ${c.wk} 天、每次约 ${n1(c.per)} ${u}（比平时多约 ${Math.round((c.mult - 1) * 100)}%）`;
    return `每周学 ${c.wk} 天、每次约 ${n1(c.per)} ${u}`;
  };
  // 真实完成日期：高置信给区间；小样本只在"能赶上 / 仅小幅落后"时给精确日期，
  // 若外推到目标日 30 天以后（数据少时极易被几天低迷放大成击溃性数字），只如实说"会晚"而不给伪精确日期。
  const etaLine = (() => {
    if (m.confidence === 'high' && m.etaEarlyDate && m.etaLateDate && m.etaEarlyDate !== m.etaLateDate)
      return { text: `按现在节奏预计 ${fmtCN(m.etaEarlyDate)}～${fmtCN(m.etaLateDate)} 完成`, far: false };
    const d = m.momentumEtaDate || m.etaDate;
    if (!d) return { text: '', far: false };
    const over = p.deadline ? diffDays(p.deadline, d) : 0; // 正值=晚于目标日多少天
    if (m.confidence !== 'high' && over > 30)
      return { text: '按目前节奏会晚于目标日', far: true };
    return { text: `按${m.momentumEtaDate ? '最近' : '现在'}节奏预计 ${fmtCN(d)} 左右完成`, far: false };
  })();
  // 小样本只保留这一次极短标注（far 时尤其需要强调会快速修正）
  const earlyTag = m.confidence === 'medium'
    ? (etaLine.far
      ? '<span class="muted">（数据还少，只看方向不看具体日期，随每天记录快速修正）</span>'
      : '<span class="muted">（早期估算，随每天记录更新）</span>')
    : '';

  // 5. impossible（含已过期）：先给按期硬路径，延期作为更现实的兜底；不渲染"晚 X 天"
  if (m.feasibility === 'impossible' || m.daysLeft < 0) {
    const overdue = m.daysLeft < 0;
    let body = '';
    if (overdue) {
      body = `已经过了原定目标日 ${fmtCN(p.deadline)}，还剩 ${rem} ${u}。之前学的都还在，我们把计划重新理顺。<br><br>`;
    } else {
      body = `还剩 ${rem} ${u}，${etaLine.text ? etaLine.text + '，' : ''}按平时节奏在 ${fmtCN(p.deadline)} 前完成难度较大。<br><br>`;
    }
    if (m.momentumDays >= 3) body += m.momentumImproving
      ? `你最近 ${m.momentumDays} 天明显提速了，方向对了，继续保持；不过按目标日算，缺口仍然偏大。<br><br>`
      : `你最近 ${m.momentumDays} 天有在持续推进，这股劲很重要。<br><br>`;
    if (plan.onTime) {
      if (plan.onTime.heavy) {
        body += `<b>硬要赶上 ${fmtCN(p.deadline)}，只能每天都学、每次约 ${n1(plan.onTime.per)} ${u}</b>（约为平时的 ${plan.onTime.mult.toFixed(1)} 倍，强度很大、容易断档）。<br><br>`;
      } else {
        body += `<b>想赶上 ${fmtCN(p.deadline)}，可行的方式：</b>${planText(plan.onTime)}。<br><br>`;
      }
    }
    if (plan.delay) {
      body += `<b>如果强度太大，更现实的是把目标日延到 ${fmtCN(plan.delay.date)} 左右</b>（每周 ${plan.delay.wk} 天、每次约 ${n1(curRate)} ${u}，节奏更稳）。截止日是规划工具不是审判，可在设置里调整。`;
    }
    body += reciteCycleLine + sparseNote;
    return { icon: overdue ? '⛔' : '🚧', cls:'bad', title: overdue ? '已过目标日，一起重新规划' : '目标偏紧，需要调整安排', desc: body };
  }

  // 6. stretch：势头能赶上→及时翻绿；在提速→先肯定；常规→真实现状 + 首选按期方案 + 延期兜底
  if (m.feasibility === 'stretch') {
    const ratio = m.ratio || 1;
    // 6a. 近期状态好：状态卡聚焦"长期能否按时"，今天的超额肯定交给目标卡，避免重复
    if (m.momentumOnTime && m.momentumEtaDate) {
      const keepPer = plan.onTime ? plan.onTime.per : m.perStudyDay;
      const todayDone = m.todayDone || 0;
      const todayMet = todayDone >= keepPer;
      let body = `还剩 ${rem} ${u}、距目标日 ${fmtDaysLeft(m.daysLeft)}，每个学习日约 ${n1(keepPer)} ${u}就能按时完成。<br><br>`;
      body += Coach.pick([
        '你最近状态不错，按这个节奏稳定推进就好。',
        '最近效率在线，保持稳定推进，水到渠成。',
        '势头很好，稳住节奏、不用额外加压。',
      ], '6a') + '<br><br>';
      // 结尾按"今天是否已达标"给正确场景的话，不催已完成的人"继续"
      if (todayMet) {
        body += `<span class="muted">今天已完成 ${fmtUnitNum(todayDone)} ${u}` + (todayDone > keepPer*1.2 ? '、超额了，可以收工休息～' : '，达标了，剩下时间自由安排～') + `</span>`;
      } else {
        body += `<span class="muted">今天目标 ${n1(keepPer)} ${u}，${todayDone>0 ? '已完成 '+fmtUnitNum(todayDone)+'，还差一点～' : '找个时间开始吧～'}</span>`;
      }
      return { icon:'✅', cls:'ok', title:'节奏稳，能按时完成', desc: body };
    }
    // 6b. 正在提速、缺口在缩小（尚未完全赶上）：先肯定，再给首选按期方案
    if (m.momentumImproving) {
      // 只剩"硬路径"（强度很大）时，不能只给乐观，要如实说明仍需大幅加量
      if (plan.onTime && plan.onTime.heavy) {
        let body = `还剩 ${rem} ${u}。你最近明显提速了，方向对了，但按 ${fmtCN(p.deadline)} 算，缺口仍然偏大。<br><br>`;
        body += `<b>硬要赶上，只能每天都学、每次约 ${n1(plan.onTime.per)} ${u}</b>（约为平时的 ${plan.onTime.mult.toFixed(1)} 倍，强度很大、容易断档）。<br><br>`;
        if (plan.delay) body += `<b>更可持续的选择：把目标日延到 ${fmtCN(plan.delay.date)} 左右</b>（每周 ${plan.delay.wk} 天、每次约 ${n1(curRate)} ${u}）。`;
        body += reciteCycleLine;
        return { icon:'🚧', cls:'warn', title:'在提速，但还需要加量', desc: body };
      }
      let body = `还剩 ${rem} ${u}。你最近效率明显提升，状态在往上走，方向对了。<br><br>`;
      if (plan.onTime) {
        body += `<b>想在 ${fmtCN(p.deadline)} 前完成：</b>${planText(plan.onTime)}。`;
        if (plan.alt) body += `（也可${planText(plan.alt)}。）`;
      }
      if (plan.delay) body += `<br><span class="muted">若实在加不动，可把目标日延到 ${fmtCN(plan.delay.date)} 左右。</span>`;
      body += reciteCycleLine;
      return { icon:'📈', cls:'ok', title:'状态在上升，继续保持', desc: body };
    }
    // 6c. 常规 stretch
    const isHeavyGap = ratio > 1.5;
    const hardPath = plan.onTime && plan.onTime.heavy;
    let body = `还剩 ${rem} ${u}，${etaLine.text}。${earlyTag}<br><br>`;
    if (hardPath) {
      // 缺口大到可持续方案都不可行：硬路径如实标注强度，延期不再弱化，而作为并列的现实选择
      body += `<b>想赶上 ${fmtCN(p.deadline)}，只能每天都学、每次约 ${n1(plan.onTime.per)} ${u}</b>（约为平时的 ${plan.onTime.mult.toFixed(1)} 倍，强度很大、容易断档）。<br><br>`;
      if (plan.delay) body += `<b>更现实的选择：把目标日延到 ${fmtCN(plan.delay.date)} 左右</b>（每周 ${plan.delay.wk} 天、每次约 ${n1(curRate)} ${u}，节奏可持续），在设置里即可调整。`;
    } else {
      if (plan.onTime) {
        body += `<b>想按时完成，最省力的方式：</b>${planText(plan.onTime)}。`;
        if (plan.onTime.keep) body += '不用改学习频率，每次多做一点即可。';
        if (plan.alt) body += `<br>或者：${planText(plan.alt)}。`;
        body += '<br><br>';
      }
      if (plan.delay) {
        body += `<span class="muted">若最近确实排不开，可把目标日延到 ${fmtCN(plan.delay.date)} 左右（每周 ${plan.delay.wk} 天、每次约 ${n1(curRate)} ${u}），在设置里即可调整。</span>`;
      }
    }
    body += reciteCycleLine + sparseNote;
    if (hardPath) return { icon:'🚧', cls:'warn', title:'目标偏紧，建议调整安排', desc: body };
    return { icon: isHeavyGap ? '🚧' : '💪', cls: isHeavyGap ? 'warn' : 'ok',
      title: isHeavyGap ? '目标偏紧，需要加一点量' : '稍微加把劲，稳步完成', desc: body };
  }

  // 7. easy：节奏够，重点是"保持"；只给一个预计日期 + 一句缓冲建议，不堆多个速率数字
  const gapLate = m.etaLateDate ? diffDays(m.etaLateDate, p.deadline) : diffDays(m.etaDate, p.deadline);
  const isTight = gapLate <= 3;
  const etaEasy = m.etaLateDate ? fmtCN(m.etaLateDate) : fmtCN(m.etaDate);
  let body;
  if (isTight) {
    body = `还剩 ${rem} ${u}，按你现在的节奏预计 ${etaEasy} 前完成，时间刚好。<br><br>保持打卡、状态好时往前赶一点会更稳。${reciteCycleLine}${sparseNote}`;
  } else {
    body = `还剩 ${rem} ${u}，按你现在的节奏（每次约 ${(Math.round(m.perStudyDayRaw * 10) / 10).toFixed(1)} ${u}、每周约 ${Math.round(m.activityPerWeek)} 天），预计 ${etaEasy} 前完成，时间有富余。<br><br>${Coach.pick([
      '保持现在的节奏就好，状态好时往前赶一点，给自己多留缓冲。',
      '节奏很稳，继续这样推进，完成目标水到渠成。',
      '目前进度从容，按自己的节奏走就好，不用额外加压。',
      '时间还宽裕，稳稳推进，劳逸结合最重要。',
    ], 'easy')}${reciteCycleLine}${sparseNote}`;
  }
  return { icon:'✅', cls:'ok', title: isTight ? '节奏刚好，保持住' : '按当前节奏，可以按时完成', desc: body };
}

/* ============ 进步鼓励系统 ============ */
// 进度事件：启动脚手架（前3天）+ 提速/连续/回归；4个防呆，文案必须有数字
export function checkProgressPraise(p, m) {
  // 防呆3：焦虑时不弹（impossible或已过期）
  if (m.feasibility === 'impossible' || m.daysLeft < 0) return null;
  // 防呆4：同一天只弹一次
  if (!p.shownPraises) p.shownPraises = {};
  const today = todayStr();
  if (p.shownPraises._lastDate === today) return null;

  const praises = [];
  const u = unitName(p);
  // 连续/启动用"活动日"口径（收录、复习、攻克、打卡都算今天学了）；
  // 错题本用户前期可能只复习尚未攻克，按完成口径会误判为没学习、零反馈。
  const act = getActivityStreak(p, today);

  // ⓪ 启动脚手架：最容易放弃的是前几天，这里只做"第1/2/3天"的有限递进确认，
  //    每个事件只弹一次、之后自动交给常规里程碑，避免每天都被哄、也避免冷启动零反馈。
  if (act.activeDays === 1 && !p.shownPraises['first_step']) {
    praises.push({ priority: 0, key:'first_step', icon:'🌱',
      title:'第一步完成了', desc:'最难的是开始，你已经在路上。今天保持这个量就好，明天再来一次。' });
  }
  if (act.streak === 2 && !p.shownPraises['streak_2']) {
    praises.push({ priority: 0, key:'streak_2', icon:'🌱',
      title:'连续两天，启动得不错', desc:'不用追求量大，能连续两天坐下来，节奏就开始建立了。' });
  }

  // 个性化启动：累计满 3 个学习日、系统从"粗略抓手"切换为"按你真实节奏定制"时，给一次明确反馈，
  // 让冷启动到个性化的过渡可见（之前只能自己发现"样本不足"消失）。
  // 仅在刚跨过门槛（3~6 个学习日）弹一次；连续 3 天的情况交给 streak_3 里程碑；老用户不补弹。
  if (m.enoughData && act.activeDays >= 3 && act.activeDays <= 6 && act.streak !== 3 && !p.shownPraises['personalized']) {
    praises.push({ priority: 0, key:'personalized', icon:'🎯',
      title:'系统开始按你的节奏定制了',
      desc:`已经积累 ${act.activeDays} 个学习日，今日目标和预计完成时间从现在起会随你的真实节奏自动调整——你只管跟着今天的安排走就好。` });
  }

  // ① 节奏提速：近7天产能 vs 之前3周，提升>=15%（需要历史，早期 prevRate 为空自然不触发）
  if (m.trendPct != null && m.trendPct >= 0.15 && m.recentRate != null && m.prevRate != null) {
    const lastKey = 'trend';
    const lastDate = p.shownPraises[lastKey];
    if (!lastDate || diffDays(lastDate, today) >= 7) {
      praises.push({
        priority: 1, key: lastKey,
        icon: '📈', title: '这周你比之前快了',
        desc: `每次平均 ${m.recentRate.toFixed(1)} ${u}（之前 ${m.prevRate.toFixed(1)} ${u}），提升了 ${(m.trendPct*100).toFixed(0)}%`
      });
    }
  }

  // ② 连续打卡：突破 3/5/7/14/30 天档位；只有"曾连续≥3天、这次再打破历史最长"才算刷新纪录，
  //    避免首次连续时 3→4→5 这样的小数字被天天当成新纪录
  const streakTargets = [3, 5, 7, 14, 30];
  const streak = act.streak;
  if (streak >= 3) {
    const hitTarget = streakTargets.find(t => streak === t);
    // 已宣告过的纪录值也参与比较，避免刷新纪录只弹一次、之后再破纪录不再提示
    const announcedRecord = p.shownPraises.streak_record_n || 0;
    const histBest = Math.max(act.priorLongest || 0, announcedRecord);
    const isRecord = !hitTarget && streak > histBest && histBest >= 3;
    if (hitTarget || isRecord) {
      const key = isRecord ? 'streak_record' : `streak_${hitTarget}`;
      const alreadyMilestone = !isRecord && p.shownPraises[key];
      const alreadyRecord = isRecord && announcedRecord >= streak;
      if (!alreadyMilestone && !alreadyRecord) {
        const recordDesc = histBest > 0
          ? `已经连续 ${streak} 天，超过了你之前的最长纪录 ${histBest} 天`
          : `已经连续 ${streak} 天，这是你目前最长的一次连续打卡`;
        praises.push({
          priority: isRecord ? 2 : 3, key,
          recordN: streak,
          icon: '🔥', title: isRecord ? '连续打卡刷新纪录' : `连续打卡 ${streak} 天`,
          desc: isRecord ? recordDesc : `已经连续 ${streak} 天了，继续保持`
        });
      }
    }
  }

  // ③ 中断后回归：今天重新开始（当前连续=1），且上一个活动日距今停摆>=3天
  if (act.streak === 1 && act.prevDate) {
    const recentBreak = Math.max(0, diffDays(act.prevDate, today) - 1);
    if (recentBreak >= 3) {
      const key = `return_${today}`;
      if (!p.shownPraises[key]) {
        const doneTxt = m.todayDone > 0
          ? `今天做了 ${fmtUnitNum(m.todayDone)} ${u}，节奏没丢`
          : '今天重新坐下来开始了，节奏没丢';
        praises.push({
          priority: 4, key,
          icon: '👋', title: '休息后回来了',
          desc: `之前停了 ${recentBreak} 天，${doneTxt}`
        });
      }
    }
  }

  if (!praises.length) return null;
  // 防呆4：选最硬的一条（priority最小）
  praises.sort((a, b) => a.priority - b.priority);
  const best = praises[0];
  p.shownPraises[best.key] = today;
  if (best.recordN) p.shownPraises.streak_record_n = best.recordN;
  p.shownPraises._lastDate = today;
  p.updatedAt = Date.now();
  saveStore();
  return best;
}

// 打卡成功后统一调用：检测进步鼓励并弹出
export function maybeShowProgressPraise(p) {
  const praise = checkProgressPraise(p, getMetrics(p));
  if (praise) setTimeout(() => showToast(praise.icon, praise.title, praise.desc, 4000), 800);
}

/* ============ 里程碑 ============ */
export const MILESTONES = [
  { at:25, icon:'📈', title:'完成 25%！', desc:'四分之一已达成。继续推进，节奏很稳。' },
  { at:50, icon:'🌟', title:'完成 50%！', desc:'进度已经过半，接下来稳扎稳打。' },
  { at:70, icon:'💪', title:'完成 70%！', desc:'胜利在望。保持节奏，别停下来。' },
  { at:90, icon:'🔥', title:'完成 90%！', desc:'最后一程，一鼓作气冲线。' },
  { at:100, icon:'✅', title:'全部完成！', desc:'恭喜你拿下整个目标，好好犒劳一下自己。' }
];
export let toastTimer = null;
export function showToast(icon, title, desc, duration, onClick) {
  const t = $('#toast');
  t.querySelector('.toast-icon').textContent = icon;
  t.querySelector('.toast-title').textContent = title;
  t.querySelector('.toast-desc').textContent = desc;
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth;
  requestAnimationFrame(() => t.classList.add('show'));
  // ux-14：toast 可点击重试（onClick 存在时手型 + 点击触发一次）
  _toastClickHandler = (typeof onClick === 'function') ? onClick : null;
  t.style.cursor = _toastClickHandler ? 'pointer' : 'default';
  if (toastTimer) clearTimeout(toastTimer);
  const ms = duration && duration > 0 ? duration : 2200;
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    _toastClickHandler = null;
    t.style.cursor = 'default';
    setTimeout(() => { t.hidden = true; }, 320);
  }, ms);
}
export let _toastClickHandler = null;
document.addEventListener('DOMContentLoaded', () => {
  const t = document.getElementById('toast');
  if (t) t.addEventListener('click', () => { if (_toastClickHandler) { const fn = _toastClickHandler; _toastClickHandler = null; fn(); } });
});
/* ux-16：内联校验 helper——字段红边框 + 字段下红字，替代原生 alert()。
   错误节点挂在输入框的直接父容器下；输入时即清除（ux-26：只动轻量样式，不全量 render）。 */
export function setFieldError(input, msg){
  if (!input) return;
  input.classList.add('input-error');
  input.setAttribute('aria-invalid', 'true');
  const wrap = input.closest('.field, .form-row, .checkin-row') || input.parentElement;
  if (!wrap) return;
  let err = wrap.querySelector(':scope > .field-error');
  if (!err) {
    err = document.createElement('div');
    err.className = 'field-error';
    wrap.appendChild(err);
  }
  err.textContent = msg || '';
}
export function clearFieldError(input){
  if (!input) return;
  input.classList.remove('input-error');
  input.removeAttribute('aria-invalid');
  const wrap = input.closest('.field, .form-row, .checkin-row') || input.parentElement;
  if (!wrap) return;
  const err = wrap.querySelector(':scope > .field-error');
  if (err) err.remove();
}
export function clearAllFieldErrors(scope){
  (scope || document).querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
  (scope || document).querySelectorAll('.field-error').forEach(el => el.remove());
}
// 输入即清除该字段错误（轻量样式更新，不触发 render/saveStore —— ux-26）
export function autoClearFieldError(scope){
  (scope || document).querySelectorAll('input, textarea, select').forEach(el => {
    el.addEventListener('input', () => clearFieldError(el));
    el.addEventListener('change', () => clearFieldError(el));
  });
}
/* ux-17：空状态引导按钮——平滑滚动到录入表单并聚焦第一个输入框 */
export function scrollToEntryForm(focusSel){
  const p = cur();
  const exercise = p && p.type === 'exercise';
  const target = exercise ? $('#checkinSection') : $('#reciteForm');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => {
    const el = $(focusSel);
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
  }, 380);
}
/* ux-18：在复习/记录列表位置渲染 n 条 shimmer 骨架条（数据到达后 render() 自动替换） */
export function showListShimmer(n){
  const total = n || 4;
  const row = '<li class="shimmer-row">'
    + '<span class="shimmer-block date"></span>'
    + '<span class="shimmer-block page"></span>'
    + '<span class="shimmer-block delta"></span>'
    + '<span class="shimmer-block del"></span>'
    + '</li>';
  const html = new Array(total + 1).join(row);
  const rl = $('#reviewList'); if (rl && !$('#reviewSection').hidden) rl.innerHTML = html;
  const rec = $('#recordList'); if (rec) rec.innerHTML = html;
}
/* ---- 删除撤销 ---- */
export let undoState = null;
export let undoTimer = null;
export let undoTicks = null;
export const UNDO_MS = 5000;

export function showUndo(text, undoFn) {
  const bar = $('#undoBar');
  $('#undoText').textContent = text;
  bar.hidden = false;
  undoState = undoFn;
  if (undoTimer) clearTimeout(undoTimer);
  if (undoTicks) clearInterval(undoTicks);
  const t0 = Date.now();
  const paint = () => {
    const remain = Math.max(0, UNDO_MS - (Date.now() - t0));
    $('#undoCount').textContent = Math.ceil(remain / 1000) + 's';
    $('#undoProg').style.width = (remain / UNDO_MS * 100) + '%';
  };
  paint();
  undoTicks = setInterval(paint, 100);
  undoTimer = setTimeout(() => {
    bar.hidden = true;
    undoState = null;
    if (undoTicks) clearInterval(undoTicks);
  }, UNDO_MS);
}

$('#undoBtn').addEventListener('click', () => {
  if (!undoState) return;
  try { undoState(); } catch (e) {}
  $('#undoBar').hidden = true;
  undoState = null;
  if (undoTimer) clearTimeout(undoTimer);
  if (undoTicks) clearInterval(undoTicks);
});

export function checkMilestones(p, m) {
  const pct = m.total > 0 ? m.currentPage / m.total * 100 : 0;
  if (!Array.isArray(p.shownMilestones)) p.shownMilestones = [];
  const pending = MILESTONES.filter(ms => pct >= ms.at && !p.shownMilestones.includes(ms.at));
  if (!pending.length) return;
  pending.forEach(ms => p.shownMilestones.push(ms.at));
  saveStore();
  const latest = pending[pending.length - 1];
  // 因材施教：百分比语义随模式不同（刷题=完成、背书=背完、错题=攻克），鼓励语也贴合各自任务
  const verbWord = p.type === 'mistake' ? '攻克' : p.type === 'recite' ? '背完' : '完成';
  const title = latest.at === 100
    ? (p.type === 'mistake' ? '全部攻克！' : p.type === 'recite' ? '全部背完！' : '全部完成！')
    : `${verbWord} ${latest.at}%！`;
  const descByType = {
    exercise: {
      25: '已经推进四分之一，节奏很稳，继续保持。',
      50: '进度过半，最容易松劲的阶段，坚持住就赢了一半。',
      70: '胜利在望，保持节奏，别停下来。',
      90: '只剩最后一程，一鼓作气。',
      100: '全部刷完了，好好犒劳一下自己。'
    },
    recite: {
      25: '已经背完四分之一，记得定期复习，节奏很稳。',
      50: '过半了，新学的同时别忘了回头复习。',
      70: '胜利在望，越到后面越要靠复习巩固。',
      90: '最后一程，新学加复习一起冲。',
      100: '全部背完了，接下来保持复习就不会忘。'
    },
    mistake: {
      25: '已经攻克四分之一的错题，它们正在变成你最稳的得分点。',
      50: '攻克过半，你已经填平了一半曾经的薄弱点。',
      70: '只剩三成错题，胜利在望。',
      90: '只剩最后一成，把它们彻底拿下。',
      100: '收录的错题全部攻克，这些曾经的坑都被你填平了。'
    }
  };
  const desc = (descByType[p.type] && descByType[p.type][latest.at]) || latest.desc;
  setTimeout(() => showToast(latest.icon, title, desc), 450);
}

/* ============ 错题即时反馈：攻克正强化 + 反复错去羞耻化（均按天限频，避免刷屏） ============ */
export const __mistakeFbToday = {};     // key: projectId:date:kind → true
export const __milestoneFiredToday = {}; // key: projectId:date → true（今天是否已触发百分比里程碑，交给它庆祝）
export const _fbKey = (p, kind) => p.id + ':' + todayStr() + ':' + kind;
export const _msKey = (p) => p.id + ':' + todayStr();

// 攻克错题：每天首次攻克时强化"实打实进步"；若当天已触发百分比里程碑（25%/50%…），则把庆祝交给里程碑，不重复弹
export function checkMistakeMasteryToast(p) {
  if (!p || p.type !== 'mistake') return;
  if (__mistakeFbToday[_fbKey(p, 'master')]) return;
  const today = todayStr();
  const masteredToday = (p.items || []).filter(it => it.masteredDate === today && !it.manualMastered).length;
  if (masteredToday <= 0) return;
  __mistakeFbToday[_fbKey(p, 'master')] = true;
  if (__milestoneFiredToday[_msKey(p)]) return; // 百分比里程碑已给出更强的庆祝
  const title = masteredToday >= 2 ? `今天攻克 ${masteredToday} 道错题` : '又攻克一道错题';
  const desc = masteredToday >= 2
    ? '这些曾经的薄弱点，今天都变成了你的得分点。'
    : '这个薄弱点你彻底拿下了——比刷十道新题更值。';
  setTimeout(() => showToast('🎯', title, desc, 3000), 650);
}

// 反复错（连续 2 次及以上"又错了"）：去羞耻化，把它框定为"考前发现的高频薄弱点"，每个项目每天最多提示一次
export function checkMistakeRelapseToast(p, item) {
  if (!p || p.type !== 'mistake' || !item) return;
  if (__mistakeFbToday[_fbKey(p, 'relapse')]) return;
  if ((item.wrongStreak || 0) < 2) return;
  __mistakeFbToday[_fbKey(p, 'relapse')] = true;
  setTimeout(() => showToast('🔍', '这道题反复卡住',
    '说明它是你的高频薄弱点，考前能发现它很值。已排到最近，多过两次就拿下了。', 4800), 520);
}

/* ============ 录入时的学习效果 + 预览 ============ */
export let reciteQuality = null;
export function gapForQuality(quality, intervals) {
  const first = intervals[0] || 1;
  if (quality === 'fuzzy') return Math.max(1, Math.round(first / 2));
  if (quality === 'forgot') return 1;
  if (quality === 'good') return first;
  return null;
}
export function setupReciteQuality() {
  const wrap = $('#reciteQuality');
  if (!wrap || wrap.dataset.bound) return;
  wrap.dataset.bound = '1';
  wrap.querySelectorAll('.rec-qbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      reciteQuality = btn.dataset.q;
      wrap.querySelectorAll('.rec-qbtn').forEach(b => b.classList.toggle('active', b === btn));
      updateRecitePreview();
    });
  });
}
export function renderStageOptions(p) {
  setupReciteQuality();
  if (!p) return;
  const labels = p.type === 'mistake'
    ? { good: '做对', fuzzy: '看答案', forgot: '错了' }
    : { good: '记得', fuzzy: '模糊', forgot: '忘记' };
  const wrap = $('#reciteQuality');
  if (wrap) wrap.querySelectorAll('.rec-qbtn').forEach(b => { b.textContent = labels[b.dataset.q]; });
  const outer = wrap?.closest('.field')?.querySelector('span');
  if (outer) outer.textContent = p.type === 'mistake' ? '本次订正效果' : '本次学习效果';
}

export function updateRecitePreview() {
  const p = cur();
  if (!p || p.type === 'exercise') return;
  const intervals = getIntervals(p);
  const date = $('#reciteDate').value || todayStr();
  const preview = $('#recitePreview');
  preview.classList.remove('overdue', 'mastered');
  const qLabels = p.type === 'mistake'
    ? { good: '做对了', fuzzy: '看答案', forgot: '错了' }
    : { good: '记得', fuzzy: '模糊', forgot: '忘记' };
  if (!reciteQuality) {
    preview.innerHTML = `请选择本次学习效果（${qLabels.good} / ${qLabels.fuzzy} / ${qLabels.forgot}）`;
    return;
  }
  const gap = gapForQuality(reciteQuality, intervals);
  const next = addDays(date, gap);
  const daysFromNow = diffDays(todayStr(), next);
  const qLabel = qLabels[reciteQuality];
  if (daysFromNow < 0) {
    preview.classList.add('overdue');
    preview.innerHTML = `学习效果：${qLabel}，将进入「今日复习」`;
  } else {
    preview.innerHTML = `学习效果：${qLabel}，提交后系统会自动安排再次复习`;
  }
}

/* ============ 大数字渲染：按字符长度自动降档字号，极端数值也不会撑破卡片 ============ */
export function _setBigNum(el, num, unit) {
  if (num === null || num === undefined || num === '—' || num === '') {
    el.textContent = '—';
    el.classList.remove('num-sm', 'num-xs');
    return;
  }
  el.innerHTML = `${num}<small>${unit}</small>`;
  const len = String(num).replace(/[.,\s]/g, '').length;
  el.classList.toggle('num-sm', len >= 5 && len < 7);
  el.classList.toggle('num-xs', len >= 7);
}

/* ============ 今日目标：进度条 + 状态化鼓励 ============ */
export function _dgShow(box, fill, line, praise, mood, pct, l, pr) {
  box.hidden = false;
  box.className = 'daily-goal dg-' + mood;
  praise.className = 'dg-praise dg-' + mood;
  fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  line.textContent = l;
  praise.textContent = pr;
}

/* 在第三张"目标"卡片内，显示今天已做多少 / 还差多少 / 超额多少，并按状态给不同鼓励 */
export function renderDailyGoal(p, m) {
  const box = document.getElementById('dailyGoalBox');
  const fill = document.getElementById('dgFill');
  const line = document.getElementById('dgLine');
  const praise = document.getElementById('dgPraise');
  if (!box) return;
  const u = unitName(p);
  const today = todayStr();
  const doneAll = m.currentPage > 0 && m.remaining === 0;
  // 连续天数统一用"活动日"口径（复习/收录/攻克/打卡都算今天学了），避免错题本只复习未攻克时连续清零
  const act = getActivityStreak(p, today);

  /* ---- 错题本：按"今日待解决条数"统计，不看累计页数 ---- */
  if (p.type === 'mistake') {
    const due = getDueItems(p).length;
    let reviewedToday = 0;
    (p.items || []).forEach(it => {
      const revs = it.reviews || [];
      if (revs.length >= 2 && revs[revs.length - 1].date === today) reviewedToday++;
    });
    if (doneAll) {
      _dgShow(box, fill, line, praise, 'done-all', 100, '都完成了', '恭喜拿下整个目标，好好犒劳一下自己~');
      return;
    }
    // 今天清完了但 due=0（最后一条刚做完），也展示一下清零鼓励
    if (due <= 0 && reviewedToday > 0) {
      _dgShow(box, fill, line, praise, 'done', 100, `今天复习了 ${reviewedToday} 条`, '今日错题已全部过完，可以收了~');
      return;
    }
    if (due <= 0) {
      _dgShow(box, fill, line, praise, 'idle', 0, '今天没有到期错题', '📝 暂无到期错题，遇到新错题随时收录~');
      return;
    }
    // 注意：due 是"此刻仍待复习"的条数，已复习的会因 nextReviewDate 被推到未来而离开 due，
    // 所以今日总量 = 剩余 due + 今天已复习，不能直接拿 due 当分母（否则越复习进度越"虚高"）。
    const totalDueToday = due + reviewedToday;
    const pct = totalDueToday > 0 ? Math.min(100, reviewedToday / totalDueToday * 100) : 0;
    if (reviewedToday === 0) {
      const tip = (act.streak >= 2)
        ? Coach.pick(Coach.streak.warm, 'mks') + ` 先从最久没复习的那条开始~`
        : Coach.pick(Coach.progress.early, 'mks0') + ` 从第一条开始~`;
      _dgShow(box, fill, line, praise, 'idle', 0, `今天还有 ${due} 条错题待复习`, tip);
    } else {
      const left = due;
      const ratio = totalDueToday > 0 ? reviewedToday / totalDueToday : 0;
      let mood, tip;
      if (ratio < 0.34) {
        mood = 'progress'; tip = Coach.pick(Coach.progress.early, 'mke') + ` 还剩 ${left} 条~`;
      } else if (ratio < 0.7) {
        mood = 'progress'; tip = Coach.pick(Coach.progress.mid, 'mkm') + ` 还剩 ${left} 条~`;
      } else {
        mood = 'almost'; tip = Coach.pick(Coach.progress.late, 'mkl') + ` 只剩 ${left} 条~`;
      }
      _dgShow(box, fill, line, praise, mood, pct, `已清 ${reviewedToday} / ${totalDueToday} 条`, tip);
    }
    return;
  }

  /* ---- 背书本：复习优先、再学新。复习也是今日学习，复习推进就要计入进度，
     避免"复习了 4 条却显示还没动"。今日目标分两段：① 到期复习（条）② 新学页。 ---- */
  if (p.type === 'recite') {
    const rvDueNow = getDueItems(p).length;
    let rvDoneToday = 0;
    (p.items || []).forEach(it => {
      const revs = it.reviews || [];
      // 与错题同口径：今天对该条做过复习（reviews[0] 是首次学习，至少 2 条且最后一次在今天）
      if (revs.length >= 2 && revs[revs.length - 1].date === today) rvDoneToday++;
    });
    const rvTotal = rvDueNow + rvDoneToday;
    // 新学目标：m.perStudyDay 已按"新学窗口（目标日−完整复习周期）"折算——个性化后用真实节奏，
    // 冷启动也由 getMetrics 按每周 5 个学习日先验给出，故不会把新学误摊到含复习期的全程（前松后紧）。
    // stretch/impossible 时改用与状态卡、看板同源的"最省力按期方案"，避免三处数字打架。
    let newTarget = getDailyTarget(p, m).per;
    // 极端兜底（无截止日等）：退到自然日均摊
    if (newTarget == null && isFinite(m.needPerDay) && m.needPerDay > 0) newTarget = m.needPerDay;
    // 冲刺期不再给固定新学页数（统一"复习优先、挑重点"），避免与冲刺策略冲突、制造额外压力
    if (m.sprint) newTarget = null;
    // 新学与复习联动：每日总容量（条）已含"新学+复习"，复习占用后剩余的才是新学，
    // 复习高峰日新学自动减少、复习少的日子补新学，避免"复习一堆还要求学新 N 页"；
    // 新学欠账会由 perStudyDay/按期均摊在新学窗口内自动追赶，不把压力抛给用户。
    if (newTarget != null) {
      const dayCap = getDailyCapacity(p);
      if (dayCap > 0) {
        const learned = (p.items || []).filter(it => it.learnedDate && it.pageStart != null && it.pageEnd != null);
        let avgPages = 1;
        if (learned.length) {
          const pages = learned.reduce((s, it) => s + Math.max(0, it.pageEnd - it.pageStart + 1), 0);
          avgPages = Math.max(0.5, pages / learned.length);
        }
        const roomItems = Math.max(0, dayCap - rvTotal);
        newTarget = Math.max(0, Math.min(newTarget, roomItems * avgPages));
      }
    }
    const newTargetR = newTarget != null ? Math.round(newTarget * 10) / 10 : null;
    const newDone = m.todayDone || 0;
    const newDoneR = Math.round(newDone * 10) / 10;

    if (doneAll) {
      _dgShow(box, fill, line, praise, 'done-all', 100, '都背完了', '恭喜拿下整个目标，好好犒劳一下自己~');
      return;
    }

    // 阶段一：还有到期复习没清完——复习优先，进度条只反映复习
    if (rvDueNow > 0) {
      const pct = rvTotal > 0 ? Math.min(100, rvDoneToday / rvTotal * 100) : 0;
      let mood, pr;
      if (rvDoneToday === 0) {
        mood = 'idle';
        pr = (act.streak >= 2)
          ? Coach.pick(Coach.streak.warm, 'rvs') + ' 先从最久没复习的那条开始~'
          : Coach.pick(Coach.progress.early, 'rvs0') + ' 先复习再学新，从第一条开始~';
      } else {
        const rr = rvDoneToday / Math.max(1, rvTotal);
        if (rr < 0.5) { mood = 'progress'; pr = Coach.pick(Coach.progress.early, 'rve') + ` 还剩 ${rvDueNow} 条~`; }
        else if (rr < 0.7) { mood = 'progress'; pr = Coach.pick(Coach.progress.mid, 'rvm') + ` 还剩 ${rvDueNow} 条~`; }
        else { mood = 'almost'; pr = Coach.pick(Coach.progress.late, 'rvl') + ` 复习只剩 ${rvDueNow} 条~`; }
      }
      let tail;
      if (m.sprint) tail = '（复习优先，新学挑重点即可）';
      else if (newTargetR == null) tail = '';
      else if (newTargetR > 0.3) tail = `（之后再学新约 ${fmtUnitNum(newTargetR)} 页）`;
      else tail = '（今天复习是重点，新学量力而行）';
      _dgShow(box, fill, line, praise, mood, pct, `复习 ${rvDoneToday}/${rvTotal} 条${tail}`, pr);
      return;
    }

    // 阶段二：今天复习已清完（或本就无复习），进度转向新学页
    const prefix = rvDoneToday > 0 ? '复习已清 ✓ · ' : '';
    if (newTargetR == null || newTargetR <= 0) {
      if (rvDoneToday > 0) {
        _dgShow(box, fill, line, praise, 'done', 100, `今日复习 ${rvDoneToday} 条已清完`, '✅ 今天的复习都过完了，有余力可以学一点新内容~');
      } else {
        _dgShow(box, fill, line, praise, 'idle', 0, '今天没有安排复习', '💡 可以学一点新内容，或先休息~');
      }
      return;
    }
    const nr = newDone / newTarget;
    const npct = Math.min(100, nr * 100);
    let nmood, nl, npr;
    if (newDone <= 0) {
      nmood = 'idle';
      nl = `${prefix}新学 0 / ${fmtUnitNum(newTargetR)} 页`;
      npr = (act.streak >= 3)
        ? `🔥 连续 ${act.streak} 天，复习已清，今天的新学也别落下~`
        : `🎯 复习已清，今天再学 ${fmtUnitNum(newTargetR)} 页就圆满了~`;
    } else if (nr < 1) {
      const nleft = Math.max(0, Math.round((newTarget - newDone) * 10 + 1e-9) / 10);
      nl = `${prefix}新学 ${fmtUnitNum(newDoneR)} / ${fmtUnitNum(newTargetR)} 页`;
      if (nr < 0.5) {
        // “就过半”的剩余量 = 到新学目标一半的量（newTarget/2 - newDone），而非到全部完成的量
        const nToHalf = Math.max(0, Math.round((newTarget / 2 - newDone) * 10 + 1e-9) / 10);
        nmood = 'progress'; npr = Coach.pick(Coach.progress.early,'rne') + ` 再学 ${fmtUnitNum(nToHalf)} 页就过半~`;
      }
      else { nmood = 'almost'; npr = Coach.pick(Coach.progress.late,'rnl') + ` 就差 ${fmtUnitNum(nleft)} 页~`; }
    } else if (Math.abs(nr - 1) < 1e-9) {
      nmood = 'done';
      nl = `${prefix}新学 ${fmtUnitNum(newDoneR)} / ${fmtUnitNum(newTargetR)} 页`;
      npr = Coach.pick(Coach.done, 'rnd');
    } else {
      const over = Math.max(0, Math.round((newDone - newTarget) * 10 + 1e-9) / 10);
      nmood = 'over';
      nl = `${prefix}新学 ${fmtUnitNum(newDoneR)} / ${fmtUnitNum(newTargetR)} 页（超 ${fmtUnitNum(over)}）`;
      npr = Coach.pick(Coach.overSmall, 'rno') + Coach.pick([
        ' 给后续复习留点空间~',
        ' 新学和复习均衡些，记忆更牢~',
        ' 别一次铺太多，后面复习更从容~',
      ], 'rno2');
    }
    _dgShow(box, fill, line, praise, nmood, npct, nl, npr);
    return;
  }
  // stretch/impossible 时与看板、状态卡同源（最省力按期方案）；其余按当前预测频率
  const dt0 = getDailyTarget(p, m);
  const target = (dt0.per != null && dt0.per > 0) ? dt0.per
              : (isFinite(m.needPerDay) && m.needPerDay > 0) ? m.needPerDay
              : null;
  if (doneAll) {
    _dgShow(box, fill, line, praise, 'done-all', 100, '全部完成', '恭喜你拿下整个目标，好好犒劳一下自己~');
    return;
  }
  if (target == null || target <= 0) {
    _dgShow(box, fill, line, praise, 'idle', 0, '当前未设置每日目标', '💡 先做几天，系统会按你的节奏自动计算目标~');
    return;
  }

  const done = m.todayDone || 0;
  const targetR = Math.round(target * 10) / 10;
  const doneR = Math.round(done * 10) / 10;
  const ratio = target > 0 ? done / target : 0;
  const pct = Math.min(100, ratio * 100);

  let mood, l, pr;
  // 启动量：套卷为最小单位 1 套；当目标本身不足 1 套/学习日（如 0.3 套，约几天一套）时，
  // 明确"今天做 1 套就够"，避免与"0.3 套/天"的目标自相矛盾、让用户误以为要补量。
  const isFracPaper = u === '套' && targetR < 1;
  const startUnit = Math.max(1, Math.round(targetR*0.3));
  const slot = coachSlot();
  if (done <= 0) {
    mood = 'idle';
    l = `今天目标 ${fmtUnitNum(targetR)} ${u} · 还没动`;
    const gap = m.prevStudyDate ? Math.max(0, diffDays(m.prevStudyDate, today) - 1) : 0;
    if (m.feasibility === 'impossible') {
      pr = `💪 今天 ${fmtUnitNum(targetR)} ${u}量不小，拆成几次完成，量力而行~`;
    } else if (dt0.heavy) {
      pr = `⚠️ 今天约 ${fmtUnitNum(targetR)} ${u}（平时的 ${dt0.plan.onTime.mult.toFixed(1)} 倍）是冲刺量，量力而行；做不到可在设置里把目标日往后调~`;
    } else if (gap >= 2) {
      pr = Coach.pick(Coach.back, 'back') + (isFracPaper ? ` 今天做 ${startUnit} 套就好~` : ` 先从 ${startUnit} ${u}开始~`);
    } else if (act.streak >= 3) {
      pr = Coach.pick(Coach.streak.hot, 'streak') + (isFracPaper ? ` 今天做 ${startUnit} 套就好~` : ` 先从 ${startUnit} ${u}开始~`);
    } else if (!m.enoughData) {
      pr = Coach.pick(Coach.cold, 'cold') + ` 今天先做约 ${fmtUnitNum(targetR)} ${u}~`;
    } else if (m.feasibility === 'stretch') {
      pr = Coach.pick(Coach.start[slot], 'stretch') + ` 目标 ${fmtUnitNum(targetR)} ${u}，状态好时多做一点~`;
    } else {
      pr = Coach.pick(Coach.start[slot], 'start') + ` 目标 ${fmtUnitNum(targetR)} ${u}~`;
    }
  } else if (ratio < 1) {
    const left = Math.max(0, Math.round((target - done) * 10 + 1e-9) / 10);
    l = `已做 ${fmtUnitNum(doneR)} / ${fmtUnitNum(targetR)} ${u}`;
    if (ratio < 0.34) {
      // “就过半”的剩余量 = 到目标一半的量（target/2 - done），而非到全部完成的量（target - done）
      const toHalf = Math.max(0, Math.round((target / 2 - done) * 10 + 1e-9) / 10);
      mood = 'progress'; pr = Coach.pick(Coach.progress.early, 'pe') + ` 再做 ${fmtUnitNum(toHalf)} ${u}就过半~`;
    } else if (ratio < 0.7) {
      mood = 'progress'; pr = Coach.pick(Coach.progress.mid, 'pm') + ` 还剩 ${fmtUnitNum(left)} ${u}~`;
    } else {
      mood = 'almost'; pr = Coach.pick(Coach.progress.late, 'pl') + ` 就差 ${fmtUnitNum(left)} ${u}~`;
    }
  } else if (Math.abs(ratio - 1) < 1e-9) {
    mood = 'done';
    l = `已做 ${fmtUnitNum(doneR)} / ${fmtUnitNum(targetR)} ${u}`;
    pr = Coach.pick(Coach.done, 'done');
  } else {
    const over = Math.max(0, Math.round((done - target) * 10 + 1e-9) / 10);
    const overPct = Math.round((ratio - 1) * 100);
    mood = 'over';
    l = `已做 ${fmtUnitNum(doneR)} / ${fmtUnitNum(targetR)} ${u}（超 ${fmtUnitNum(over)}）`;
    if (overPct < 20) pr = Coach.pick(Coach.overSmall, 'os');
    else if (overPct < 60) pr = Coach.pick(Coach.overMid, 'os2') + ` 超额${overPct}%~`;
    else pr = Coach.pick(Coach.overBig, 'ob') + ` 超额${overPct}%~`;
  }
  _dgShow(box, fill, line, praise, mood, pct, l, pr);
}

