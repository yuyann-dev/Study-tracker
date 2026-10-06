/**
 * utils/scheduler.js — 间隔重复调度纯函数（从 frontend/index.html 逐行移植，须与前端同步）
 *
 * 【来源】以下逻辑精确移植自 frontend/index.html（单文件前端），修改时必须两端同步：
 *   - DEFAULT_INTERVALS            ← frontend/index.html:3278
 *   - transitionReview            ← frontend/index.html:6562-6593（三档质量模型）
 *   - lapseRollback 默认值         ← frontend/index.html:4286
 *   - 毕业判定                     ← frontend/index.html:6688-6699（最后一轮+≥3次+最近3次全 good）
 *
 * 【准确定性】这是 Leitner 盒子思想的变体——固定间隔序列 + 三档主观质量反馈，
 *   不是 SM-2：没有 ease factor、没有遗忘概率建模、没有 0-5 质量分，只有 good/fuzzy/forgot。
 *
 * 纯函数：传入当前 stage / wrongStreak，返回 { stage, gap, wrongStreak }，不触碰 DOM/存储。
 */

/** 默认固定间隔序列（天）：6 档 Leitner 盒子 */
const DEFAULT_INTERVALS = [1, 2, 4, 7, 15, 30];

/**
 * 统一三档复习质量模型（错题本/背书本共用，Anki Again/Hard/Good 思路）
 * 精确移植自 frontend/index.html:6562-6593。
 *
 *   - good（做对/记得）：进入下一轮，间隔 = 下一轮标准间隔；
 *   - fuzzy（看答案/模糊）：也进轮，但新间隔 ≤ 当前间隔×1.3，薄弱内容不会被快速放到长间隔；
 *   - forgot（做错/忘记）：停留本轮、间隔回到首轮；连续 rollbackAfter 次 forgot 再退一轮。
 *
 * @param {number[]} intervals 间隔序列（天）
 * @param {number} s0 当前所在轮次 stage
 * @param {number} wrongStreak0 当前连续 forgot 计数
 * @param {'good'|'fuzzy'|'forgot'} quality 本次评价
 * @param {boolean} isFirstLearn 是否首次学习（无任何 review 记录）
 * @param {number} [rollbackAfter=2] 连续多少次 forgot 后退一轮（前端 lapseRollback，index.html:4286）
 * @returns {{stage:number, gap:number, wrongStreak:number}}
 */
function transitionReview(intervals, s0, wrongStreak0, quality, isFirstLearn, rollbackAfter) {
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

/**
 * 按 review 历史回放，重算最终 stage / wrongStreak / lastGap。
 * 对应前端 recomputeItemMastery（index.html:6596-6624）的回放主干。
 * @param {number[]} intervals
 * @param {Array<{quality:'good'|'fuzzy'|'forgot'}>} reviews 按时间顺序的评价序列
 * @param {number} [rollbackAfter=2]
 */
function replayReviews(intervals, reviews, rollbackAfter) {
  reviews = Array.isArray(reviews) ? reviews : [];
  if (!reviews.length) return { stage: 0, wrongStreak: 0, lastGap: intervals[0] || 1 };
  let t = transitionReview(intervals, 0, 0, reviews[0].quality, true, rollbackAfter);
  let stage = t.stage;
  let wrongStreak = t.wrongStreak;
  let lastGap = t.gap;
  for (let i = 1; i < reviews.length; i++) {
    t = transitionReview(intervals, stage, wrongStreak, reviews[i].quality, false, rollbackAfter);
    stage = t.stage;
    wrongStreak = t.wrongStreak;
    lastGap = t.gap;
  }
  return { stage, wrongStreak, lastGap };
}

/**
 * 毕业判定（对应前端 index.html:6688-6699）：最后一轮 + 复习≥3 次 + 最近 3 次全 good。
 * 只有走到最后一轮且最后一次是 good 才考虑毕业。
 * @param {number[]} intervals
 * @param {Array<{quality:string}>} reviews
 */
function isGraduated(intervals, reviews) {
  reviews = Array.isArray(reviews) ? reviews : [];
  if (reviews.length < 3) return false;
  const { stage } = replayReviews(intervals, reviews);
  const isLastRound = stage >= intervals.length - 1;
  const last3 = reviews.slice(-3);
  const allGood = last3.every((r) => r.quality === 'good');
  return isLastRound && allGood && reviews[reviews.length - 1].quality === 'good';
}

module.exports = { DEFAULT_INTERVALS, transitionReview, replayReviews, isGraduated };
