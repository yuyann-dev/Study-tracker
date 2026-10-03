/* Study Tracker — 仪表盘、提醒、表单、设置、模板、薄弱点 */
/* 自动从 app.js 拆分，对应原文件 L6870-9573 */

import { $, ERROR_REASONS, addDays, diffDays, fmtCN, fmtDate, parseDate, reasonColor, todayStr } from './utils.js';
import { _booting, cur, genId, getLocalVal, saveStore, setLocalVal, store } from './storage.js';
import { Coach, coachSlot, defaultComfortCap, fmtItemLocator, getActivityStreak, getCompletedPages, getCompletedPagesAtDate, getCompletedSets, getDailyTarget, getDueItems, getIntervals, getItemPageEnd, getItemPageStart, getItemScore, getItemSource, getLazyInfo, getMasteryInfo, getMetrics, getNormalizedSections, getOverdueItems, getPaperSections, getRecordRange, getRetentionDueItems, getSetFraction, getSetState, getUnitMastery, getUnitPageRanges, isMistakeFreeMode, isMistakePageMode, isMistakeSetMode, isPageScopeCapable, isSetMode, masteryFromScore, mergeRanges, renderComfortAdvice, showToast, stretchFull, unitName, updatePressurePanel, updateSpreadPressureHint } from './review.js';
import { ALL_MODAL_IDS, showGenericConfirm, updateIntervalHint } from './events.js';

/* ============ 今日总览 ============ */
export const REMIND_KEY = 'study_tracker_remind';
export const REMIND_FIRED_KEY = 'study_tracker_remind_fired';
export function isValidHHMM(t) { return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
/* 读取提醒设置：支持多个提醒时间 times[]，并兼容旧版本的单个 time 字段 */
export function getReminder() {
  let r = {};
  try { r = JSON.parse(getLocalVal(REMIND_KEY, '{}')); } catch (e) { r = {}; }
  let times = [];
  if (Array.isArray(r.times)) times = r.times.filter(isValidHHMM);
  else if (isValidHHMM(r.time)) times = [r.time];
  times = [...new Set(times)].sort();
  if (!times.length) times = ['20:00'];
  return { enabled: !!r.enabled, times, time: times[0] };
}
export function saveReminder(enabled, times) {
  const clean = [...new Set((times || []).filter(isValidHHMM))].sort();
  const t = clean.length ? clean : ['20:00'];
  setLocalVal(REMIND_KEY, JSON.stringify({ enabled: !!enabled, times: t, time: t[0] }));
  return t;
}
/* 当天各时间点是否已弹过（防止同一分钟轮询重复弹、支持一天多个时间各弹一次） */
export function getFiredMark() {
  try { const m = JSON.parse(getLocalVal(REMIND_FIRED_KEY, '{}')); if (m && m.date === todayStr() && Array.isArray(m.times)) return m; } catch (e) {}
  return { date: todayStr(), times: [] };
}
export function currentStreak(heat, today) {
  // 今天已打卡从今天算；今天还没打卡则从昨天往回算（不因今天尚未学就清零）
  let s = 0, d = heat[today] ? today : addDays(today, -1);
  while (heat[d] && s < 365) { s++; d = addDays(d, -1); } // 加上界避免长期数据大量循环
  return s;
}
export function timeGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return '早上好';
  if (h >= 11 && h < 14) return '中午好';
  if (h >= 14 && h < 18) return '下午好';
  if (h >= 18 && h < 23) return '晚上好';
  return '夜深了';
}
/* ============ 27考研倒计时 + 每日一句 ============ */
export const KY_EXAM_DAY = '2026-12-19';   // 考试第一天
export const KY_EXAM_END = '2026-12-20';   // 考试第二天
export const KY_START    = '2026-09-19';   // 句子库起点（今天）

// 93句，按时间顺序：前期(31) + 中期(31) + 冲刺(29) + 考试当天(1) + 考试结束(1)
export const KY_QUOTES = [
  // ===== 前期 9.19-10.19（慢慢来，扎根）=====
  '因为我有能力跨越，这个考验才会降临。',
  '我知道的，你做什么都会成功。',
  '灵魂的渴望是命运的先知，敢于梦想，甘于孤独。',
  '渴望，那就全力以赴。',
  '大胆去做，你远比想象中的厉害！',
  '你终究会成为你正在成为的人。',
  '你笔下的每一道题，都在铺就上岸的路。',
  '命运反复考验，只为看到一颗坚定自信的心。',
  '前途是光明的，道路是曲折的，只要不放弃，事物总在变得更好。',
  '人只有在进步的时候才会觉得累，别把疲惫当成失败的信号。',
  '你可以一边害怕，一边勇敢。',
  '愿你有前进一寸的勇气，亦有后退一尺的从容。',
  '如果运气不好，那就试试勇气。',
  '勇敢的人，不是不流泪的人，而是流着泪，仍然坚持奔跑的人。',
  '别让困难定义你，你要定义困难。',
  '且视他人疑目如萤火，大胆奔赴自己的前路。',
  '迎万难，赢万难。',
  '纵有狂风拔地起，我亦乘风破万里，不惧前路风浪。',
  '千磨万击还坚劲，任尔东西南北风。',
  '心有鸿鹄凌云志，不惧人间行路难。',
  '去经历，去后悔，去做你想做的。',
  '宁愿被绊倒无数次，也不要规规矩矩的走一辈子。',
  '别在该奋斗的年纪选择安逸，你的努力配得上所有期待。',
  '虽然辛苦，我还是会选择那种滚烫的人生。',
  '这一次我一定要拼尽全力，不为谁，只为给自己一个交代。',
  '看不清未来时，那就坚持得久一点。',
  '慢也好，步子小也好，是在往前走就好。',
  '三十年河东，三十年河西，莫欺少年穷。',
  '看似不起眼的日复一日，会在将来的某一天，突然让你看到坚持的意义。',
  '不是看见希望才坚持，是坚持过后，才会撞见希望。',
  '成功是由日复一日的点滴努力汇聚而成的。',
  // ===== 中期 10.20-11.19（坚持，自律）=====
  '那些日复一日无人看见的努力，终会在某天兑现全部惊喜。',
  '没有白熬的夜，没有白走的路，每一份付出都算数。',
  '每一滴汗水都是浇灌成功的种子。',
  '你的坚持，终将美好。',
  '关关难过关关过，前路漫漫亦灿灿。',
  '半山腰永远拥挤，坚持向上，去山顶独享风景。',
  '追风赶月莫停留，平芜尽处是春山。',
  '路虽远，行则将至；事虽难，做则必成。',
  '知不足而奋进，望远山而力行。',
  '无人问津的日子，都在悄悄扎根，花期未到，只管沉淀自己。',
  '没有一朵花从一开始就是花，你也在慢慢扎根。',
  '当你坚持不下去的时候，困难也快要坚持不住了。',
  '且听风吟，静待花开。',
  '好运藏在努力里。',
  '理想与现实差了十万八千里，我鞭长莫及，却也马不停蹄。',
  '所有的负担都会变成礼物，现在所受的苦，都会照亮未来迷茫的路。',
  '生活先苦，而后回甘。',
  '苦尽甘来终有时，一路向阳待花期。',
  '所谓无底深渊，下去，也是前程万里。',
  '命运给你一个低谷，是为了让你写出绝地反击的故事。',
  '万物皆有裂痕，那是光照进来的地方。',
  '夜色难免黑凉，前行必有曙光。',
  '在隆冬，我终于知道，我身上有一个不可战胜的夏天。',
  '不要慌，不要慌，太阳下山有月光，月亮西沉有朝阳。',
  '请你务必，千次万次，救自己于水火。',
  '失败和失望绝大部分是懒惰的错，成功和成就永远都是坚持拼搏的成果。',
  '别辜负了你受的苦难，又对不起你的野心。',
  '自律和不自律都会吃苦，不同的是，自律的苦会让人生越来越甜。',
  '用行动打败焦虑，用坚持战胜迷茫。',
  '情绪解决不了难题，落地行动，才是治愈焦虑最好的方式。',
  '把行动交给现在，把结果交给时间。',
  // ===== 冲刺期 11.20-12.18（最后一个月）=====
  '没有人可以回到过去，但谁都可以从现在开始。',
  '当你觉得晚了的时候，恰恰是最早的时候。',
  '所有的为时已晚，其实是恰逢其时。',
  '生活原本沉闷，但跑起来就有风，不必困住当下的情绪。',
  '最完美的状态不是你不失误，而是你从没放弃成长。',
  '人生最大的贵人，是努力向上的自己。',
  '把自己活成一束光，自信坦荡，光芒万丈。',
  '发光不是太阳的权利，你也可以。',
  '我自己就是最好的，无需向他人证明。',
  '自己这一页，应是明媚自由，步履生花。',
  '自洽而内求，达观而内醒。',
  '向外求求而不得，向内求生生不息。',
  '人生是旷野，不是轨道，不必被世俗标准困住人生选择。',
  '不用和任何人攀比，你有自己的节奏，有专属的花期。',
  '人生是马拉松，不是短跑，不必因为暂时落后自我否定。',
  '允许偶尔疲惫低落，但是不要停下向前的脚步。',
  '爬到山顶，不是为了被世界看见，而是为了看见全世界。',
  '你踮起脚尖靠近太阳，全世界都挡不住你的光。',
  '满怀希望就会所向披靡。',
  '最好的状态是未来可期。',
  '向前看，轻舟已过万重山。',
  '我们终将上岸，且阳光万里。',
  '人生虽曲折，记得活出精彩。',
  '哪怕身处沟渠，也要仰望星空。',
  '愿你以渺小启程，以伟大结束。',
  '少年不惧岁月长，彼方尚有荣光在。',
  '凡是过往，皆为序章，所有将来，皆是可盼。',
  '与其抱怨黑暗，不如点亮蜡烛。',
  '能坚持到现在，你真的很棒！最后再看看错题翻翻书，早点休息~',
  // ===== 考试当天 12.19 =====
  '风雨兼程终有归期，提笔从容自信，合笔如愿以偿。',
  // ===== 考试结束 12.20 =====
  '一研为定，定为研一。'
];

export function getKaoyanInfo() {
  const today = todayStr();
  const now = new Date();
  const todayDate = new Date(today + 'T00:00:00');
  const examDate = new Date(KY_EXAM_DAY + 'T00:00:00');
  const endDate = new Date(KY_EXAM_END + 'T00:00:00');
  const startDate = new Date(KY_START + 'T00:00:00');

  const toExam = Math.ceil((examDate - todayDate) / 86400000);
  const toEnd = Math.ceil((endDate - todayDate) / 86400000);
  const dayIdx = Math.floor((todayDate - startDate) / 86400000);

  let state = 'countdown'; // countdown / exam1 / exam2 / exam2-done / hidden
  if (today > KY_EXAM_END) state = 'hidden';
  else if (today === KY_EXAM_END) {
    // 下午5点后才算考试结束
    state = (now.getHours() >= 17) ? 'exam2-done' : 'exam2';
  }
  else if (today === KY_EXAM_DAY) state = 'exam1';

  const quote = (dayIdx >= 0 && dayIdx < KY_QUOTES.length) ? KY_QUOTES[dayIdx] : '';
  return { days: toExam, daysToEnd: toEnd, state, quote, dayIdx };
}

export function getKaoyanHTML() {
  const ky = getKaoyanInfo();
  if (ky.state === 'hidden') return ''; // 12.21 起撤掉
  let cls = '', emoji = '📚', title = '距离27考研还有';
  let daysText = ky.days;
  if (ky.state === 'exam1') {
    cls = ' exam-day';
    emoji = '✍️';
    title = '今天是考研第一天';
    daysText = '上考场';
  } else if (ky.state === 'exam2') {
    cls = ' exam-day';
    emoji = '📝';
    title = '今天是考研第二天';
    daysText = '继续加油';
  } else if (ky.state === 'exam2-done') {
    cls = ' exam-done';
    emoji = '🎉';
    title = '考研结束啦';
    daysText = '好好休息';
  }
  return `
    <div class="kaoyan${cls}">
      <div class="ky-label">${title}</div>
      <div class="ky-days">${daysText}<small>${ky.state === 'countdown' ? '天' : ''}</small></div>
      ${ky.quote ? `<div class="ky-divider"></div><div class="ky-quote-tag">每 日 一 句</div><div class="ky-quote">${ky.quote}</div>` : ''}
    </div>`;
}

/* ============ 每周小结（本周首次打开看板时回顾上周，被动出现、不新增操作） ============ */
export function getMondayOf(s) {
  const d = parseDate(s);
  const dow = d.getDay(); // 0=周日
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return fmtDate(d);
}
export const _pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* 每周小结统计：分项目类型统计上周数据 */
export function buildWeeklyStats(today) {
  const todayD = parseDate(today);
  const isMonday = todayD.getDay() === 1; // 周一=1
  const thisMon = getMondayOf(today);
  const lastMon = addDays(thisMon, -7);
  const lastSun = addDays(thisMon, -1);
  const beforeWeek = addDays(lastMon, -1);  // 上周开始前一天（用于算进度差）
  const inWeek = d => d && d >= lastMon && d <= lastSun;
  const heat = {};
  let earliest = null;

  // 分类型统计
  let exercisePages = 0, exerciseSets = 0;   // 刷题：页/套
  let reciteNew = 0, reciteReviews = 0;       // 背书：新学条/复习次
  let mistakeNew = 0, mistakeMastered = 0, mistakeReviews = 0; // 错题：新增/攻克/复习

  Object.values(store.projects).forEach(p => {
    /* ===== 刷题本：用"上周结束进度 - 上周开始进度"的差值，天然去重、正确处理板块卷 ===== */
    if (p.type === 'exercise' && Array.isArray(p.records)) {
      p.records.forEach(r => {
        heat[r.date] = (heat[r.date] || 0) + 1;
        if (!earliest || r.date < earliest) earliest = r.date;
      });
      if (isSetMode(p)) {
        // 套卷模式：getCompletedSets 按完成比例返回（板块加权），差值即上周实际完成套数
        exerciseSets += getCompletedSets(p, lastSun) - getCompletedSets(p, beforeWeek);
      } else {
        // 习题册模式：按合并后的页码区间算，差值即上周实际刷的页数
        exercisePages += getCompletedPagesAtDate(p, lastSun) - getCompletedPagesAtDate(p, beforeWeek);
      }
    }

    /* ===== 背书卡 & 错题本：items 结构 ===== */
    (p.items || []).forEach(it => {
      if (it.learnedDate) {
        heat[it.learnedDate] = (heat[it.learnedDate] || 0) + 1;
        if (!earliest || it.learnedDate < earliest) earliest = it.learnedDate;
        if (inWeek(it.learnedDate)) {
          if (p.type === 'recite') reciteNew++;
          else if (p.type === 'mistake') mistakeNew++;
        }
      }
      // reviews[0] 是首次学习，idx>0 才是真正的复习
      (it.reviews || []).forEach((rv, idx) => {
        if (!rv || !rv.date) return;
        heat[rv.date] = (heat[rv.date] || 0) + 1;
        if (!earliest || rv.date < earliest) earliest = rv.date;
        if (idx > 0 && inWeek(rv.date)) {
          if (p.type === 'recite') reciteReviews++;
          else if (p.type === 'mistake') mistakeReviews++;
        }
      });
      // 保持复习评价（已掌握条目的定期回顾）也计入复习次数
      (it.retentionReviews || []).forEach(rv => {
        if (!rv || !rv.date) return;
        heat[rv.date] = (heat[rv.date] || 0) + 1;
        if (!earliest || rv.date < earliest) earliest = rv.date;
        if (inWeek(rv.date)) {
          if (p.type === 'recite') reciteReviews++;
          else if (p.type === 'mistake') mistakeReviews++;
        }
      });
      // 上周攻克的错题
      if (p.type === 'mistake' && (it.mastered || it.manualMastered) && inWeek(it.masteredDate)) {
        mistakeMastered++;
      }
    });
  });

  let activeDays = 0;
  for (let i = 0; i < 7; i++) { if (heat[addDays(lastMon, i)]) activeDays++; }
  const streak = currentStreak(heat, today);
  const ageDays = earliest ? diffDays(earliest, today) + 1 : 0;
  // 汇总（套数/页数统一在累加后取整，避免多个项目各自四舍五入导致虚高）
  exerciseSets = Math.max(0, Math.round(exerciseSets));
  exercisePages = Math.max(0, Math.round(exercisePages));
  const totalReviews = reciteReviews + mistakeReviews;
  const totalNew = reciteNew + mistakeNew;

  return { isMonday, lastMon, lastSun, activeDays, streak, ageDays,
    exercisePages, exerciseSets,
    reciteNew, reciteReviews,
    mistakeNew, mistakeMastered, mistakeReviews,
    totalReviews, totalNew };
}

export function getWeeklyReviewHTML() {
  const today = todayStr();
  if (!Object.keys(store.projects || {}).length) return '';
  const s = buildWeeklyStats(today);
  // 只在周一显示上周小结，周一全天展示
  if (!s.isMonday) return '';
  // 完全没有任何学习数据时不显示
  if (s.ageDays <= 0) return '';
  // 上周完全没活动也不显示（没什么可总结的）
  if (s.activeDays === 0 && s.totalReviews === 0 && s.totalNew === 0
      && s.exercisePages === 0 && s.exerciseSets === 0 && s.mistakeMastered === 0) return '';

  // 构建数据描述文本（用于文案填充）：只描述该用户实际做过的事
  const parts = [];
  if (s.exercisePages > 0) parts.push(`刷了 ${s.exercisePages} 页题`);
  if (s.exerciseSets > 0) parts.push(`刷了 ${s.exerciseSets} 套卷`);
  if (s.reciteNew > 0) parts.push(`新背 ${s.reciteNew} 条`);
  if (s.reciteReviews > 0) parts.push(`复习背书 ${s.reciteReviews} 次`);
  if (s.mistakeNew > 0) parts.push(`收录 ${s.mistakeNew} 道错题`);
  if (s.mistakeMastered > 0) parts.push(`攻克错题 ${s.mistakeMastered} 道`);
  if (s.mistakeReviews > 0) parts.push(`复习错题 ${s.mistakeReviews} 次`);
  const whatYouDid = parts.length ? parts.join('、') : '完成了日常复习';

  const fill = t => t
    .replace(/\{days\}/g, s.activeDays)
    .replace(/\{streak\}/g, s.streak)
    .replace(/\{rest\}/g, 7 - s.activeDays)
    .replace(/\{reviews\}/g, s.totalReviews)
    .replace(/\{new\}/g, s.totalNew)
    .replace(/\{what(YouDid)?\}/g, whatYouDid);

  // 冲刺期建议池
  const sprintTips = [
    '进入冲刺阶段，优先保住高频考点和错题本，这是性价比最高的提分点。',
    '最后阶段别再大面积铺新内容，把学过的稳住、错题清零，比什么都强。',
    '越临近考试越要守住睡眠，清醒的头脑比熬夜多背的那点内容值钱得多。',
    '保持手感最重要：每天做点题、过一遍错题，让状态在考试当天到顶点。',
    '冲刺期复习讲究"回炉"，之前标记模糊、错过的内容，这阶段值得多看两遍。'
  ];

  let emoji, title, msgs, tips;
  const isNew = s.ageDays < 7;
  const ky = getKaoyanInfo();
  const isSprint = ky.state === 'countdown' && ky.days >= 0 && ky.days <= 30;

  if (isNew) {
    emoji = '🌱'; title = '第一周 · 起步';
    msgs = [
      '欢迎开始记录！第一步往往最难，你已经迈出来了。',
      '把学习提上日程的这一刻，你就已经和昨天的自己不一样了。',
      '万事开头难，你已经在路上了。先别急着追求完美，把"每天记一点"养起来。'
    ];
    tips = [
      '这周不用追求量，先熟悉"学习→复习→掌握"的流程，节奏会自己长出来。',
      '可以先从一个科目跑通完整流程，再慢慢加量，比一上来就铺满更稳。',
      '把每天的目标定得轻松一点，连续几天都能完成，比一次猛学有用得多。'
    ];
  } else if (s.activeDays === 0) {
    emoji = '🍃'; title = '上周 · 暂停了一下';
    msgs = [
      '上周暂时没有学习记录，没关系，节奏断了随时能接上。',
      '休息本来就是备考的一部分。重要的不是从没停下，而是停下后还愿意回来。',
      '上周留白了，不代表前面的努力白费——学过的还在，捡起来比从零开始快得多。',
      '停了一周？完全来得及。今天打开这个看板，就已经是重新开始了。'
    ];
    tips = [
      '别想着一天补回一周的量，今天先学十几分钟、做几条复习，把状态找回来。',
      '把门槛降到最低：哪怕只复习3条、只看1页，先让"今天学过"这件事发生。',
      '如果确实太累，就允许自己再缓一天，但定一个具体的重启时间，别让暂停变放弃。'
    ];
  } else if (s.activeDays === 7) {
    emoji = '🔥'; title = '上周 · 全勤';
    msgs = [
      `上周7天全勤！${whatYouDid}，这份自律已经超过绝大多数人了。`,
      `一周七天一天不落，${whatYouDid}，你的稳定本身就是最强的竞争力。`,
      `全勤达成！${whatYouDid}，能每天坐下来学，本身就是很了不起的事。`,
      `连续一周都在线——${whatYouDid}，你正在用行动告诉自己"我是能坚持的人"。`
    ];
    tips = [
      '状态正好，也留意疲劳信号，睡够比多刷几道题更影响长期效率。',
      '全勤很燃，记得留一点喘息时间——能稳稳走到12月的节奏才是好节奏。',
      '天数已经拉满，接下来可以把注意力放到薄弱环节的质量上。'
    ];
  } else if (s.streak >= 7 && s.activeDays >= 5) {
    emoji = '💪'; title = '上周 · 稳定输出';
    msgs = [
      `已经连续打卡 {streak} 天，上周{whatYouDid}，坚持正在变成你的习惯。`,
      `连续学了 {streak} 天，上周{whatYouDid}，这种细水长流的稳定最难得。`,
      `{streak} 天的连续记录背后，上周{whatYouDid}，都是一天天攒下来的硬功夫。`
    ];
    tips = [
      '惯性已经建立，继续保持就好，周末也可以心安理得地放松半天。',
      '趁状态稳定，定期回看一眼整体进度，确认方向没有跑偏。',
      '稳定是你的优势，接下来可以在每天的内容质量上再抠细一点。'
    ];
  } else if (s.activeDays >= 5) {
    emoji = '📈'; title = '上周 · 节奏不错';
    msgs = [
      `上周学了 {days} 天，{whatYouDid}，这个节奏相当扎实。`,
      `一周 {days} 天在学习，{whatYouDid}，已经跑赢了大多数人的状态。`,
      `{days} 天的投入——{whatYouDid}——正在悄悄把你和目标的距离一点点缩短。`
    ];
    tips = [
      '离全勤只差一两天，回想那天被什么占住了，能提前安排就更好。',
      '节奏很好，别让偶尔的一两天中断，悄悄连成更长的松懈。',
      '保持这个频率，同时留意复习是否及时，别让欠账在后台累积。'
    ];
  } else if (s.activeDays >= 3) {
    emoji = '🌤️'; title = '上周 · 张弛有度';
    msgs = [
      `上周学了 {days} 天，{whatYouDid}，已经有了一个不错的基本盘。`,
      `{days} 天学习、{rest} 天休整，{whatYouDid}，张弛之间再加一点点就很理想。`,
      `上周有 {days} 天在推进——{whatYouDid}——节奏在线，还有往上走的空间。`
    ];
    tips = [
      '试着把学习固定在每天同一时段，变成像吃饭一样的动作，天数会自然上来。',
      '从最容易上手的科目开始，先坐下、先学十分钟，往往就停不下来了。',
      '一周三到四天是不错的底子，把目标定在五天，踮踮脚就能够到。'
    ];
  } else {
    emoji = '🌦️'; title = '上周 · 刚起步';
    msgs = [
      `上周学了 {days} 天，{whatYouDid}，虽然不多，但至少没有完全空白。`,
      `上周只记录了 {days} 天，{whatYouDid}，没关系，这周从一个小目标重新起步就好。`,
      `有 {days} 天的开始就不算晚，{whatYouDid}，真正可惜的是一直不开始。`
    ];
    tips = [
      '先别定大计划，这周争取比上周多一天，这就是实打实的进步。',
      '把学习材料放到最顺手的地方，减少"开始"那一下的阻力。',
      '哪怕每天只学二十分钟，一周也能攒出两个多小时，关键是先让频率上来。'
    ];
  }
  if (isSprint) tips = sprintTips;

  // 数据格：根据用户实际使用的模式动态显示，没有数据的指标不出现
  const stat = (num, lab) => `<div class="wr-stat"><div class="wr-num">${num}</div><div class="wr-lab">${lab}</div></div>`;
  // 复习卡片：只有一种模式时显示具体名称，两种都有则显示汇总
  let reviewCard = null;
  if (s.reciteReviews > 0 && s.mistakeReviews > 0) reviewCard = stat(s.totalReviews, '复习总次数');
  else if (s.reciteReviews > 0) reviewCard = stat(s.reciteReviews, '复习背书');
  else if (s.mistakeReviews > 0) reviewCard = stat(s.mistakeReviews, '复习错题');
  const statsHtml = [
    stat(s.activeDays + ' / 7', '学习天数'),
    s.exercisePages > 0 ? stat(s.exercisePages, '刷题页数') : null,
    s.exerciseSets > 0 ? stat(s.exerciseSets, '刷题套数') : null,
    s.reciteNew > 0 ? stat(s.reciteNew, '新背内容') : null,
    s.mistakeNew > 0 ? stat(s.mistakeNew, '新增错题') : null,
    reviewCard,
    s.mistakeMastered > 0 ? stat(s.mistakeMastered, '攻克错题') : null,
    stat(s.streak, '连续打卡')
  ].filter(Boolean).join('');

  return `
    <div class="weekly-review">
      <div class="wr-head">
        <span class="wr-title">${emoji} ${title} · 学习小结</span>
        <span class="wr-date">${fmtCN(s.lastMon)} - ${fmtCN(s.lastSun)}</span>
      </div>
      <div class="wr-stats">${statsHtml}</div>
      <div class="wr-msg">${fill(_pick(msgs))}</div>
      <div class="wr-tip">💡 ${fill(_pick(tips))}</div>
    </div>`;
}

// 今天对"已学内容"完成的复习评价数（录入当天的首次评价不算复习）
export function getTodayReviewedCount(p) {
  const today = todayStr();
  let n = 0;
  (p.items || []).forEach(it => {
    if (!it.reviews) return;
    const t = it.reviews.filter(r => r.date === today).length;
    if (!t) return;
    n += (it.learnedDate === today) ? Math.max(0, t - 1) : t;
  });
  return n;
}

// 统一的"今日状态"：done 已完成 / partial 进行中 / todo 未开始 / none 今日无安排（所有模式同一口径）
export function getTodayStatus(p) {
  const m = getMetrics(p);
  if (p.type === 'exercise') {
    if (m && m.remaining <= 0) return { state: 'done' };
    const target = m ? getDailyTarget(p, m).per : 0;
    const td = m ? (m.todayDone || 0) : 0;
    if (!(target > 0)) return { state: 'none' };
    if (td >= target) return { state: 'done', need: target, done: td };
    if (td > 0) return { state: 'partial', need: target, done: td };
    return { state: 'todo', need: target, done: 0 };
  }
  const due = getDueItems(p).length;
  const reviewed = getTodayReviewedCount(p);
  let nNeed = 0, nDone = 0, hasNew = false;
  if (p.type === 'recite' && m && m.remaining > 0 && m.feasibility !== 'impossible') {
    const plan = getDailyTarget(p, m).per;
    if (plan != null && plan > 0) { hasNew = true; nNeed = plan; nDone = m.todayDone || 0; }
  }
  const revNeed = due + reviewed, totalNeed = revNeed + nNeed;
  if (totalNeed === 0) {
    if (p.type === 'recite' && m && m.remaining <= 0) return { state: 'done' };
    return { state: 'none' };
  }
  if (due === 0 && (!hasNew || nDone >= nNeed)) return { state: 'done', need: totalNeed, done: totalNeed };
  const progress = reviewed + Math.min(nDone, nNeed);
  if (progress > 0) return { state: 'partial', need: totalNeed, done: progress, due };
  return { state: 'todo', need: totalNeed, done: 0, due };
}

export function openDashboard() {
  const ps = Object.values(store.projects);
  const today = todayStr();
  let dueTotal = 0, overdueTotal = 0, retentionTotal = 0;
  const heat = {};
  const exRows = [], reRows = [], miRows = [];
  let plannedPageTotal = 0, plannedSetTotal = 0;
  let tasksTotal = 0, tasksDone = 0, tasksInProgress = 0, tasksOver = 0;

  ps.forEach(p => {
    (p.records || []).forEach(r => { heat[r.date] = (heat[r.date] || 0) + 1; });
    (p.items || []).forEach(it => {
      if (it.learnedDate) heat[it.learnedDate] = (heat[it.learnedDate] || 0) + 1;
      (it.reviews || []).forEach(rv => { heat[rv.date] = (heat[rv.date] || 0) + 1; });
    });
    let done = 0, total = 0, pct = 0, unit = '';
    if (p.type === 'exercise') {
      total = (p.unitMode && Array.isArray(p.units) && p.units.length)
        ? countRanges(getTargetPageRanges(p))
        : ((p.bookStartPage != null && p.bookEndPage != null) ? (p.bookEndPage - p.bookStartPage + 1) : (p.total || 0));
      done = isSetMode(p) ? getCompletedSets(p) : getCompletedPages(p);
      unit = isSetMode(p) ? '套' : '页';
      pct = total > 0 ? done / total * 100 : 0;
      const m = getMetrics(p);
      let planned = 0, planFeasible = true;
      if (m) {
        if (m.feasibility === 'impossible') { planFeasible = false; }
        else planned = getDailyTarget(p, m).per;
      }
      if (planFeasible) { if (isSetMode(p)) plannedSetTotal += planned; else plannedPageTotal += planned; }
      const _exSt = getTodayStatus(p);
      exRows.push({ name: p.name, pct, done, total, unit, planned: planFeasible ? planned : -1, st: _exSt });
      if (_exSt.state !== 'none') {
        tasksTotal++;
        if (_exSt.state === 'done') tasksDone++;
        if (_exSt.state === 'partial') tasksInProgress++;
        if (m && m.remaining > 0 && (m.todayDone||0) > getDailyTarget(p, m).per * 1.2) tasksOver++;
      }
    } else {
      const items = p.items || [];
      const due = getDueItems(p).length;
      const over = getOverdueItems(p).length;
      dueTotal += due; overdueTotal += over;
      retentionTotal += getRetentionDueItems(p).length;
      // 进度口径与主页一致：背书按已背页数 / 总页数；错题按已攻克 / 已收录条数
      if (p.type === 'recite') {
        total = (p.unitMode && Array.isArray(p.units) && p.units.length)
          ? countRanges(getTargetPageRanges(p))
          : ((p.bookStartPage != null && p.bookEndPage != null) ? (p.bookEndPage - p.bookStartPage + 1) : (p.total || 0));
        done = getCompletedPages(p);
      }
      else { total = items.length; done = items.filter(it => it.mastered || it.manualMastered).length; }
      pct = total > 0 ? done / total * 100 : 0;
      const mm = getMetrics(p);
      let plan = null, planBad = false, approx = false;
      if (mm && p.type === 'recite') {
        // 背书：每个学习日新学目标，数据不足时退回粗略均摊
        if (mm.feasibility === 'impossible') planBad = true;
        else { plan = getDailyTarget(p, mm).per; approx = !mm.enoughData; }
      }
      const ru = unitName(p);
      const _rvSt = getTodayStatus(p);
      const row = { name: p.name, pct, done, total, due, over, plan, planBad, approx, unit: ru, st: _rvSt };
      if (p.type === 'recite') reRows.push(row); else miRows.push(row);
      if (_rvSt.state !== 'none') {
        tasksTotal++;
        if (_rvSt.state === 'done') tasksDone++;
        if (_rvSt.state === 'partial') tasksInProgress++;
        if (p.type === 'recite' && mm && mm.remaining > 0 && (mm.todayDone||0) > plan * 1.2) tasksOver++;
      }
    }
  });

  const fmtD = v => Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString();
  let plannedSummary = '';
  if (plannedPageTotal > 0 || plannedSetTotal > 0) {
    plannedSummary = `学习日刷题建议：` +
      (plannedPageTotal > 0 ? `约 ${fmtD(plannedPageTotal)} 页` : '') +
      (plannedPageTotal > 0 && plannedSetTotal > 0 ? ' + ' : '') +
      (plannedSetTotal > 0 ? `约 ${fmtD(plannedSetTotal)} 套` : '') +
      '（休息日不摊任务）';
  }
  const hasPlan = plannedPageTotal > 0 || plannedSetTotal > 0;
  const reviewTotal = dueTotal;

  const streak = currentStreak(heat, today);

  let msg, enc, urgent = false;
  const g = timeGreeting();
  if (overdueTotal > 0) {
    msg = `有 <b>${overdueTotal}</b> 条已逾期，先把这些最该复习的清掉`; urgent = true;
    enc = '越拖越忘，今天搞定就是胜利！';
  } else if (tasksTotal > 0 && tasksDone >= tasksTotal) {
    if (tasksOver > 0) { msg = '今天的任务全部完成，还超额了'; enc = Coach.pick(Coach.overBig, 'dashover'); }
    else { msg = `今天 ${tasksTotal} 个任务全部完成`; enc = Coach.pick(Coach.done, 'dashdone'); }
  } else if (tasksTotal > 0 && tasksDone > 0) {
    msg = `今天已完成 <b>${tasksDone}/${tasksTotal}</b> 个任务，还剩 ${tasksTotal - tasksDone} 个`;
    enc = Coach.pick(Coach.dashPartial, 'dashpartial');
  } else if (tasksInProgress > 0) {
    const _todoN = tasksTotal - tasksDone - tasksInProgress;
    msg = `已经开了个好头：<b>${tasksInProgress}</b> 个进行中` + (_todoN > 0 ? `，还有 <b>${_todoN}</b> 个待开始` : '') + '，顺手做完';
    enc = Coach.pick(Coach.dashPartial, 'dashprogress');
  } else if (tasksTotal > 0) {
    msg = dueTotal > 0
      ? `今天有 <b>${dueTotal}</b> 条待复习，从它开始（共 ${tasksTotal} 个任务）`
      : `今天还有 <b>${tasksTotal}</b> 个任务待完成，从最顺手的开始`;
    enc = '迈出第一步最重要，开个好头～';
  } else if (retentionTotal > 0) {
    msg = `今天任务已清完，还有 <b>${retentionTotal}</b> 条已掌握内容可快速巩固`;
    enc = '花几分钟确认还记得，记忆更牢～';
  } else {
    msg = '今天没有待完成的任务，状态很好';
    enc = '轻松一下，也可以趁机动点新内容！';
  }
  const statusChip = st => {
    if (!st) return '';
    if (st.state === 'done') return '<span class="ts-chip ts-done" title="今天的目标已全部完成">✓ 今日已完成</span>';
    if (st.state === 'partial') return `<span class="ts-chip ts-partial" title="今天已完成 ${fmtD(st.done)} / 共需 ${fmtD(st.need)}">◐ ${fmtD(st.done)}/${fmtD(st.need)}</span>`;
    if (st.state === 'todo') return `<span class="ts-chip ts-todo" title="今天还有目标没完成">● 今日未完成${st.due ? ' · ' + st.due + '条' : ''}</span>`;
    return '<span class="ts-chip ts-none" title="今天没有安排任务">今日无安排</span>';
  };
  const rowHtml = r => `
    <div class="dash-proj">
      <span class="dp-name" title="${esc(r.name)}">${esc(r.name)}</span>
      <div class="dp-bar"><div class="dp-fill" style="width:${Math.max(0, Math.min(100, r.pct)).toFixed(1)}%"></div></div>
      <span class="dp-pct">${r.total === 0 ? '待收录' : fmtD(r.done) + '/' + fmtD(r.total)}</span>
      ${statusChip(r.st)}
    </div>`;
  const section = (title, sub, rows) => `
    <div style="font-weight:600;font-size:14px;margin:14px 0 4px">${title} <span style="font-weight:400;font-size:12px;color:var(--muted)">${sub}</span></div>
    <div>${rows.length ? rows.map(r => rowHtml(r)).join('') : '<div style="color:var(--muted);font-size:12.5px;padding:6px 0">还没有这类任务，新建后会显示在这里~</div>'}</div>`;

  const remind = getReminder();
  const planParts = [];
  if (plannedPageTotal > 0) planParts.push(fmtD(plannedPageTotal) + '页');
  if (plannedSetTotal > 0) planParts.push(fmtD(plannedSetTotal) + '套');
  const planNum = planParts.length ? planParts.join('+') : '—';
  let notifHtml;
  // 始终显示提醒设置界面：系统通知不可用时自动降级为应用内提醒
  const sysNotifOK = 'Notification' in window && Notification.permission === 'granted';
  const sysNotifShort = !('Notification' in window)
    ? '应用内提醒'
    : (Notification.permission === 'granted' ? '系统通知+应用内' : '应用内提醒');
  const timeRows = getReminder().times.map(t =>
    `<div class="rt-row" style="display:flex;gap:6px;align-items:center">
        <input type="time" class="rt-time" value="${t}" style="padding:6px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px">
        <button type="button" class="rt-del ghost-btn" title="删除这个时间" style="padding:6px 10px">×</button>
      </div>`).join('');
  const toggleStyle = remind.enabled
    ? 'background:#e8f5e9;color:#2e7d32;border-color:#a5d6a7;font-weight:600'
    : '';
  const toggleText = remind.enabled ? '已开启' : '未开启';
  notifHtml = `<div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-weight:600;font-size:14px">每日提醒</div>
        <span style="font-size:11px;color:var(--muted);background:var(--bg);padding:3px 8px;border-radius:10px">${sysNotifShort}</span>
      </div>
      <div style="display:flex;gap:12px;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;color:var(--muted);margin-bottom:6px">提醒时间（可多个）</div>
          <div id="remindTimes" style="display:flex;flex-direction:column;gap:6px">
            ${timeRows}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button type="button" class="ghost-btn" id="btnAddTime" style="padding:6px 12px;font-size:12px;white-space:nowrap">＋ 添加</button>
          <button class="ghost-btn" id="btnToggleRemind" style="padding:6px 12px;font-size:12px;white-space:nowrap;${toggleStyle}">${toggleText}</button>
          <button class="ghost-btn" id="btnPreviewRemind" style="padding:6px 12px;font-size:12px;white-space:nowrap">预览</button>
        </div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:10px;line-height:1.6">
        到点按任务分别提醒今日待办。手机端保持页面打开即可，关闭后下次打开会补发错过的提醒。
      </div>
    </div>`;

  $('#dashBody').innerHTML = `
    ${getKaoyanHTML()}
    ${getWeeklyReviewHTML()}
    <div class="dash-hero ${urgent ? 'urgent' : ''}">
      <div class="greet-big">${g}${(typeof STAuth!=="undefined"&&STAuth.isLoggedIn()&&STAuth.getUsername())?"，"+STAuth.getUsername()+"！":""}</div>
      <div class="greet-sub">这是你今天的学习看板</div>
      <div class="hero-status">${msg}</div>
      <div class="hero-enc">${enc}</div>
    </div>
    <div class="dash-grid">
      <div class="dash-card"><div class="dash-num" style="color:${overdueTotal > 0 ? '#b02e24' : 'inherit'}">${reviewTotal}</div><div class="dash-lab">今日待复习（背书+错题）${overdueTotal > 0 ? ' · <b style="color:#b02e24">含' + overdueTotal + '条逾期</b>' : ''}</div></div>
      <div class="dash-card"><div class="dash-num">${planNum}</div><div class="dash-lab">刷题 · 每学习日目标</div></div>
      <div class="dash-card"><div class="dash-num">${streak}</div><div class="dash-lab">连续打卡（天）</div></div>
    </div>
    ${section('刷题', '名称 · 总进度 · 今日状态', exRows)}
    ${section('背书', '名称 · 总进度 · 今日状态', reRows)}
    ${section('错题', '名称 · 总进度 · 今日状态', miRows)}
    ${notifHtml}
  `;
  $('#dashMask').hidden = false;
  modalTop($('#dashMask'));
  const collectTimes = () => [...document.querySelectorAll('#remindTimes .rt-time')]
    .map(i => i.value).filter(isValidHHMM);
  const timesBox = $('#remindTimes');
  if (timesBox) {
    timesBox.addEventListener('click', e => {
      const del = e.target.closest('.rt-del');
      if (!del) return;
      const cur = getReminder();
      const rows = [...document.querySelectorAll('#remindTimes .rt-row')];
      if (rows.length <= 1) { alert('至少保留一个提醒时间～'); return; }
      del.closest('.rt-row').remove();
      saveReminder(cur.enabled, collectTimes());
      openDashboard();
    });
    timesBox.addEventListener('change', e => {
      if (!e.target.classList.contains('rt-time')) return;
      const cur = getReminder();
      saveReminder(cur.enabled, collectTimes());
    });
  }
  const addBtn = $('#btnAddTime');
  if (addBtn) addBtn.addEventListener('click', () => {
    const cur = getReminder();
    const presets = ['08:00', '12:00', '18:00', '21:00', '07:30', '12:30', '22:00'];
    const next = presets.find(t => !cur.times.includes(t)) || '20:00';
    saveReminder(cur.enabled, cur.times.concat(next));
    openDashboard();
  });
  const b = $('#btnToggleRemind');
  if (b) b.addEventListener('click', async () => {
    const curRem = getReminder();
    const times = collectTimes().length ? collectTimes() : curRem.times;
    if (!curRem.enabled) {
      // 尝试请求系统通知权限，但不强制——被拒绝或不支持时自动降级为应用内提醒
      if ('Notification' in window && Notification.permission !== 'granted') {
        try { await Notification.requestPermission(); } catch (e) {}
      }
      if ('Notification' in window && Notification.permission !== 'granted') {
        alert('系统通知权限未授权，已为你开启应用内提醒（页面打开时顶部弹窗+提示音）。下次打开页面时也会补发错过的提醒。');
      }
      saveReminder(true, times);
    } else {
      saveReminder(false, times);
    }
    openDashboard();
  });
  const pv = $('#btnPreviewRemind');
  if (pv) pv.addEventListener('click', () => {
    const body = buildReminderBody();
    fireReminder('Study Tracker 学习提醒（预览）', body);
  });
}
/* iOS/PWA 下 body{overflow:hidden} 无法阻止背景滚动，改用 position:fixed + 记录 scrollTop */
export let _bodyScrollY = 0, _bodyLockCount = 0;
export function lockBodyScroll() {
  if (_bodyLockCount === 0) {
    _bodyScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${_bodyScrollY}px`;
    document.body.style.width = '100%';
  }
  _bodyLockCount++;
}
export function unlockBodyScroll() {
  // 防御：计数已<=0但仍有残留style，强制清除（避免某处漏了lock导致body永久fixed）
  if (_bodyLockCount <= 0) {
    _bodyLockCount = 0;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    return;
  }
  _bodyLockCount--;
  if (_bodyLockCount === 0) {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, _bodyScrollY);
  }
}
export function closeDashboard() { const m=$('#dashMask'); if(m.hidden) return; m.hidden=true; unlockBodyScroll(); }
export function modalTop(maskEl){
  // 幂等：弹窗已显示时说明是刷新操作，不重复锁定滚动和压栈（避免lock计数>unlock次数导致body永久fixed无法滚动）
  if (maskEl && !maskEl.hidden) return;
  lockBodyScroll(); // 同步锁定，避免 unlock 先于 lock 执行导致 body 永久锁死
  // 校准遮罩高度：清除上次键盘弹起残留的内联高度，按当前可视区重新设置
  maskEl.style.height = ''; maskEl.style.top = '';
  if (window.visualViewport){
    maskEl.style.height = window.visualViewport.height + 'px';
    maskEl.style.top = window.visualViewport.offsetTop + 'px';
  }
  // 安卓/微信返回键支持：打开弹窗时压入历史栈，按返回键会触发 popstate 关闭弹窗（见下方监听）
  try { history.pushState({ __stModal: true }, ''); } catch (e) {}
  requestAnimationFrame(()=>{ const m=maskEl.querySelector('.modal'); if(m) m.scrollTop=0; });
}

/* 安卓/微信返回键：关闭最上层弹窗（dataSecurityMask 必须点按钮，返回键不关闭） */
window.addEventListener('popstate', () => {
  const openIds = ALL_MODAL_IDS.filter(id => {
    const el = document.getElementById(id);
    return el && !el.hidden;
  });
  if (!openIds.length) return;
  const topId = openIds[openIds.length - 1];
  if (topId === 'dataSecurityMask') {
    // 数据安全提示必须点按钮：返回键不关闭，但要重新压栈补偿，保持弹窗与历史栈对齐
    try { history.pushState({ __stModal: true }, ''); } catch (e) {}
    return;
  }
  const el = document.getElementById(topId);
  if (!el) return;
  el.hidden = true;
  unlockBodyScroll();
});

/* 软键盘（iOS/安卓）人性化适配。键盘弹起时 visualViewport 缩小：
   1) 更新 --vvh 让弹窗高度收缩；2) 让打开的遮罩只占可视区，不被键盘盖住；
   3) 把当前聚焦的输入框滚入视野。 */
export function stActiveMask(){
  var masks = document.querySelectorAll('.mask');
  for (var i=0;i<masks.length;i++){ if(!masks[i].hidden) return masks[i]; }
  return null;
}
export function stScrollFocused(){
  var ae = document.activeElement;
  if(ae && (ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.tagName==='SELECT')){
    setTimeout(function(){
      try { ae.scrollIntoView({block:'center', inline:'nearest'}); }
      catch(e){ try{ae.scrollIntoView(false);}catch(_){} }
    }, 320);
  }
}
if (window.visualViewport) {
  var vv = window.visualViewport;
  var onVVChange = function(){
    document.documentElement.style.setProperty('--vvh', vv.height + 'px');
    var m = stActiveMask();
    if(m){ m.style.height = vv.height + 'px'; m.style.top = vv.offsetTop + 'px'; }
    stScrollFocused();
  };
  vv.addEventListener('resize', onVVChange);
  vv.addEventListener('scroll', onVVChange);
}
/* 弹窗内输入框聚焦：等键盘动画结束后自动滚到可视区中部，避免被键盘遮挡 */
document.addEventListener('focusin', function(e){
  var t = e.target;
  if(t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT') && t.closest && t.closest('.mask')){
    setTimeout(function(){
      try { t.scrollIntoView({block:'center', inline:'nearest'}); }
      catch(e){ try{t.scrollIntoView(false);}catch(_){} }
    }, 360);
  }
});

export function buildReminderBody() {
  const today = todayStr();
  const projects = Object.values(store.projects);
  
  // 按优先级分组收集
  const overdueItems = [];    // 逾期
  const dueItems = [];        // 今日待复习/待解决
  const planItems = [];       // 今日计划（刷题/背书新学）
  const doneItems = [];       // 今日已达标
  const lazyProjects = [];    // 摆烂提醒
  
  let totalOverdue = 0;
  let hasAnyTask = false;
  
  projects.forEach(p => {
    const m = getMetrics(p);
    const unit = isSetMode(p) ? '套' : (p.type === 'mistake' ? '道' : '页');
    
    // 摆烂检测
    const lazy = getLazyInfo(p);
    if (lazy.days >= 3 && (p.items || []).length > 0 && m && m.remaining > 0) {
      lazyProjects.push({ name: p.name, days: lazy.days });
    }
    
    if (p.type === 'exercise') {
      // 刷题任务
      let need = 0;
      if (m) {
        if (m.feasibility === 'impossible') {
          planItems.push({ name: p.name, text: `截止日紧张，建议调整计划`, urgent: true });
          hasAnyTask = true;
        } else {
          need = getDailyTarget(p, m).per;  // 与主页大字同一口径
        }
      }
      if (need > 0 && m) {
        hasAnyTask = true;
        const done = m.todayDone || 0;
        const needRounded = Math.round(need * 10) / 10;
        if (done >= need) {
          doneItems.push({ name: p.name, type: 'exercise', text: `今日目标${needRounded}${unit}，已完成${done}${unit} ✅` });
        } else {
          planItems.push({ name: p.name, type: 'exercise', text: `今日约${needRounded}${unit}${done > 0 ? `（已完成${done}${unit}）` : ''}`, urgent: false });
        }
      }
    } else {
      // 背书/错题
      const isMistake = p.type === 'mistake';
      const unitLabel = isMistake ? '道' : '条';
      const du = getDueItems(p).length;
      const ov = getOverdueItems(p).length;
      totalOverdue += ov;
      
      if (ov > 0) {
        overdueItems.push({ name: p.name, type: isMistake ? 'mistake' : 'recite', text: `${ov}${unitLabel}逾期${isMistake ? '错题' : '待复习'}` });
        hasAnyTask = true;
      }
      if (du > 0) {
        dueItems.push({ name: p.name, type: isMistake ? 'mistake' : 'recite', text: `${du}${unitLabel}今日${isMistake ? '待解决' : '待复习'}` });
        hasAnyTask = true;
      }
      
      // 错题本：无到期时显示进度
      if (isMistake && du === 0 && ov === 0 && m && m.remaining > 0) {
        doneItems.push({ name: p.name, type: 'mistake', text: `暂无到期错题（已攻克 ${m.currentPage}/${m.total} 道）` });
      }
      
      // 背书：新学计划
      if (!isMistake && m && m.remaining > 0 && m.feasibility !== 'impossible') {
        const need = getDailyTarget(p, m).per;  // 与主页背书大字同一口径
        if (need > 0) {
          hasAnyTask = true;
          const done = m.todayDone || 0;
          const needRounded = Math.round(need * 10) / 10;
          if (done >= need) {
            doneItems.push({ name: p.name, type: 'recite', text: `今日新学目标${needRounded}页，已完成${done}页 ✅` });
          } else {
            planItems.push({ name: p.name, type: 'recite', text: `今日新学约${needRounded}页${done > 0 ? `（已完成${done}页）` : ''}`, urgent: false });
          }
        }
      }
    }
  });
  
  // 构建提醒内容
  const parts = [];
  
  if (overdueItems.length) {
    parts.push('⚠️ 逾期（先清掉）');
    overdueItems.forEach(it => { const icon = it.type === 'mistake' ? '📝' : (it.type === 'recite' ? '📖' : '✏️'); parts.push(`• ${icon} ${it.name}：${it.text}`); });
    parts.push('');
  }
  
  if (dueItems.length) {
    parts.push('📝 今日待复习');
    dueItems.forEach(it => { const icon = it.type === 'mistake' ? '📝' : (it.type === 'recite' ? '📖' : '✏️'); parts.push(`• ${icon} ${it.name}：${it.text}`); });
    parts.push('');
  }
  
  if (planItems.length) {
    parts.push('📖 今日计划');
    planItems.forEach(it => { const icon = it.type === 'mistake' ? '📝' : (it.type === 'recite' ? '📖' : '✏️'); parts.push(`• ${icon} ${it.name}：${it.text}`); });
    parts.push('');
  }
  
  if (doneItems.length && !overdueItems.length && !dueItems.length && !planItems.length) {
    // 全部完成
    parts.push('🎉 今天的任务都达标啦！');
    doneItems.forEach(it => { const icon = it.type === 'mistake' ? '📝' : (it.type === 'recite' ? '📖' : '✏️'); parts.push(`• ${icon} ${it.name}：${it.text}`); });
    parts.push('');
    parts.push('💪 保持节奏，明天继续加油！');
  } else if (doneItems.length) {
    parts.push('✅ 已达标');
    doneItems.forEach(it => { const icon = it.type === 'mistake' ? '📝' : (it.type === 'recite' ? '📖' : '✏️'); parts.push(`• ${icon} ${it.name}：${it.text}`); });
    parts.push('');
  }
  
  if (!hasAnyTask && !lazyProjects.length) {
    return '今天没有待办，轻松一下～';
  }
  
  // 连续学习天数（结尾鼓励按状态走 Coach，时段问候已含在 Coach 里）
  let maxStreak = 0;
  projects.forEach(p => { const m = getMetrics(p); if (m && m.streakNow > maxStreak) maxStreak = m.streakNow; });
  
// 结尾鼓励统一走 Coach：按天哈希，同一天稳定、每天换新，不再 Math.random 跳老套句子
  let cheer = '';
  if (overdueItems.length) cheer = Coach.pick(Coach.back, 'rmback');
  else if (dueItems.length) cheer = Coach.pick(Coach.progress.mid, 'rmdue');
  else if (planItems.length && doneItems.length) cheer = Coach.pick(Coach.dashPartial, 'rmpartial');
  else if (planItems.length) cheer = Coach.pick(Coach.start[coachSlot()], 'rmstart');
  else if (doneItems.length) cheer = Coach.pick(Coach.done, 'rmdone');
  // 连续学习是真实成就，连续较久才带一句（不机械叠加时段问候，Coach 已含时段）
  let streakMsg = '';
  if (maxStreak >= 7) streakMsg = `（已经连续 ${maxStreak} 天，势头很猛）`;
  if (cheer) {
    if (parts.length && parts[parts.length - 1] !== '') parts.push('');
    parts.push(cheer + streakMsg);
  }

  // 摆烂提醒
  if (lazyProjects.length) {
    const names = lazyProjects.map(l => `${l.name}（${l.days}天）`).join('、');
    parts.push('');
    parts.push(`😴 ${names} 好几天没动了，先花几分钟找回状态吧～`);
  }

  return parts.join('\n').trim();
}

/* ---- 应用内提醒（移动端 Notification API 不可用时的兜底，桌面端也同时显示）---- */
export function ensureInAppReminderEl() {
  let el = $('#inAppReminder');
  if (!el) {
    el = document.createElement('div');
    el.id = 'inAppReminder';
    el.className = 'inapp-reminder';
    el.innerHTML = '<span class="iar-close">×</span><div class="iar-icon">🔔</div><div class="iar-content"><div class="iar-title"></div><div class="iar-body"></div></div>';
    document.body.appendChild(el);
    const closeIt = () => el.classList.remove('show');
    el.querySelector('.iar-close').addEventListener('click', closeIt);
    el.querySelector('.iar-close').addEventListener('touchstart', e => { e.preventDefault(); closeIt(); }, { passive: false });
  }
  return el;
}
export let _iarTimer = null;
export function showInAppReminder(title, body) {
  const el = ensureInAppReminderEl();
  el.querySelector('.iar-title').textContent = title;
  el.querySelector('.iar-body').textContent = body;
  el.classList.add('show');
  if (_iarTimer) clearTimeout(_iarTimer);
  // 提醒不自动关闭，需用户手动点×关闭
  try { playReminderBeep(); } catch (e) {}
}
/* 简单提示音（Web Audio API，无需音频文件） */
export function playReminderBeep() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    const ctx = new AC();
    // iOS Safari / 微信 X5：AudioContext 创建后默认 suspended，不 resume 就无声
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
    // 第二声
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2); gain2.connect(ctx.destination);
    osc2.frequency.value = 1100; osc2.type = 'sine';
    gain2.gain.setValueAtTime(0, ctx.currentTime + 0.25);
    gain2.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.27);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.65);
    osc2.start(ctx.currentTime + 0.25); osc2.stop(ctx.currentTime + 0.65);
    setTimeout(() => { try { ctx.close(); } catch (e) {} }, 800);
  } catch (e) {}
}
/* 统一提醒触发：优先系统通知，同时显示应用内提醒（双保险） */
export function fireReminder(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }); } catch (e) {}
  }
  showInAppReminder(title, body);
}
/* 检查并触发到点的提醒（供轮询和页面打开补发共用） */
export function checkAndFireReminders() {
  if (_booting) return false; // 数据还在恢复中，避免读到空 store 弹出错误提醒
  const r = getReminder();
  if (!r || !r.enabled) return false;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const mark = getFiredMark();
  let fired = false;
  r.times.forEach(t => {
    const [h, m] = t.split(':').map(Number);
    const planMin = h * 60 + m;
    // 只要当前时间已过计划时间、且今天这个时间点还没发过，就补发
    if (nowMin >= planMin && !mark.times.includes(t)) {
      mark.times.push(t);
      fired = true;
    }
  });
  if (!fired) return false;
  setLocalVal(REMIND_FIRED_KEY, JSON.stringify(mark));
  fireReminder('Study Tracker 学习提醒', buildReminderBody());
  return true;
}
// 每 30 秒轮询（页面打开状态下）
setInterval(checkAndFireReminders, 30000);
// 注意：首次调用已移到 boot() 内 loadStore 之后，避免时序竞争

export function rangeText(a, b) { return a === b ? `${a}` : `${a}-${b}`; }
// 获取"需要学习的页码范围"：启用单元模式时是所有单元范围的并集（自动排除习题等），未启用时是整本书正文范围
export function getTargetPageRanges(p) {
  if (p.unitMode && Array.isArray(p.units) && p.units.length) {
    // 兼容老数据：无 unitScopeMode 时，若有旧 unitScopeOnly=false 则为 book，否则默认 all（原有行为）
    const mode = p.unitScopeMode || (p.unitScopeOnly === false ? 'book' : 'all');
    if (mode === 'leaf' || mode === 'all') {
      const all = [];
      function collect(u) {
        const hasChildren = u.children && u.children.length;
        if (mode === 'all' || !hasChildren) {
          if (u.startPage != null && u.endPage != null && u.endPage >= u.startPage) {
            all.push({ start: u.startPage, end: u.endPage });
          }
        }
        (u.children || []).forEach(collect);
      }
      p.units.forEach(collect);
      if (all.length) return mergeRanges(all);
    }
  }
  // 轻量"只做部分页"：目标=用户列出的区间（自动合并重叠/去重）
  if (p.scopeMode && Array.isArray(p.targetRanges) && p.targetRanges.length) {
    return mergeRanges(p.targetRanges.map(r => ({ start: r.start, end: r.end })));
  }
  const lo = p.bookStartPage != null ? p.bookStartPage : 1;
  const hi = p.bookEndPage != null ? p.bookEndPage : (p.total || 0);
  if (hi >= lo) return [{ start: lo, end: hi }];
  return [];
}
export function getBookDoneRanges(p) {
  let raw;
  if (p.type === 'exercise') raw = (p.records || []).map(r => getRecordRange(r, p));
  else raw = (p.items || []).map(it => ({ start: getItemPageStart(it), end: getItemPageEnd(it) }));
  const targets = getTargetPageRanges(p);
  if (!targets.length) return [];
  const clipped = [];
  mergeRanges(raw).forEach(r => {
    targets.forEach(t => {
      const s = Math.max(t.start, r.start), e = Math.min(t.end, r.end);
      if (e >= s) clipped.push({ start: s, end: e });
    });
  });
  return mergeRanges(clipped);
}
export function complementRanges(done, total, start) {
  const gaps = [];
  let cur = start != null ? start : 1;
  done.forEach(r => {
    if (r.start > cur) gaps.push({ start: cur, end: r.start - 1 });
    cur = Math.max(cur, r.end + 1);
  });
  if (cur <= total) gaps.push({ start: cur, end: total });
  return gaps;
}
export function countRanges(rs) { return rs.reduce((s, r) => s + (r.end - r.start + 1), 0); }

export let ppExpandedSet = {}; // 按 projectId 存储展开的套卷索引，避免切换项目时状态串扰
export function renderProgressBoard(p) {
  const m = getMetrics(p);
  const u = unitName(p);
  const pct = m.total > 0 ? Math.min(100, m.currentPage / m.total * 100) : 0;
  $('#ppTitle').textContent = p.type === 'mistake' ? '📊 攻克进度' : (isSetMode(p) ? '📊 套卷完成情况' : '📊 习题册完成情况');

  const doneN = m.currentPage, totalN = m.total;
  $('#ppSummary').innerHTML = `
    <div class="pp-kpi"><div class="n">${fmtUnitNum(doneN)}</div><div class="l">已完成（${u}）</div></div>
    <div class="pp-kpi"><div class="n">${fmtUnitNum(m.remaining)}</div><div class="l">剩余（${u}）</div></div>
    <div class="pp-kpi"><div class="n">${pct.toFixed(1)}%</div><div class="l">总进度</div></div>`;

  const body = $('#ppBody');
  const detail = isSetMode(p) ? renderSetGrid(p) : renderBookBreakdown(p);
  body.innerHTML = renderProgressInsights(p, m) + detail;
}

/* 完成情况看板独有洞察：节奏/坚持、预测、漏做定位 */
export function renderProgressInsights(p, m) {
  const u = unitName(p);
  const setMode = isSetMode(p);
  const enough = m.enoughData;
  const num = v => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1));

  // —— 节奏与坚持卡 ——
  const trendCell = (() => {
    if (m.trendPct == null) return `<div class="pp-stat"><div class="v">—</div><div class="k">近7天节奏<br>数据积累中</div></div>`;
    const pctV = Math.round(m.trendPct * 100);
    if (Math.abs(pctV) < 10) return `<div class="pp-stat"><div class="v">→ 平稳</div><div class="k">近7天 vs 之前</div></div>`;
    if (pctV > 0) return `<div class="pp-stat"><div class="v up">↑ ${pctV}%</div><div class="k">近7天提速</div></div>`;
    return `<div class="pp-stat"><div class="v down">↓ ${-pctV}%</div><div class="k">近7天放缓</div></div>`;
  })();
  const breakCell = m.longestBreak >= 3
    ? `<div class="pp-stat"><div class="v warn">${m.longestBreak} 天</div><div class="k">最长停摆<br>注意别断太久</div></div>`
    : `<div class="pp-stat"><div class="v">${m.longestBreak} 天</div><div class="k">最长停摆</div></div>`;

  // 模式特有统计
  let modeCells = '';
  let gapWarn = '';
  if (setMode) {
    const state = getSetState(p);
    let cDone = 0, cPart = 0, cNone = 0;
    for (let n = 1; n <= p.total; n++) {
      const frac = state[n] ? getSetFraction(p, n, state) : 0;
      if (frac >= 0.999) cDone++; else if (frac > 0.0001) cPart++; else cNone++;
    }
    modeCells = `
      <div class="pp-stat"><div class="v up">${cDone}</div><div class="k">已完成套数</div></div>
      <div class="pp-stat"><div class="v warn">${cPart}</div><div class="k">部分完成</div></div>
      <div class="pp-stat"><div class="v">${cNone}</div><div class="k">未开始</div></div>`;
  } else {
    const doneRanges = getBookDoneRanges(p);
    const targets = getTargetPageRanges(p);
    // 对每个目标范围（单元范围或整本书范围）分别计算未完成，自动排除习题等不在范围内的页
    let undone = [];
    targets.forEach(t => {
      undone = undone.concat(complementRanges(doneRanges, t.end, t.start));
    });
    undone = mergeRanges(undone);
    // “夹在中间”的漏做段：在某个目标范围内，前后都还有内容
    const holes = undone.filter(r => {
      return targets.some(t => r.start > t.start && r.end < t.end);
    });
    const holePages = holes.reduce((s, r) => s + (r.end - r.start + 1), 0);
    modeCells = `<div class="pp-stat"><div class="v ${holes.length ? 'warn' : ''}">${holes.length}</div><div class="k">中间漏做段数</div></div>
      <div class="pp-stat"><div class="v ${holePages ? 'warn' : ''}">${holePages}</div><div class="k">漏做页数（${u}）</div></div>`;
    if (holes.length) {
      const preview = holes.slice(0, 6).map(r => rangeText(r.start, r.end)).join('、') + (holes.length > 6 ? ' 等' : '');
      gapWarn = `<div class="pp-gap-warn">⚠️ 已学范围内有 <b>${holes.length}</b> 段、共 <b>${holePages}</b> 页夹在中间还没做：${preview}。这些通常是当时跳过的难点，建议优先回看。</div>`;
    }
  }

  const _act = getActivityStreak(p, m.t);
  const _actLong = Math.max(_act.streak, _act.priorLongest || 0);
  const statGrid = `<div class="pp-insight-title">📈 学习节奏与坚持（近 ${m.windowDays} 天）</div>
    <div class="pp-stat-grid">
      <div class="pp-stat"><div class="v">${m.activeDays}</div><div class="k">学习日数</div></div>
      <div class="pp-stat"><div class="v">${enough ? num(m.perStudyDayRaw) : '—'}</div><div class="k">每次平均（${u}）</div></div>
      <div class="pp-stat"><div class="v">${enough ? num(m.activityPerWeek) : '—'}</div><div class="k">每周学习天数</div></div>
      <div class="pp-stat"><div class="v">${_act.streak} <span style="font-size:11px;color:var(--muted);font-weight:400">/ 最长${_actLong}</span></div><div class="k">当前连续（天）</div></div>
      ${breakCell}
      ${trendCell}
      ${modeCells}
    </div>
    ${gapWarn}`;

  // —— 完成预测盒 ——
  let etaLines = '';
  if (m.remaining <= 0) {
    etaLines = `🎉 已全部完成，共 ${fmtUnitNum(m.total)} ${u}。可以把目标总量或截止日调整到下一阶段。`;
  } else if (p.type === 'mistake') {
    // 错题本专属：滚动复习、攻克非线性，不做线性 ETA / 可行性判定（小样本"按攻克速度还需X周"会制造无谓焦虑）。
    // 只呈现：攻克进度 + 今日量 + 高频薄弱点，让用户"无脑清今天到期的"即可。
    const _due = getDueItems(p).length, _over = getOverdueItems(p).length;
    const _weak = (p.items || []).filter(it => !it.mastered && !it.manualMastered && (it.wrongStreak || 0) >= 2).length;
    let _dl = '';
    if (p.deadline) {
      const _dl2 = diffDays(m.t, p.deadline);
      if (_dl2 < 0) _dl = `<br>目标日已过 ${-_dl2} 天，错题仍会继续滚动复习，可在设置里调整目标日。`;
      else if (_dl2 <= 14) _dl = `<br>距目标日 ${fmtCN(p.deadline)} 还有 ${_dl2} 天，优先把每天到期的做熟，目标日前多过一轮最划算。`;
    }
    etaLines = `错题本按“收录 → 间隔复习 → 攻克”自动运转，<b>你不需要每天订目标</b>，只要清掉“今日复习”列表里的内容就好。<br>当前已攻克 <b>${fmtUnitNum(m.currentPage)}</b> / 共收录 <b>${fmtUnitNum(m.total)}</b> 道，待攻克 <b>${fmtUnitNum(m.remaining)}</b> 道${_due > 0 ? `，今天到期 <b>${_due}</b> 道${_over > 0 ? `（含逾期 ${_over} 道，会自动分批，不用一次做完）` : ''}` : ''}。${_weak > 0 ? `<br>其中 <b>${_weak}</b> 道反复错过，是你考前最该拿下的高频薄弱点。` : ''}<br>每攻克一道，都是实打实补上一个提分点。${_dl}`;
  } else if (p.type === 'recite' && m.sprint) {
    // 背书本冲刺期：不再给线性"完成区间"，呈现冲刺策略，避免用学新目标制造焦虑
    const _due = getDueItems(p).length;
    etaLines = `⏰ <b>已进入冲刺期</b>：距目标日 ${fmtCN(p.deadline)} 还有 ${m.daysLeft} 天，不足一个完整复习周期（约 ${m.cycleDays} 天）。<br>这段时间的重点不是把新书背完，而是<b>把已学内容牢牢记住</b>：先清每天到期的复习${_due > 0 ? `（今天 <b>${_due}</b> 条）` : ''}，再有余力挑最核心的内容学新。<br>系统会把复习都安排在目标日之前，模糊、忘记的内容会更频繁地出现，你只需按清单做即可。`;
  } else if (!enough) {
    const isMistake = p.type === 'mistake';
    let planNum = null, planNote = '';
    if (!isMistake) {
      // 背书：数据不足时显示粗略新学目标
      if (m.perStudyDay != null) {
        planNum = num(m.perStudyDay);
      } else if (isFinite(m.needPerDay) && m.needPerDay > 0) {
        planNum = num(m.needPerDay);
        planNote = '（粗估：把剩余量均摊到剩余自然日；再攒几个学习日就开始按你的真实节奏修正）';
      }
    }
    // 错题本：不预估"每天攻克多少"，只看今天到期的复习条目
    if (planNum != null) {
      etaLines = `完成时间范围还在估算中：再攒约 <b>${m.daysToMedium}</b> 个学习日就开始给出估算，累计满 7 个学习日（约 2 周）后会给出更可靠的“乐观～保守”完成区间。<br>当前先按每个学习日 <b>${planNum}</b> ${u} 的节奏推进即可${planNote}。`;
    } else if (isMistake) {
      etaLines = `错题本按“收录 → 间隔复习 → 攻克”运转，不需要每天订目标。遇到错题随时收录，到复习日会自动提醒你重做。<br>当前已攻克 <b>${m.currentPage}</b> / 共收录 <b>${m.total}</b> 道，待攻克 <b>${m.remaining}</b> 道。`;
    } else {
      etaLines = `完成时间范围还在估算中：再攒约 <b>${m.daysToMedium}</b> 个学习日就开始给出估算，累计满 7 个学习日（约 2 周）后范围更可靠。<br>当前未设截止日，可先按自己的节奏推进，或在设置里添加截止日获取每学习日目标。`;
    }
    if (m.sparseLogging) {
      etaLines += `<br><span style="color:#96600c">⚠️ 你最近打卡间隔较长（中位数约 ${m.medianGap} 天），产能估计可能有偏差，建议每天记录一次。</span>`;
    }
  } else {
    etaLines = `按你最近每周约 <b>${num(m.activityPerWeek)}</b> 个学习日、每次约 <b>${num(m.perStudyDayRaw)}</b> ${u} 的节奏：<br>预计在 <b>${fmtCN(m.etaEarlyDate)} ～ ${fmtCN(m.etaLateDate)}</b> 之间完成，基准约 <b>${fmtCN(m.etaDate)}</b>。`;
    if (m.feasibility === 'easy') etaLines += `<br><span style="color:var(--ok)">✅ 按当前节奏即可按时完成，保持就好。</span>`;
    else if (m.feasibility === 'stretch') {
      const sf = stretchFull(m);
      // 延期兜底用长期可持续口径，且日期必须晚于当前截止日才有意义
      let delayDate = null;
      if (m.feasibleDaysLong) {
        const d = addDays(m.t, Math.ceil(m.feasibleDaysLong));
        if (p.deadline && d > p.deadline) delayDate = d;
      }
      let body;
      if (sf) body = sf + (delayDate ? `，想更从容也可以把截止日延后到约 ${fmtCN(delayDate)}` : '');
      else body = delayDate
        ? `按你最近的节奏基本能按时完成，想留更多余量的话，可把截止日延后到约 ${fmtCN(delayDate)}`
        : `按你最近的节奏基本能按时完成，偶尔状态起伏也正常，正常推进就好`;
      etaLines += `<br><span style="color:#96600c">⚠️ ${body}。</span>`;
    }
    else if (m.feasibility === 'impossible') {
      const dLong = m.feasibleDaysLong ? addDays(m.t, Math.ceil(m.feasibleDaysLong)) : null;
      etaLines += `<br><span style="color:var(--bad)">🚧 按现在节奏缺口较大，建议增加每周学习天数${dLong ? `，或把截止日延后到约 ${fmtCN(dLong)}` : ''}。</span>`;
    }
    // 相对理想进度（与 getMetrics 同口径：填了 startDate 用它，否则用最早打卡日）
    if (m.effStart && p.deadline && m.total > 0) {
      const span = diffDays(m.effStart, p.deadline);
      const elapsed = diffDays(m.effStart, m.t);
      if (span > 0) {
        const ideal = m.total * Math.max(0, Math.min(1, elapsed / span));
        const g = Math.round(m.currentPage - ideal);
        if (Math.abs(g) >= 1) etaLines += g > 0
          ? `<br>📈 相对“${m.effStart}→${p.deadline} 匀速”的理想进度，<b style="color:var(--ok)">超前约 ${g} ${u}</b>。`
          : `<br>📉 相对理想进度，<b style="color:var(--bad)">慢了约 ${-g} ${u}</b>（这部分已经算进每天目标里，不用额外补）。`;
        else etaLines += `<br>➖ 与理想进度基本同步。`;
      }
    }
  }
  const etaBox = `<div class="pp-insight-title">🔮 完成预测</div><div class="pp-eta-box">${etaLines}</div>`;

  return `<div class="pp-insight">${statGrid}${etaBox}</div>`;
}

export function renderSetGrid(p) {
  const secs = getNormalizedSections(p);
  const rawSecs = getPaperSections(p);
  const state = getSetState(p);
  let cells = '';
  let cDone = 0, cPart = 0, cNone = 0;
  for (let n = 1; n <= p.total; n++) {
    const st = state[n];
    const frac = st ? getSetFraction(p, n, state) : 0;
    const pctN = Math.round(frac * 100);
    let cls = 'pp-cell';
    if (frac >= 0.999) { cls += ' done'; cDone++; }
    else if (frac > 0.0001) { cls += ' part'; cPart++; }
    else cNone++;
    const sub = frac >= 0.999 ? '已完成' : (frac > 0.0001 ? `${pctN}%` : '未开始');
    cells += `<div class="${cls}" data-set="${n}">
      <div class="c-no">${esc(paperLabel(p, n))}</div><div class="c-pct">${sub}</div></div>`;
    if (ppExpandedSet[p.id] === n) {
      let detail = '';
      if (secs.length) {
        detail = secs.map(s => {
          const v = st ? (st.secs[s.id] || 0) : 0;
          return `<div class="pp-sec-row">
            <span class="pp-sec-name">${esc(s.name)}<span class="muted" style="font-size:11px"> ·${s.weight}%</span></span>
            <span class="pp-sec-track"><span class="pp-sec-fill" style="width:${v}%"></span></span>
            <span class="pp-sec-val">${Math.round(v)}%</span></div>`;
        }).join('');
      } else {
        const v = st ? Math.round(st.legacy * 100) : 0;
        detail = `<div class="pp-sec-row"><span class="pp-sec-name">完成度</span>
          <span class="pp-sec-track"><span class="pp-sec-fill" style="width:${v}%"></span></span>
          <span class="pp-sec-val">${v}%</span></div>`;
      }
      cells += `<div class="pp-cell-detail open" data-detail="${n}">
        <div style="font-size:12.5px;color:var(--muted);margin-bottom:9px">${esc(paperLabel(p, n))} 各板块完成度${rawSecs.length ? '' : '（未划分板块，按整套/题数记录）'}</div>
        ${detail}</div>`;
    }
  }
  const legend = `<div class="pp-legend">
    <span><i style="background:#fff;border:1.5px solid var(--line)"></i>未开始 ${cNone}</span>
    <span><i style="background:#fdf6e7;border:1.5px solid #f0d29a"></i>部分完成 ${cPart}</span>
    <span><i style="background:#e8f7f0;border:1.5px solid #9fdcc2"></i>已完成 ${cDone}</span>
    <span style="margin-left:auto">点击任意套查看板块明细</span></div>`;
  return `<div class="pp-grid">${cells}</div>${legend}`;
}

export function renderBookBreakdown(p) {
  const done = getBookDoneRanges(p);
  const targets = getTargetPageRanges(p);
  // 对每个目标范围分别计算未完成，自动排除习题等不在范围内的页
  let undone = [];
  targets.forEach(t => {
    undone = undone.concat(complementRanges(done, t.end, t.start));
  });
  undone = mergeRanges(undone);
  const useUnit = p.unitMode && (p.units || []).length;

  if (useUnit) {
    // 递归收集单元的所有页码范围（含子单元）
    function collectPages(unit) {
      let pages = [];
      if (unit.startPage != null && unit.endPage != null) pages.push([unit.startPage, unit.endPage]);
      (unit.children || []).forEach(c => pages = pages.concat(collectPages(c)));
      return pages;
    }
    function renderBookUnit(u, level) {
      const allPages = collectPages(u);
      const us = allPages.length ? Math.min(...allPages.map(p => p[0])) : (u.startPage || 0);
      const ue = allPages.length ? Math.max(...allPages.map(p => p[1])) : (u.endPage || 0);
      const len = Math.max(1, ue - us + 1);
      let d = 0;
      done.forEach(r => {
        const s = Math.max(r.start, us), e = Math.min(r.end, ue);
        if (e >= s) d += e - s + 1;
      });
      d = Math.max(0, Math.min(len, d));
      const pctU = len > 0 ? d / len * 100 : 0;
      const indent = level * 16;
      const hasChildren = u.children && u.children.length > 0;
      const childInfo = hasChildren ? ` · ${u.children.length}个子单元` : '';
      let html = `<div class="pp-unit-row" style="padding-left:${indent}px">
        <div class="pp-unit-head">
          <span>${level > 0 ? '└ ' : ''}📁 ${esc(u.name || '未命名单元')} <span class="muted" style="font-size:12px">P${us}-P${ue}</span></span>
          <span class="muted">${d}/${len} 页 · ${pctU.toFixed(0)}%${childInfo}</span>
        </div>
        <div class="pp-unit-track"><div class="pp-unit-fill" style="width:${pctU}%"></div></div>
      </div>`;
      if (hasChildren) u.children.forEach(c => html += renderBookUnit(c, level + 1));
      return html;
    }
    const units = [...p.units].sort((a, b) => (a.startPage || 0) - (b.startPage || 0));
    const unitsHtml = units.map(u => renderBookUnit(u, 0)).join('');
    return `<div>${unitsHtml}</div>
      <div class="pp-ranges" style="margin-top:6px">
        ${rangeChipsBlock('✅ 已完成页码区间', done, 'ok')}
        ${rangeChipsBlock('⬜ 未完成页码区间', undone, 'no')}
      </div>`;
  }

  return `<div class="pp-ranges">
    ${rangeChipsBlock('✅ 已完成', done, 'ok')}
    ${rangeChipsBlock('⬜ 未完成', undone, 'no')}
  </div>`;
}
export function rangeChipsBlock(title, ranges, cls) {
  const chips = ranges.length
    ? ranges.map(r => `<span class="pp-chip ${cls}">${rangeText(r.start, r.end)}</span>`).join('')
    : '<span class="muted" style="font-size:12.5px">无</span>';
  return `<div class="pp-range-block">
    <div class="pp-range-t">${title} <span class="muted" style="font-weight:400">（共 ${countRanges(ranges)} 页）</span></div>
    <div class="pp-chips">${chips}</div></div>`;
}

/* ============ 新建 ============ */
export function addPaperSecRow(listEl, name, weight, id) {
  const row = document.createElement('div');
  row.className = 'ps-row';
  if (id) row.dataset.sid = id;
  row.innerHTML = `
    <input type="text" class="ps-name" maxlength="12" placeholder="板块名，如 选择/阅读A" value="${esc(name || '')}">
    <input type="number" class="ps-w" min="0" max="100" placeholder="权重" value="${weight === undefined || weight === '' ? '' : weight}">
    <span class="ps-pct">%</span>
    <button type="button" class="ps-del" title="删除">×</button>`;
  row.querySelector('.ps-del').addEventListener('click', () => { row.remove(); refreshPaperSecSum(listEl); });
  row.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => refreshPaperSecSum(listEl)));
  listEl.appendChild(row);
  refreshPaperSecSum(listEl);
}
export function readPaperSecRows(listEl) {
  const secs = [];
  listEl.querySelectorAll('.ps-row').forEach(row => {
    const name = row.querySelector('.ps-name').value.trim();
    const w = parseFloat(row.querySelector('.ps-w').value);
    if (!name) return;
    secs.push({ id: row.dataset.sid || genId(), name, weight: isNaN(w) ? 0 : w });
  });
  return secs;
}
export function refreshPaperSecSum(listEl) {
  const sumEl = listEl.parentElement.querySelector('.ps-sum');
  if (!sumEl) return;
  const named = [...listEl.querySelectorAll('.ps-name')].filter(el => el.value.trim()).length;
  if (!named) { sumEl.textContent = '不划分板块时，按「整套 / 部分题数」记录'; sumEl.classList.remove('bad'); return; }
  const sum = [...listEl.querySelectorAll('.ps-w')].reduce((s, el) => s + (parseFloat(el.value) || 0), 0);
  sumEl.textContent = `权重合计 ${sum}%${Math.abs(sum - 100) < 0.001 ? '' : '（建议 100%，系统会自动按比例归一化）'}`;
  sumEl.classList.toggle('bad', Math.abs(sum - 100) >= 0.001);
}

export const PAPER_TEMPLATES = {
  math1: ['考研数学一', [['选择题',50],['填空题',30],['解答题·高数',44],['解答题·线代',11],['解答题·概率',15]]],
  math2: ['考研数学二', [['选择题',50],['填空题',30],['解答题·高数',55],['解答题·线代',15]]],
  eng1: ['考研英语一', [['阅读1',10],['阅读2',10],['阅读3',10],['阅读4',10],['完型',10],['新题型',10],['翻译',10],['大作文',20],['小作文',10]]],
  eng2: ['考研英语二', [['阅读1',10],['阅读2',10],['阅读3',10],['阅读4',10],['完型',10],['新题型',10],['翻译',15],['小作文',10],['大作文',15]]],
  ustc843: ['中科大843·信号与系统', [['信号与系统',120],['数字信号处理',30]]],
  cs408: ['408计算机学科专业基础', [['数据结构·选择',22],['组成原理·选择',22],['操作系统·选择',20],['计算机网络·选择',16],['综合应用题',70]]],
  guanzhong: ['管理类综合能力', [['数学·问题求解',45],['数学·条件充分性判断',30],['逻辑',60],['写作·论证有效性分析',30],['写作·论说文',35]]],
  chem315: ['315化学（农）', [['单项选择题',60],['填空题',35],['计算分析与合成题',55]]],
  plant414: ['414植物生理学与生物化学', [['单项选择题',30],['简答题',48],['实验题',20],['分析论述题',52]]],
  politics: ['考研政治', [['单选题',16],['多选题',34],['分析题',50]]],
  // 新高考Ⅰ卷（语数英，满分150）
  xgk_chinese: ['新高考Ⅰ卷·语文', [['现代文阅读Ⅰ',12.7],['现代文阅读Ⅱ',10.7],['文言文阅读',13.3],['古代诗歌阅读',6],['名句名篇默写',4],['语言文字运用',13.3],['写作',40]]],
  xgk_math: ['新高考Ⅰ卷·数学', [['单项选择题',26.7],['多项选择题',12],['填空题',10],['解答题',51.3]]],
  xgk_english: ['新高考Ⅰ卷·英语', [['听力',20],['阅读理解',33.3],['语言运用',20],['写作',26.7]]],
  // 江苏自命题（政史地，满分100）
  js_politics: ['江苏卷·思想政治', [['单项选择题',45],['非选择题',55]]],
  js_history: ['江苏卷·历史', [['单项选择题',45],['非选择题',55]]],
  js_geography: ['江苏卷·地理', [['单项选择题',46],['非选择题',54]]]
};
export function applyPaperTemplate(listEl, tplKey) {
  const t = PAPER_TEMPLATES[tplKey];
  if (!t) return;
  listEl.innerHTML = '';
  t[1].forEach(([n, w]) => addPaperSecRow(listEl, n, w));
  refreshPaperSecSum(listEl);
}
(function initPaperTplSelects() {
  ['fPaperTpl', 'sPaperTpl'].forEach((selId, i) => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    refreshPaperTplSelect(sel);
    sel.addEventListener('change', () => {
      const listId = i === 0 ? 'fPaperSecList' : 'sPaperSecList';
      applyPaperTpl(sel.value, document.getElementById(listId));
      sel.value = '';
    });
  });
})();

export function formIsPageScope() {
  const type = (document.querySelector('input[name="ptype"]:checked') || {}).value;
  const unit = (document.querySelector('input[name="punit"]:checked') || {}).value || 'page';
  const mm = (document.querySelector('input[name="pmistakemode"]:checked') || {}).value || 'free';
  return (type === 'exercise' && unit === 'page') || (type === 'mistake' && mm === 'page') || type === 'recite';
}
export function syncFormUnit() {
  const type = (document.querySelector('input[name="ptype"]:checked') || {}).value || 'exercise';
  const unit = (document.querySelector('input[name="punit"]:checked') || {}).value || 'page';
  const mistakeMode = (document.querySelector('input[name="pmistakemode"]:checked') || {}).value || 'free';
  const isExercise = type === 'exercise';
  const isMistake = type === 'mistake';
  const isSet = isExercise && unit === 'set';
  const isMistakePage = isMistake && mistakeMode === 'page';
  const isMistakeSet = isMistake && mistakeMode === 'set';
  const isAnySet = isSet || isMistakeSet;
  $('#unitRow').hidden = !isExercise;
  $('#paperCfg').hidden = !isAnySet;
  const fPaperSecEditor = $('#fPaperSecEditor');
  if (fPaperSecEditor) fPaperSecEditor.hidden = !isSet;
  $('#fMistakeModeRow').hidden = !isMistake;
  // 关联刷题本：仅错题本page/set模式显示
  const showLinkRef = isMistake && (isMistakePage || isMistakeSet);
  $('#fLinkRefRow').hidden = !showLinkRef;
  if (showLinkRef) {
    const sel = $('#fLinkRef');
    sel.innerHTML = '<option value="">不关联</option>';
    Object.values(store.projects).forEach(other => {
      if (other.type !== 'exercise') return;
      const modeMatch = (isMistakePage && other.unit === 'page') || (isMistakeSet && other.unit === 'set');
      if (!modeMatch) return;
      const opt = document.createElement('option');
      opt.value = other.id;
      opt.textContent = other.name + '（' + (other.unit === 'set' ? '套卷' : '习题册') + '）';
      sel.appendChild(opt);
    });
  }
  // 单元模式：刷题按页码 + 背书 + 错题本习题册模式
  const showUnitMode = (isExercise && unit === 'page') || type === 'recite' || isMistakePage;
  $('#fUnitRow').hidden = !showUnitMode;
  if (!showUnitMode) { $('#fUnitMode').checked = false; $('#fUnitEditor').hidden = true; }
  // 推荐提示文案
  const recEl = $('#fUnitRecommend');
  if (recEl) {
    if (type === 'recite') recEl.innerHTML = '💡 系统推荐开启：背书内容通常按章节划分，单元模式可以按章节追踪掌握进度，复习更有针对性。';
    else if (isMistakePage) recEl.innerHTML = '💡 系统推荐开启：错题按习题册章节归类，薄弱点看板可按单元看错题数量，针对性消灭薄弱章节。';
    else recEl.innerHTML = '💡 系统推荐开启：习题册通常分章节/单元，单元模式可以清晰看到每个章节的完成进度，方便查漏补缺。';
  }
  const isPageExercise = isExercise && unit === 'page';
  $('#fStartPageWrap').hidden = true;
  // 页码范围：刷题习题册 + 背书 + 错题本习题册模式；套卷模式不显示
  const usePageRange = (type !== 'mistake' && !isSet) || isMistakePage;
  // 总套数：只在刷题套卷模式显示；错题本套卷模式不需要（进度按条目数）
  $('#fTotalRow').hidden = !isSet;
  const showScope = isPageExercise || isMistakePage || type === 'recite';
  $('#fScopeWrap').style.display = showScope ? '' : 'none';
  if (!showScope) { $('#fScopeMode').checked = false; $('#fScopeEditor').hidden = true; }
  const _fU = $('#fUnitMode').checked, _fS = $('#fScopeMode').checked;
  // 单元模式与跳着做互斥：开启一个时禁用另一个，避免用户困惑
  $('#fScopeMode').disabled = _fU;
  $('#fUnitMode').disabled = _fS;
  const _fMutexHint = $('#fScopeMutexHint');
  if (_fMutexHint) _fMutexHint.style.display = (_fU && showScope) ? '' : 'none';
  const _fUSM = (document.querySelector('input[name="fUnitScopeMode"]:checked') || {}).value || 'book';
  const _showFBook = usePageRange && !_fS && (!_fU || _fUSM === 'book');
  $('#fBookRangeRow').style.display = _showFBook ? '' : 'none';
  $('#fBookRangeHint').style.display = _showFBook ? '' : 'none';
  $('#fReviewModeRow').hidden = !(isMistake || type === 'recite');
  // 复习模式说明文案按类型区分（错题 / 背书）
  const fRmLab = document.getElementById('fReviewModeHint');
  if (fRmLab) {
    fRmLab.innerHTML = type === 'recite'
      ? '<b>均匀分布</b>：自动把复习错峰到每天，避免某天突然要背一堆，适合批量录入、或一次背诵跨很多页。<br><b>经典间隔</b>：严格按记忆曲线间隔提醒，适合量少、能跟上节奏的情况。'
      : '<b>均匀分布</b>：自动把复习错峰到每天，避免某天突然爆量，适合经常批量录入错题。<br><b>经典间隔</b>：严格按间隔天数提醒，适合量少、能跟上节奏的情况。';
  }
  $('#fTotalLabel').textContent = '总套数';
  $('#fTotal').placeholder = '例：20（共多少套卷）';
  $('#fStartPageLabel').textContent = isAnySet ? '已完成套数（可选）' : '开始页码（可选）';
  $('#fUnitHint').textContent = isSet
    ? '套卷可整套记录，也可只记录某个板块完成的百分比，进度按你设置的板块权重计算。填「开始日期」可立刻估算速度。'
    : isMistakeSet
      ? '错题按套卷号归类，学习记录按套卷分组查看。填「开始日期」可立刻估算速度。'
      : isExercise
        ? '填上「开始日期 + 开始页码」可以立刻估算速度；不填的话，打卡几次后也能自动估算。'
        : isMistakePage
          ? '错题按页码归类到习题册，开启单元模式后薄弱点看板可按单元看错题分布。再攒 3 个学习日就开始按你的节奏估算，满 7 个学习日（约 2 周）后预测最准。'
          : (isMistake
            ? '错题按「已攻克 / 已收录」统计进度：每记录一道错题算 1 条收录，复习到攻克后算攻克。可在「出处」里自由填写它来自哪套卷、哪本书哪页（选填）。再攒 3 个学习日就开始按你的节奏估算，满 7 个学习日（约 2 周）后预测最准。'
            : '背书按页码范围统计进度：一条内容跨多页算多页，同一页建多条只算一页。再攒 3 个学习日就开始按你的节奏估算，满 7 个学习日（约 2 周）后预测最准。');
  const labelMode = (document.querySelector('input[name="ppaperlabel"]:checked') || {}).value || 'index';
  $('#fPaperYear').hidden = !(isAnySet && labelMode === 'year');
}
export function openFormCreate() {
  // 关闭其他可能残留的弹窗
  ['settingsMask','genericConfirmMask','modeSwitchConfirmMask','randomReviewConfirmMask','mistakeGuideMask','reviewModeHelpMask','importConfirmMask','skipConfirmMask','confirmMasterMask','tplManagerMask'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  unlockBodyScroll();
  $('#formTitle').textContent = '新建任务';
  $('#fName').value = '';
  $('#fTotal').value = '';
  const d = new Date(); d.setDate(d.getDate() + 100);
  $('#fDeadline').value = fmtDate(d);
  $('#fStartDate').value = '';
  $('#fStartPage').value = '';
  $('#fPaperYear').value = '';
  $('#fPaperSecList').innerHTML = '';
  refreshPaperSecSum($('#fPaperSecList'));
  // 重置单元模式
  $('#fUnitMode').checked = false;
  $('#fUnitEditor').hidden = true;
  $('#fUnitEditList').innerHTML = '';
  const _fDefRadio = document.querySelector('input[name="fUnitScopeMode"][value="book"]');
  if (_fDefRadio) _fDefRadio.checked = true;
  refreshUnitTplSelect($('#fUnitTpl'));
  // 重置只做部分页（跳着做）
  $('#fScopeMode').checked = false;
  $('#fScopeEditor').hidden = true;
  $('#fScopeList').innerHTML = '';
  document.querySelector('input[name="ptype"][value="exercise"]').checked = true;
  document.querySelector('input[name="punit"][value="page"]').checked = true;
  document.querySelector('input[name="ppaperlabel"][value="index"]').checked = true;
  const fLinkRef = $('#fLinkRef');
  if (fLinkRef) fLinkRef.value = '';
  syncFormUnit();
  $('#formMask').hidden = false;
  modalTop($('#formMask'));
  setTimeout(() => $('#fName').focus(), 50);
}
export function closeForm() { const m=$('#formMask'); if(m.hidden) return; m.hidden=true; unlockBodyScroll(); document.querySelectorAll('input[name="ptype"]').forEach(r => { r.disabled = false; }); const fLinkRef = $('#fLinkRef'); if (fLinkRef) fLinkRef.disabled = false; }
document.querySelectorAll('input[name="ptype"]').forEach(r => r.addEventListener('change', syncFormUnit));
document.querySelectorAll('input[name="punit"]').forEach(r => r.addEventListener('change', syncFormUnit));
document.querySelectorAll('input[name="pmistakemode"]').forEach(r => r.addEventListener('change', syncFormUnit));
document.querySelectorAll('input[name="ppaperlabel"]').forEach(r => r.addEventListener('change', syncFormUnit));
$('#btnFPaperAddSec').addEventListener('click', () => addPaperSecRow($('#fPaperSecList'), '', ''));
// 新建表单单元模式
$('#fUnitMode').addEventListener('change', e => {
  const on = e.target.checked;
  $('#fUnitEditor').hidden = !on;
  $('#fScopeMode').disabled = on;
  const _h = $('#fScopeMutexHint');
  if (_h) _h.style.display = on ? '' : 'none';
  if (on) {
    if ($('#fScopeMode').checked) { $('#fScopeMode').checked = false; $('#fScopeEditor').hidden = true; }
    const usm = (document.querySelector('input[name="fUnitScopeMode"]:checked') || {}).value || 'book';
    if (usm !== 'book') { $('#fBookRangeRow').style.display = 'none'; $('#fBookRangeHint').style.display = 'none'; }
    else if (formIsPageScope()) { $('#fBookRangeRow').style.display = ''; $('#fBookRangeHint').style.display = ''; }
  } else if (!$('#fScopeMode').checked && formIsPageScope()) {
    $('#fBookRangeRow').style.display = ''; $('#fBookRangeHint').style.display = '';
  }
});
document.querySelectorAll('input[name="fUnitScopeMode"]').forEach(r => r.addEventListener('change', e => {
  if (!$('#fUnitMode').checked) return;
  if (e.target.value !== 'book') { $('#fBookRangeRow').style.display = 'none'; $('#fBookRangeHint').style.display = 'none'; }
  else if (formIsPageScope()) { $('#fBookRangeRow').style.display = ''; $('#fBookRangeHint').style.display = ''; }
}));
$('#fScopeMode').addEventListener('change', e => {
  const on = e.target.checked;
  $('#fScopeEditor').hidden = !on;
  $('#fUnitMode').disabled = on;
  if (on) {
    if ($('#fUnitMode').checked) { $('#fUnitMode').checked = false; $('#fUnitEditor').hidden = true; }
    $('#fBookRangeRow').style.display = 'none'; $('#fBookRangeHint').style.display = 'none';
    if (!$('#fScopeList').querySelectorAll('.scope-row').length) addScopeRow($('#fScopeList'), '', '');
  } else if (!$('#fUnitMode').checked && formIsPageScope()) {
    $('#fBookRangeRow').style.display = ''; $('#fBookRangeHint').style.display = '';
  }
});
$('#btnAddFScope').addEventListener('click', () => addScopeRow($('#fScopeList'), '', ''));
$('#fUnitTpl').addEventListener('change', e => {
  if (e.target.value) {
    const t = (store.unitTemplates || []).find(x => x.id === e.target.value);
    if (t) {
      renderUnitEditor(t.units, $('#fUnitEditList'));
      showToast('📋', '已加载模板', `「${t.name}」共 ${t.units.length} 个一级单元`, 2000);
    }
    e.target.value = '';
  }
});
$('#btnFAddUnitRow').addEventListener('click', () => addUnitRowToList($('#fUnitEditList'), '', '', ''));
/* ============ 设置 ============ */
export let editingProjectId = null;

export function openSettings() {
  const p = cur();
  if (!p) return;
  editingProjectId = p.id;
  // 暴力重置：关闭所有可能残留的遮罩层，恢复页面滚动
  ['genericConfirmMask','modeSwitchConfirmMask','randomReviewConfirmMask','mistakeGuideMask','reviewModeHelpMask','importConfirmMask','skipConfirmMask','confirmMasterMask'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
  // 暴力重置前可能叠开了多个弹窗，锁计数被多次 +1；这里把残留计数清零，避免只 unlock 一次造成 body 永久 fixed
  while (_bodyLockCount > 0) unlockBodyScroll();
  // 先强制显示设置窗口
  const sm = $('#settingsMask');
  sm.hidden = false;
  sm.style.display = '';
  modalTop(sm);
  $('#settingsDirtyBar').hidden = true;

  try {
  $('#sName').value = p.name;
  $('#sTotal').value = p.total || '';
  $('#sDeadline').value = p.deadline || '';
  $('#sStartDate').value = p.startDate || '';
  $('#sStartPage').value = p.startPage || 0;
  $('#sBookStart').value = p.bookStartPage || '';
  $('#sBookEnd').value = p.bookEndPage || '';

  const isExercise = p.type === 'exercise';
  const isRecite = !isExercise;
  const isMistake = p.type === 'mistake';
  const setMode = isSetMode(p);
  $('#intervalSectionTitle').hidden = !isRecite;
  $('#intervalSection').hidden = !isRecite;
  if (isRecite) $('#sIntervals').value = getIntervals(p).join(', ');

  // 复习模式（错题本 / 背书本都有复习模式；刷题本没有）
  const canReviewMode = isMistake || p.type === 'recite';
  $('#reviewModeSectionTitle').hidden = !canReviewMode;
  $('#reviewModeSection').hidden = !canReviewMode;
  // 整本书正文范围（错题本不需要）
  $('#sBookRangeRow').style.display = isMistake ? 'none' : '';
  $('#sBookRangeHint').style.display = isMistake ? 'none' : '';
  if (canReviewMode) {
    const mode = p.reviewMode || 'classic';
    const radio = document.querySelector('input[name="reviewMode"][value="' + mode + '"]');
    if (radio) radio.checked = true;
    const bs = $('#balancedSettings');
    if (bs) bs.hidden = mode !== 'balanced';
    updateIntervalHint(mode);
    // 容量设置
    const cm = $('#sCapacityMode');
    const cf = $('#sCapacityFixed');
    const cfw = $('#sCapacityFixedWrap');
    if (cm) cm.value = p.dailyCapacity != null ? 'fixed' : 'auto';
    if (cf) cf.value = p.dailyCapacity != null ? p.dailyCapacity : '';
    if (cfw) cfw.hidden = p.dailyCapacity == null;
  }

  // 错题本模式切换入口：仅自由出处模式显示
  const showModeSwitch = isMistake && isMistakeFreeMode(p);
  $('#mistakeModeSwitchTitle').hidden = !showModeSwitch;
  $('#mistakeModeSwitchSection').hidden = !showModeSwitch;

  // 错题本关联刷题本：仅 page/set 模式显示
  const showRef = isMistake && (isMistakePageMode(p) || isMistakeSetMode(p));
  $('#refProjectTitle').hidden = !showRef;
  $('#refProjectSection').hidden = !showRef;
  if (showRef) {
    const sel = $('#sRefProject');
    sel.innerHTML = '<option value="">不关联</option>';
    Object.values(store.projects).forEach(other => {
      if (other.type !== 'exercise' || other.id === p.id) return;
      const modeMatch = (isMistakePageMode(p) && other.unit === 'page') || (isMistakeSetMode(p) && other.unit === 'set');
      if (!modeMatch) return;
      const opt = document.createElement('option');
      opt.value = other.id;
      opt.textContent = other.name + '（' + (other.unit === 'set' ? '套卷' : '习题册') + '）';
      if (p.refProjectId === other.id) opt.selected = true;
      sel.appendChild(opt);
    });
    // 已关联信息
    const infoEl = $('#refProjectInfo');
    if (p.refProjectId && store.projects[p.refProjectId]) {
      infoEl.hidden = false;
      $('#refProjectInfoText').textContent = '✅ 已关联「' + store.projects[p.refProjectId].name + '」，单元结构已对齐';
    } else {
      infoEl.hidden = true;
    }
  }

  // 创建关联错题本按钮：仅刷题本显示
  const createLinkedBtn = $('#btnCreateLinkedMistake');
  if (createLinkedBtn) {
    createLinkedBtn.hidden = !isExercise;
    if (isExercise) {
      const linkedCount = Object.values(store.projects).filter(o => o.type === 'mistake' && o.refProjectId === p.id).length;
      if (linkedCount > 0) {
        createLinkedBtn.textContent = `📝 已被 ${linkedCount} 个错题本关联 · 再创建一个`;
      } else {
        createLinkedBtn.textContent = '📝 创建关联错题本';
      }
    }
  }

  // 分散阈值（背书+错题）
  $('#spreadSectionTitle').hidden = !isRecite;
  $('#spreadSection').hidden = !isRecite;
  if (isRecite) {
    $('#sSpreadThreshold').value = p.spreadThreshold || defaultComfortCap(p);
    $('#sSpreadThreshold').placeholder = '如 ' + defaultComfortCap(p);
    renderComfortAdvice(p);
  }

  // 套卷：总套数；练习册/背书：用起始/结束页；错题本习题册/自由出处总量动态，不显示总套数；错题本套卷显示总套数
  const usePageRange = !setMode && (p.type !== 'mistake' || isMistakePageMode(p));
  const showTotalRow = setMode || isMistakeSetMode(p);
  $('#sTotalLabel').textContent = '总套数';
  $('#sTotalRow').hidden = !showTotalRow;
  if (showTotalRow) $('#sTotal').value = p.total || '';
  const _sUnit = !!p.unitMode, _sScope = !!p.scopeMode;
  // 单元模式与跳着做互斥：开启一个时禁用另一个
  $('#sScopeMode').disabled = _sUnit;
  $('#sUnitMode').disabled = _sScope;
  const _sUSM = p.unitScopeMode || (p.unitScopeOnly === false ? 'book' : 'all'); // 老用户默认 all（原有行为）
  const _showBookRange = usePageRange && !_sScope && (!_sUnit || _sUSM === 'book');
  $('#sBookRangeRow').style.display = _showBookRange ? '' : 'none';
  $('#sBookRangeHint').style.display = _showBookRange ? '' : 'none';
  $('#sStartPageLabel').textContent = setMode ? '已完成套数（可选）' : '开始页码（可选）';
  $('#sStartPageWrap').hidden = !(isExercise && !setMode);

  $('#sUnitMode').checked = !!p.unitMode;
  const _sUSMradio = document.querySelector('input[name="sUnitScopeMode"][value="' + _sUSM + '"]');
  if (_sUSMradio) _sUSMradio.checked = true;
  refreshUnitTplSelect($('#sUnitTpl'));
  renderUnitEditor(p.units || []);
  $('#unitEditor').hidden = !p.unitMode;
  // 单元模式：刷题习题册 + 背书 + 错题本习题册模式
  $('#unitSectionWrap').hidden = setMode || (p.type === 'mistake' && !isMistakePageMode(p));
  // 只做部分页（跳着做）回填
  $('#sScopeWrap').style.display = isPageScopeCapable(p) ? '' : 'none';
  $('#sScopeMode').checked = _sScope;
  const _sMutexHint = $('#sScopeMutexHint');
  if (_sMutexHint) _sMutexHint.style.display = (_sUnit && isPageScopeCapable(p)) ? '' : 'none';
  $('#sScopeEditor').hidden = !_sScope;
  renderScopeEditor(p.targetRanges || [], $('#sScopeList'));

  const isMistakeSet = p.type === 'mistake' && isMistakeSetMode(p);
  $('#paperSectionWrap').hidden = !setMode && !isMistakeSet;
  $('#paperSecEditor').hidden = !setMode;
  if (setMode || isMistakeSet) {
    if (setMode) {
      refreshPaperTplSelect($('#sPaperTpl'));
      const secList = $('#sPaperSecList');
      secList.innerHTML = '';
      (p.paperSections || []).forEach(s => addPaperSecRow(secList, s.name, s.weight, s.id));
      refreshPaperSecSum(secList);
    }
    const lm = p.paperLabelMode || 'index';
    const radio = document.querySelector('input[name="spaperlabel"][value="' + lm + '"]');
    if (radio) radio.checked = true;
    $('#sPaperYear').value = p.paperYearStart || '';
    syncSPaperLabel();
  }

  // 记录初始状态，用于未保存检测
  settingsInitialSnapshot = captureSettingsSnapshot();
  $('#settingsDirtyBar').hidden = true;

  // 实时压力评估
  setTimeout(() => {
    updatePressurePanel();
    updateSpreadPressureHint();
  }, 50);
  } catch (e) {
    console.error('openSettings error:', e);
    showToast('⚠️', '设置加载有异常', e.message + '（窗口仍可使用）', 4000);
  }
}
// 捕获设置表单当前状态（用于未保存检测），带安全保护
export function captureSettingsSnapshot() {
  try {
    const p = store.projects[editingProjectId];
    if (!p) return null;
    const unitRows = [...document.querySelectorAll('#unitEditList .unit-edit-row')].map(r => {
      const nameEl = r.querySelector('[data-role="uname"]');
      const startEl = r.querySelector('[data-role="ustart"]');
      const endEl = r.querySelector('[data-role="uend"]');
      return {
        name: nameEl ? nameEl.value : '',
        start: startEl ? startEl.value : '',
        end: endEl ? endEl.value : ''
      };
    });
    return {
      name: $('#sName') ? $('#sName').value : '',
      total: $('#sTotal') ? $('#sTotal').value : '',
      bookStart: $('#sBookStart') ? $('#sBookStart').value : '',
      bookEnd: $('#sBookEnd') ? $('#sBookEnd').value : '',
      deadline: $('#sDeadline') ? $('#sDeadline').value : '',
      startDate: $('#sStartDate') ? $('#sStartDate').value : '',
      startPage: $('#sStartPage') ? $('#sStartPage').value : '',
      intervals: $('#sIntervals') ? $('#sIntervals').value : '',
      unitMode: $('#sUnitMode') ? $('#sUnitMode').checked : false,
      unitScopeMode: (document.querySelector('input[name="sUnitScopeMode"]:checked') || {}).value || 'all',
      units: unitRows,
      reviewMode: (document.querySelector('input[name="reviewMode"]:checked') || {}).value || '',
      capacityMode: $('#sCapacityMode') ? $('#sCapacityMode').value : '',
      capacityFixed: $('#sCapacityFixed') ? $('#sCapacityFixed').value : '',
      spreadThreshold: $('#sSpreadThreshold') ? $('#sSpreadThreshold').value : ''
    };
  } catch (e) {
    return null;
  }
}
export let settingsInitialSnapshot = null;
export function isSettingsDirty() {
  if (!settingsInitialSnapshot) return false;
  const cur = captureSettingsSnapshot();
  return JSON.stringify(cur) !== JSON.stringify(settingsInitialSnapshot);
}
export function markSettingsDirty() {
  if (settingsInitialSnapshot && isSettingsDirty()) {
    $('#settingsDirtyBar').hidden = false;
  }
}
export function syncSPaperLabel() {
  const lm = (document.querySelector('input[name="spaperlabel"]:checked') || {}).value || 'index';
  $('#sPaperYear').hidden = lm !== 'year';
}
document.querySelectorAll('input[name="spaperlabel"]').forEach(r => r.addEventListener('change', syncSPaperLabel));
$('#btnSPaperAddSec').addEventListener('click', () => addPaperSecRow($('#sPaperSecList'), '', ''));
export function closeSettings() {
  if (isSettingsDirty()) {
    showGenericConfirm(
      '有未保存的修改',
      '设置还没保存。<br><br><b>「不保存离开」</b>：关闭设置，修改全部丢弃<br><b>「取消」</b>：返回设置页面继续编辑',
      '不保存离开',
      () => { doCloseSettings(); },
      () => { showToast('✏️', '继续编辑中', '设置窗口仍开着，改完记得点底部「保存」按钮。', 2500); }
    );
    return;
  }
  doCloseSettings();
}
export function doCloseSettings() {
  const mask = $('#settingsMask');
  if (mask.hidden) return;
  mask.hidden = true;
  unlockBodyScroll();
  settingsInitialSnapshot = null;
}

export function renderUnitEditor(units, targetList) {
  const wrap = targetList || $('#unitEditList');
  wrap.innerHTML = '';
  // 递归展开嵌套结构为扁平列表（带 level）
  const flat = [];
  function flatten(arr, level) {
    (arr || []).forEach(u => {
      flat.push({ ...u, level });
      if (u.children && u.children.length) flatten(u.children, level + 1);
    });
  }
  flatten(units, 0);
  flat.forEach(u => addUnitRowToList(wrap, u.name || '', u.startPage ?? '', u.endPage ?? '', u.level || 0));
}

export function addUnitRow(name, startPage, endPage) {
  addUnitRowToList($('#unitEditList'), name, startPage, endPage, 0);
}
export function addUnitRowToList(listEl, name, startPage, endPage, level) {
  level = level || 0;
  const row = document.createElement('div');
  row.className = 'unit-edit-row';
  row.dataset.level = level;
  const indent = level * 24;
  const maxLevel = 2; // 最多3级（0,1,2）
  row.innerHTML = `
    <div class="unit-edit-main" style="padding-left:${indent}px">
      ${level > 0 ? '<span class="unit-tree-line">└</span>' : ''}
      <input type="text" class="unit-name-input" placeholder="单元名称，如：第一章 马克思主义哲学" value="${esc(name)}" data-role="uname">
      <div class="unit-page-group">
        <input type="text" class="unit-page-input" placeholder="起" value="${startPage === '' ? '' : esc(startPage)}" data-role="ustart" inputmode="numeric" title="起始页">
        <span class="unit-page-sep">~</span>
        <input type="text" class="unit-page-input" placeholder="止" value="${endPage === '' ? '' : esc(endPage)}" data-role="uend" inputmode="numeric" title="结束页">
      </div>
      <div class="unit-actions">
        ${level < maxLevel ? '<button type="button" class="unit-action-btn" data-action="add-child" title="在此单元下添加子单元">＋</button>' : ''}
        ${level > 0 ? '<button type="button" class="unit-action-btn" data-action="indent-left" title="提升一级">⇤</button>' : ''}
        ${level < maxLevel ? '<button type="button" class="unit-action-btn" data-action="indent-right" title="降级为上一个单元的子单元">⇥</button>' : ''}
        <button type="button" class="unit-action-btn unit-del-btn" data-action="delete" title="删除此单元（含子单元）">🗑</button>
      </div>
    </div>
  `;
  listEl.appendChild(row);
  // 实时校验：结束页不能小于起始页
  const startInput = row.querySelector('[data-role="ustart"]');
  const endInput = row.querySelector('[data-role="uend"]');
  const validatePage = () => {
    const sp = Number(startInput.value), ep = Number(endInput.value);
    if (startInput.value && endInput.value && !isNaN(sp) && !isNaN(ep) && ep < sp) {
      endInput.style.borderColor = '#b02e24';
      endInput.style.background = 'rgba(201,48,56,0.06)';
      endInput.title = '结束页不能小于起始页，保存时将自动修正';
    } else {
      endInput.style.borderColor = '';
      endInput.style.background = '';
      endInput.title = '结束页';
    }
  };
  startInput.addEventListener('input', validatePage);
  endInput.addEventListener('input', validatePage);
  validatePage();
  return row;
}

/* ============ 轻量"只做部分页（跳着做）"区间编辑器（无名称/层级，复用单元行样式） ============ */
export function addScopeRow(listEl, start, end) {
  const row = document.createElement('div');
  row.className = 'unit-edit-row scope-row';
  row.innerHTML = `
    <div class="unit-edit-main" style="padding-left:0">
      <div class="unit-page-group">
        <input type="text" class="unit-page-input" placeholder="起" value="${start === '' ? '' : esc(start)}" data-role="sstart" inputmode="numeric" title="起始页">
        <span class="unit-page-sep">~</span>
        <input type="text" class="unit-page-input" placeholder="止" value="${end === '' ? '' : esc(end)}" data-role="send" inputmode="numeric" title="结束页（不填=单页）">
      </div>
      <div class="unit-actions">
        <button type="button" class="unit-action-btn unit-del-btn" data-scope-del title="删除此区间">🗑</button>
      </div>
    </div>`;
  listEl.appendChild(row);
  const si = row.querySelector('[data-role="sstart"]'), ei = row.querySelector('[data-role="send"]');
  const v = () => {
    const sp = Number(si.value), ep = Number(ei.value);
    if (si.value && ei.value && !isNaN(sp) && !isNaN(ep) && ep < sp) {
      ei.style.borderColor = '#b02e24'; ei.style.background = 'rgba(201,48,56,0.06)'; ei.title = '结束页不能小于起始页';
    } else { ei.style.borderColor = ''; ei.style.background = ''; ei.title = '结束页（不填=单页）'; }
    updateScopeCount(listEl);
  };
  si.addEventListener('input', v); ei.addEventListener('input', v); v();
  return row;
}
export function readScopeRows(listEl) {
  const out = [];
  listEl.querySelectorAll('.scope-row').forEach(row => {
    const s = row.querySelector('[data-role="sstart"]').value;
    const e = row.querySelector('[data-role="send"]').value;
    if (s === '' && e === '') return;
    const sn = Number(s);
    if (s === '' || isNaN(sn) || sn < 1) return;
    let end;
    if (e === '') end = sn;
    else { const en = Number(e); if (isNaN(en) || en < sn) return; end = en; }
    out.push({ start: sn, end });
  });
  return mergeRanges(out);
}
export function renderScopeEditor(ranges, listEl) {
  listEl.innerHTML = '';
  if (!ranges || !ranges.length) addScopeRow(listEl, '', '');
  else ranges.forEach(r => addScopeRow(listEl, r.start, r.end));
  if (!listEl.dataset.bound) {
    listEl.dataset.bound = '1';
    listEl.addEventListener('click', ev => {
      const b = ev.target.closest('[data-scope-del]');
      if (!b) return;
      b.closest('.scope-row').remove();
      if (!listEl.querySelectorAll('.scope-row').length) addScopeRow(listEl, '', '');
      updateScopeCount(listEl);
    });
  }
  updateScopeCount(listEl);
}
export function updateScopeCount(listEl) {
  const n = countRanges(readScopeRows(listEl));
  const box = listEl.parentElement;
  const t = box ? box.querySelector('.scope-count-num') : null;
  if (t) t.textContent = n;
}

/* ============ 单元/套卷模板系统 ============ */
export function refreshUnitTplSelect(selectEl) {
  if (!selectEl) return;
  const cur = selectEl.value;
  selectEl.innerHTML = '<option value="">从模板加载（可选）</option>';
  (store.unitTemplates || []).forEach(t => {
    const op = document.createElement('option');
    op.value = t.id; op.textContent = t.name + `（${t.units.length}个单元）`;
    selectEl.appendChild(op);
  });
  selectEl.value = cur;
}
export function refreshPaperTplSelect(selectEl) {
  if (!selectEl) return;
  const cur = selectEl.value;
  selectEl.innerHTML = '<option value="">套用试卷模板（可选，一键填充）</option>';
  // 预设模板
  Object.keys(PAPER_TEMPLATES).forEach(k => {
    const op = document.createElement('option');
    op.value = 'preset:' + k; op.textContent = '📌 ' + PAPER_TEMPLATES[k][0];
    selectEl.appendChild(op);
  });
  // 自定义模板
  (store.paperTemplates || []).forEach(t => {
    const op = document.createElement('option');
    op.value = 'custom:' + t.id; op.textContent = '💾 ' + t.name + `（${t.sections.length}个板块）`;
    selectEl.appendChild(op);
  });
  selectEl.value = cur;
}
export function applyUnitTpl(tplId, listEl) {
  const t = (store.unitTemplates || []).find(x => x.id === tplId);
  if (!t) return;
  renderUnitEditor(t.units, listEl || $('#unitEditList'));
  showToast('📋', '已加载模板', `「${t.name}」共 ${t.units.length} 个单元`, 2000);
}
export function applyPaperTpl(val, listEl) {
  if (val.startsWith('preset:')) {
    applyPaperTemplate(listEl, val.slice(7));
  } else if (val.startsWith('custom:')) {
    const t = (store.paperTemplates || []).find(x => x.id === val.slice(7));
    if (t) {
      listEl.innerHTML = '';
      t.sections.forEach(s => addPaperSecRow(listEl, s.name, s.weight, s.id));
      showToast('📋', '已加载模板', `「${t.name}」共 ${t.sections.length} 个板块`, 2000);
    }
  }
}
export function saveUnitTplFromEditor(defaultName) {
  const units = readUnitRows();
  if (!units.length) { showToast('⚠️', '无法保存', '请先添加至少一个单元', 2000); return; }
  const name = prompt('模板名称：', defaultName || '');
  if (!name || !name.trim()) return;
  const existing = (store.unitTemplates || []).find(t => t.name === name.trim());
  if (existing) {
    existing.units = JSON.parse(JSON.stringify(units));
    existing.updatedAt = Date.now();
  } else {
    if (!Array.isArray(store.unitTemplates)) store.unitTemplates = [];
    store.unitTemplates.push({ id: genId(), name: name.trim(), units: JSON.parse(JSON.stringify(units)), createdAt: Date.now(), updatedAt: Date.now() });
  }
  saveStore();
  refreshUnitTplSelect($('#sUnitTpl'));
  refreshUnitTplSelect($('#fUnitTpl'));
  showToast('💾', '模板已保存', `「${name.trim()}」共 ${units.length} 个单元`, 2000);
}
export function savePaperTplFromEditor(defaultName) {
  const sections = readPaperSecRows($('#sPaperSecList'));
  if (!sections.length) { showToast('⚠️', '无法保存', '请先添加至少一个板块', 2000); return; }
  const name = prompt('模板名称：', defaultName || '');
  if (!name || !name.trim()) return;
  const existing = (store.paperTemplates || []).find(t => t.name === name.trim());
  if (existing) {
    existing.sections = JSON.parse(JSON.stringify(sections));
    existing.updatedAt = Date.now();
  } else {
    if (!Array.isArray(store.paperTemplates)) store.paperTemplates = [];
    store.paperTemplates.push({ id: genId(), name: name.trim(), sections: JSON.parse(JSON.stringify(sections)), createdAt: Date.now(), updatedAt: Date.now() });
  }
  saveStore();
  refreshPaperTplSelect($('#sPaperTpl'));
  refreshPaperTplSelect($('#fPaperTpl'));
  showToast('💾', '模板已保存', `「${name.trim()}」共 ${sections.length} 个板块`, 2000);
}
export function readUnitRows() {
  return readUnitRowsFromList($('#unitEditList'));
}
export function readUnitRowsFromList(listEl) {
  // 读取扁平列表（带 level），构建嵌套结构
  const flat = [];
  let fixedCount = 0;
  listEl.querySelectorAll('.unit-edit-row').forEach(r => {
    const name = (r.querySelector('[data-role="uname"]') || {}).value || '';
    const start = (r.querySelector('[data-role="ustart"]') || {}).value;
    const end = (r.querySelector('[data-role="uend"]') || {}).value;
    const level = parseInt(r.dataset.level || '0', 10);
    if (name.trim()) {
      const parsePage = v => {
        if (v === '' || v == null) return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
      };
      let sp = parsePage(start), ep = parsePage(end);
      // 校验：结束页不能小于起始页，自动修正
      if (sp != null && ep != null && ep < sp) { ep = sp; fixedCount++; }
      flat.push({ name: name.trim(), startPage: sp, endPage: ep, level, children: [] });
    }
  });
  if (fixedCount > 0) {
    showToast('⚠️', '页码已自动修正', `${fixedCount}个单元的结束页小于起始页，已自动调整为与起始页相同`, 3000);
  }
  // 单元页码重叠检测：同父级（level 相同）的相邻单元间页码范围重叠时警告
  const overlaps = [];
  for (let i = 0; i < flat.length - 1; i++) {
    const a = flat[i], b = flat[i + 1];
    if (a.level !== b.level) continue;
    if (a.startPage == null || a.endPage == null || b.startPage == null || b.endPage == null) continue;
    if (b.startPage <= a.endPage && a.startPage <= b.endPage) {
      overlaps.push(`${a.name}(~${a.endPage}页)与${b.name}(${b.startPage}~页)`);
    }
  }
  if (overlaps.length) {
    showToast('⚠️', '单元页码有重叠', overlaps.slice(0, 3).join('；'), 3000);
  }
  // 构建嵌套树
  const tree = [];
  const stack = []; // 栈中存 {level, node}
  flat.forEach(item => {
    const node = { name: item.name, startPage: item.startPage, endPage: item.endPage, children: [] };
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else tree.push(node);
    stack.push({ level: item.level, node });
  });
  return tree;
}
/* 模板管理弹窗 */
export let tplManagerType = 'unit';
export function openTplManager(type) {
  tplManagerType = type;
  $('#tplManagerTitle').textContent = type === 'unit' ? '单元模板管理' : '套卷模板管理';
  renderTplManagerList();
  $('#tplManagerMask').hidden = false;
  modalTop($('#tplManagerMask'));
}
export function renderTplManagerList() {
  const list = $('#tplManagerList');
  const templates = tplManagerType === 'unit' ? (store.unitTemplates || []) : (store.paperTemplates || []);
  if (!templates.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px 0">还没有保存的模板<br><span style="font-size:12px">在设置页编辑好单元/板块后，点「存为模板」即可保存</span></div>';
    return;
  }
  list.innerHTML = templates.map(t => {
    const count = tplManagerType === 'unit' ? t.units.length : t.sections.length;
    const typeLabel = tplManagerType === 'unit' ? '个单元' : '个板块';
    return `<div class="tpl-item" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13.5px">${esc(t.name)}</div>
        <div style="font-size:12px;color:var(--muted)">${count}${typeLabel}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="ghost-btn" style="padding:4px 10px;font-size:12px" onclick="editTpl('${t.id}')">编辑</button>
        <button class="ghost-btn" style="padding:4px 10px;font-size:12px" onclick="renameTpl('${t.id}')">重命名</button>
        <button class="ghost-btn" style="padding:4px 10px;font-size:12px;color:#b02e24" onclick="deleteTpl('${t.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
}
export function editTpl(id) {
  const templates = tplManagerType === 'unit' ? store.unitTemplates : store.paperTemplates;
  const t = templates.find(x => x.id === id);
  if (!t) return;
  // 判断当前在设置页还是新建表单
  const inSettings = !$('#settingsMask').hidden;
  const inForm = !$('#formMask').hidden;
  if (tplManagerType === 'unit') {
    if (inSettings) {
      renderUnitEditor(t.units);
      $('#unitEditor').hidden = false;
      $('#sUnitMode').checked = true;
    } else if (inForm) {
      renderUnitEditor(t.units, $('#fUnitEditList'));
      $('#fUnitEditor').hidden = false;
      $('#fUnitMode').checked = true;
    }
  } else {
    const listEl = inSettings ? $('#sPaperSecList') : (inForm ? $('#fPaperSecList') : null);
    if (listEl) {
      listEl.innerHTML = '';
      t.sections.forEach(s => addPaperSecRow(listEl, s.name, s.weight, s.id));
    }
  }
  $('#tplManagerMask').hidden = true;
  unlockBodyScroll();
  showToast('✏️', '已加载模板', `「${t.name}」已加载到编辑器，修改后点「存为模板」并输入相同名称即可更新`, 3000);
}
export function renameTpl(id) {
  const templates = tplManagerType === 'unit' ? store.unitTemplates : store.paperTemplates;
  const t = templates.find(x => x.id === id);
  if (!t) return;
  const name = prompt('新名称：', t.name);
  if (!name || !name.trim()) return;
  t.name = name.trim();
  t.updatedAt = Date.now();
  saveStore();
  renderTplManagerList();
  if (tplManagerType === 'unit') { refreshUnitTplSelect($('#sUnitTpl')); refreshUnitTplSelect($('#fUnitTpl')); }
  else { refreshPaperTplSelect($('#sPaperTpl')); refreshPaperTplSelect($('#fPaperTpl')); }
}
export function deleteTpl(id) {
  const templates = tplManagerType === 'unit' ? store.unitTemplates : store.paperTemplates;
  const idx = templates.findIndex(x => x.id === id);
  if (idx < 0) return;
  const t = templates[idx];
  if (!confirm(`确定删除模板「${t.name}」吗？此操作不可撤销。`)) return;
  templates.splice(idx, 1);
  saveStore();
  renderTplManagerList();
  if (tplManagerType === 'unit') { refreshUnitTplSelect($('#sUnitTpl')); refreshUnitTplSelect($('#fUnitTpl')); }
  else { refreshPaperTplSelect($('#sPaperTpl')); refreshPaperTplSelect($('#fPaperTpl')); }
}

/* ============ 薄弱点看板 ============ */
export let wbCurrentFilter = 'all';

export function openWeaknessBoard() {
  const p = cur();
  if (!p || p.type === 'exercise') return;
  renderWeaknessBoard(p);
  $('#weaknessMask').hidden = false;
  modalTop($('#weaknessMask'));
}
export function closeWeaknessBoard() { const m=$('#weaknessMask'); if(m.hidden) return; m.hidden=true; unlockBodyScroll(); }

export function renderWeaknessBoard(p) {
  const items = p.items || [];
  const weakThreshold = p.weakThreshold || 0.4;
  const isMistake = p.type === 'mistake';
  const today = todayStr();
  const word = isMistake ? '题' : '条';

  // 用词统一：错题用"攻克"，背书用"掌握"
  const masteredWord = isMistake ? '攻克' : '掌握';
  document.querySelectorAll('.wb-filter-btn').forEach(btn => {
    const f = btn.dataset.filter;
    if (f === 'mastered') btn.textContent = '已' + masteredWord;
    if (f === 'unmastered') btn.textContent = '未' + masteredWord;
  });
  $('#btnRandomReview').innerHTML = isMistake ? '🎲 随机抽5道重做' : '🎲 随机抽5道复习';
  const randomHint = document.querySelector('#btnRandomReview + .hint');
  if (randomHint) randomHint.textContent = isMistake
    ? '从已攻克中随机抽查，做错了会自动重新加入复习队列'
    : '从已掌握中随机抽查，做错了会自动重新加入复习队列';

  const isMastered = it => it.mastered || it.manualMastered;
  const scoreOf = it => isMastered(it) ? 1.0 : (getItemScore(it) ?? -1);
  const mastered = items.filter(isMastered).length;
  const due = getDueItems(p).length;
  const weak = items.filter(it => {
    if (isMastered(it)) return false;
    const s = getItemScore(it);
    return s !== null && s < weakThreshold;
  }).length;

  // 副标题：讲清这个看板是干什么的、怎么用
  $('#wbSubtitle').textContent = isMistake
    ? '错题复习作战中心：下方按「今天最该重做 → 已攻克」排序，先清逾期/到期和反复错的题；也可以点「未复习」快速筛查刚录入还没做过的题。错因分布按历史累计统计，即使后来做对也保留，帮你盯住自己的系统性弱点。'
    : '记忆复习看板：下方按「今天最该复习 → 已掌握」排序，先清逾期/到期和最生疏的内容；坚持按间隔复习，记忆才牢。';
  $('#wbTotalLab').textContent = isMistake ? '总题数' : '总条目';
  $('#wbListTitle').textContent = isMistake ? '📋 错题明细（越靠前越该先重做）' : '📋 内容明细（越靠前越该先复习）';
  // 统计卡片标签：错题用"攻克"，背书用"掌握"
  const masteredStatLab = document.querySelector('.wb-stat.s-mastered .lab');
  if (masteredStatLab) masteredStatLab.textContent = isMistake ? '已攻克' : '已掌握';

  $('#wbTotal').textContent = items.length;
  $('#wbMastered').textContent = mastered;
  $('#wbDue').textContent = due;
  $('#wbWeak').textContent = weak;

  // —— 掌握度分布堆叠条 ——
  const distDefs = [
    ['new', '未复习', 'var(--m-new)'],
    ['weak', '薄弱', 'var(--m-weak)'],
    ['fuzzy', '需巩固', 'var(--m-fuzzy)'],
    ['good', isMistake ? '基本攻克' : '基本掌握', 'var(--m-good)'],
    ['solid', isMistake ? '牢固攻克' : '牢固掌握', 'var(--m-solid)'],
    ['mastered', isMistake ? '已攻克' : '已掌握', 'var(--m-mastered)']
  ];
  const distCounts = {};
  items.forEach(it => { const k = getMasteryInfo(it).key; distCounts[k] = (distCounts[k] || 0) + 1; });
  const distSegs = distDefs.map(([k, label, color]) => {
    const n = distCounts[k] || 0;
    return n > 0 ? `<div class="wb-dist-seg" style="flex:${n};background:${color}" title="${label}: ${n}"></div>` : '';
  }).join('');
  $('#wbDist').innerHTML = distSegs || '<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:8px">暂无数据</div>';

  // 单条渲染（错题显示错因+出处，背书显示页码）
  const itemLi = ({ it, score }) => {
    const displayScore = (score == null) ? '未复习' : score.toFixed(2);
    const scoreCls = (score == null) ? 's-yellow' : (score < weakThreshold ? 's-red' : (score < 0.8 ? 's-yellow' : 's-green'));
    const mastery = getMasteryInfo(it, p);
    const overdue = it.nextReviewDate && !isMastered(it) && it.nextReviewDate < today
      ? `<span style="color:#96600c;font-weight:600">逾期${diffDays(it.nextReviewDate, today)}天</span>` : '';
    const loc = fmtItemLocator(p, it);
    const tagHtml = isMistake && (it.errTags || []).length
      ? `<span style="color:#8a6a12">${it.errTags.slice(0, 2).map(esc).join('/')}${it.errTags.length > 2 ? '…' : ''}</span><span>·</span>` : '';
    const locHtml = loc ? `<span>${esc(loc)}</span><span>·</span>` : '';
    // 提取逻辑：如果是未复习的条目，提供提前复习按钮
    const isUnreviewed = !isMastered(it) && (it.reviews || []).length <= 1 && (!it.nextReviewDate || it.nextReviewDate > today);
    const earlyBtn = isUnreviewed
      ? `<button class="early-review-btn" data-wb-early="${esc(it.id)}" title="加入今日复习" style="padding:4px 8px;font-size:11px;white-space:nowrap">⏩ 提前复习</button>`
      : '';
    return `<li class="wb-item ${mastery.cls}" data-id="${esc(it.id)}">
      <div class="wb-item-main">
        <div class="wb-item-content">${esc(it.content)}</div>
        <div class="wb-item-meta">
          ${tagHtml}${locHtml}
          <span>${fmtCN(it.learnedDate)}</span>
          <span>·</span>
          <span>${(it.reviews || []).length}次复习</span>
          ${overdue ? '<span>·</span>' + overdue : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex:0 0 auto;margin-left:8px">
        ${earlyBtn}
        <span class="wb-score ${scoreCls}">${displayScore}</span>
      </div>
    </li>`;
  };

  // 按当前过滤器筛选
  const filter = wbCurrentFilter || 'all';
  let filtered = items.map(it => ({ it, score: getItemScore(it) }));
  if (filter === 'weak') {
    filtered = filtered.filter(({ it, score }) => !isMastered(it) && score !== null && score < weakThreshold);
  } else if (filter === 'due') {
    filtered = filtered.filter(({ it }) => !isMastered(it) && it.nextReviewDate && it.nextReviewDate <= today);
  } else if (filter === 'unreviewed') {
    // 未复习：未攻克、reviews <= 1，且没有安排在今天或之前
    filtered = filtered.filter(({ it }) => {
      if (isMastered(it)) return false;
      if ((it.reviews || []).length > 1) return false;
      // 如果已经被提前复习（排到了今天或更早），就不算“未复习”了
      if (it.nextReviewDate && it.nextReviewDate <= today) return false;
      return true;
    });
  } else if (filter === 'unmastered') {
    filtered = filtered.filter(({ it }) => !isMastered(it));
  } else if (filter === 'mastered') {
    filtered = filtered.filter(({ it }) => isMastered(it));
  }

  // 排序：未掌握的按紧急度，已掌握的按最近复习时间倒序
  if (filter === 'mastered') {
    filtered.sort((a, b) => {
      const ra = (a.it.masteredDate || a.it.learnedDate || '');
      const rb = (b.it.masteredDate || b.it.learnedDate || '');
      return rb.localeCompare(ra);
    });
  } else if (filter === 'unreviewed') {
    // 未复习的条目没有紧急度可比，直接按录入时间倒序（最新录入的排前面）
    filtered.sort((a, b) => (b.it.learnedDate || '').localeCompare(a.it.learnedDate || ''));
  } else {
    filtered.sort((a, b) => {
      const aOver = a.it.nextReviewDate && !isMastered(a.it) && a.it.nextReviewDate < today ? 1 : 0;
      const bOver = b.it.nextReviewDate && !isMastered(b.it) && b.it.nextReviewDate < today ? 1 : 0;
      if (aOver !== bOver) return bOver - aOver;
      if (a.score !== b.score) return (a.score ?? 999) - (b.score ?? 999);
      return (a.it.nextReviewDate || '').localeCompare(b.it.nextReviewDate || '');
    });
  }

  // 已掌握过滤器下显示随机抽题按钮
  const masteredActions = $('#wbMasteredActions');
  if (masteredActions) {
    masteredActions.hidden = filter !== 'mastered' || !isMistake;
  }

  const list = $('#wbList');
  const useUnit = p.unitMode && (p.units || []).length && (p.type !== 'mistake' || isMistakePageMode(p));
  if (!filtered.length) {
    list.innerHTML = '<div class="wb-empty">没有符合条件的条目 🎉</div>';
  } else if (useUnit) {
    const units = [...p.units].sort((a, b) => (a.startPage || 0) - (b.startPage || 0));
    const pageOf = it => { const n = parseInt(getItemPageStart(it), 10); return isNaN(n) ? 0 : n; };
    // 递归判断条目是否属于某个单元（含子单元）
    function itemInUnit(it, u) {
      const ranges = getUnitPageRanges(u);
      const pg = pageOf(it);
      return ranges.some(([s, e]) => pg >= s && pg <= e);
    }
    const unitOfItem = it => {
      function find(arr) {
        for (const u of arr) {
          if (itemInUnit(it, u)) return u;
          if (u.children && u.children.length) {
            const found = find(u.children);
            if (found) return found;
          }
        }
        return null;
      }
      return find(units);
    };
    function renderWbUnit(u, level) {
      const ranges = getUnitPageRanges(u);
      const s = ranges.length ? Math.min(...ranges.map(r => r[0])) : (u.startPage || 0);
      const e = ranges.length ? Math.max(...ranges.map(r => r[1])) : (u.endPage || 0);
      const hasChildren = u.children && u.children.length > 0;
      // 关键：有子单元时，父单元只显示"直接属于自己"的条目（页码在父单元自身范围但不在任何子单元范围），避免与子单元重复显示
      let inUnit;
      if (hasChildren) {
        const childRanges = [];
        (u.children || []).forEach(c => childRanges.push(...getUnitPageRanges(c)));
        inUnit = filtered.filter(({ it }) => {
          if (u.startPage == null || u.endPage == null) return false;
          const pg = pageOf(it);
          if (pg < u.startPage || pg > u.endPage) return false;
          return !childRanges.some(([cs, ce]) => pg >= cs && pg <= ce);
        });
      } else {
        inUnit = filtered.filter(({ it }) => itemInUnit(it, u));
      }
      if (!inUnit.length && !hasChildren) return '';
      // 父单元的总条目数（含子单元），与 getUnitMastery 的计算范围一致
      const totalInUnit = filtered.filter(({ it }) => itemInUnit(it, u)).length;
      const info = getUnitMastery(p, u);
      // 四态渲染（仅错题本；背书走旧逻辑）
      let umi, upct, uBarColor;
      if (p.type === 'mistake') {
        if (info.state === 'no-data' || info.state === 'unlearned') {
          umi = { label: info.state === 'unlearned' ? '尚未学到' : '未收录错题', cls: 'm-new' };
          upct = 0; uBarColor = '#e8dfd0';
        } else if (info.state === 'learned-no-mistake') {
          umi = { label: '暂无错题', cls: 'm-good' };
          upct = 100; uBarColor = '#a7d7b5';
        } else {
          const mr = info.masteryRate;
          if (mr >= 0.8) umi = { label: '错题基本攻克', cls: 'm-solid' };
          else if (mr >= 0.5) umi = { label: '错题攻克中', cls: 'm-fuzzy' };
          else umi = { label: '错题待攻克', cls: 'm-weak' };
          upct = Math.round(mr * 100);
          uBarColor = mr >= 0.8 ? '#096f4e' : (mr >= 0.5 ? '#e0a020' : '#e5484d');
        }
      } else {
        // 背书：旧逻辑
        const sc = info.masteryRate;
        umi = masteryFromScore(sc);
        upct = sc === null ? 0 : Math.round(sc * 100);
        uBarColor = sc === null ? '#e8dfd0' : (sc >= 0.8 ? '#096f4e' : (sc >= 0.4 ? '#e0a020' : '#e5484d'));
      }
      const indent = level * 16;
      const childInfo = hasChildren ? ` · ${u.children.length}个子单元` : '';
      let html = `<div class="wb-unit-group" style="margin-left:${indent}px">
        <div class="wb-unit-group-head">
          <span>${level > 0 ? '└ ' : ''}📁 ${esc(u.name || '未命名单元')} <span class="muted" style="font-size:12px">P${s}-P${e} · ${totalInUnit}条${childInfo}</span></span>
          <span style="font-size:12.5px;font-weight:600;color:${uBarColor}">${upct > 0 ? upct + '% · ' : ''}${umi.label}</span>
        </div>
        <div class="wb-unit-group-bar"><div style="height:100%;width:${upct}%;background:${uBarColor};border-radius:3px"></div></div>
        <ul class="wb-unit-items">${inUnit.map(itemLi).join('')}</ul>
      </div>`;
      if (hasChildren) u.children.forEach(c => html += renderWbUnit(c, level + 1));
      return html;
    }
    let html = units.map(u => renderWbUnit(u, 0)).join('');
    const noUnit = filtered.filter(({ it }) => !unitOfItem(it));
    if (noUnit.length) {
      html += `<div class="wb-unit-group">
        <div class="wb-unit-group-head"><span>📂 未归类 <span class="muted" style="font-size:12px">${noUnit.length}条</span></span></div>
        <ul class="wb-unit-items">${noUnit.map(itemLi).join('')}</ul>
      </div>`;
    }
    list.innerHTML = html;
  } else {
    list.innerHTML = filtered.map(itemLi).join('');
  }

  const reasonsEl = $('#wbReasons');
  const detailEl = $('#wbReasonDetail');
  const reasonBlock = $('#wbReasonBlock');
  if (isMistake) {
    reasonBlock.hidden = false;
    const permanentSet = new Set(ERROR_REASONS);
    (p.customErrorReasons || []).forEach(r => { if (r.permanent) permanentSet.add(r.name); });
    const cnt = {};
    const reasonItems = {};
    items.forEach(it => {
      (it.errTags || []).forEach(tag => {
        if (permanentSet.has(tag)) {
          cnt[tag] = (cnt[tag] || 0) + 1;
          (reasonItems[tag] = reasonItems[tag] || []).push(it);
        }
      });
    });
    if (!Array.isArray(p.reasonOrder)) p.reasonOrder = [];
    let arr = Object.entries(cnt).sort((a, b) => {
      const ia = p.reasonOrder.indexOf(a[0]), ib = p.reasonOrder.indexOf(b[0]);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return b[1] - a[1];
    });
    const total = arr.reduce((s, [, n]) => s + n, 0);
    if (!total) {
      reasonsEl.innerHTML = '<div style="font-size:13px;color:var(--muted)">还没有标注错因，录入错题时选一个吧～错因按历史累计统计，做对后仍会保留。</div>';
      detailEl.innerHTML = '';
    } else {
      const R = 70, r = 42, cx = 85, cy = 85;
      let ang = -Math.PI / 2;
      let paths = '';
      arr.forEach(([name, n]) => {
        const frac = n / total;
        const a2 = ang + frac * Math.PI * 2;
        const large = (a2 - ang) > Math.PI ? 1 : 0;
        const x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang);
        const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
        const x3 = cx + r * Math.cos(a2), y3 = cy + r * Math.sin(a2);
        const x4 = cx + r * Math.cos(ang), y4 = cy + r * Math.sin(ang);
        const [bg] = reasonColor(name);
        paths += `<path d="M${x1} ${y1} A${R} ${R} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${r} ${r} 0 ${large} 0 ${x4} ${y4} Z" fill="${bg}" data-reason="${esc(name)}" style="cursor:pointer"></path>`;
        ang = a2;
      });
      const legend = arr.map(([name, n]) => {
        const [bg] = reasonColor(name);
        const pc = Math.round(n / total * 100);
        const rel = reasonItems[name] || [];
        const relMastered = rel.filter(isMastered).length;
        return `<div class="wb-pie-row" data-reason="${esc(name)}" title="历史累计 ${n} 次 · 涉及 ${rel.length} 题 · 已攻克 ${relMastered} 题">
          <span class="dot" style="background:${bg}"></span>
          <span class="nm">${esc(name)} <span class="muted" style="font-size:11px">✓${relMastered}/${rel.length}</span></span>
          <span class="ct">${n}</span>
          <span class="pc">${pc}%</span></div>`;
      }).join('');
      reasonsEl.innerHTML = `
        <svg class="wb-pie" width="170" height="170" viewBox="0 0 170 170">
          ${paths}
          <text x="85" y="82" text-anchor="middle" font-size="26" font-weight="700" class="wb-pie-num">${total}</text>
          <text x="85" y="100" text-anchor="middle" font-size="11" class="wb-pie-label">累计错次</text>
        </svg>
        <div class="wb-pie-legend">
          <div style="font-size:11.5px;color:var(--muted);margin-bottom:2px">按历史累计统计，做对后仍保留；✓已攻克/涉及题数</div>
          ${legend}
        </div>`;
      const showDetail = name => {
        const matched = (reasonItems[name] || []);
        const mMastered = matched.filter(isMastered).length;
        const head = `<div class="rd-head">${esc(name)} · ${matched.length} 题 · 已攻克 ${mMastered} · 待巩固 ${matched.length - mMastered}</div>`;
        detailEl.innerHTML = head +
          (matched.length ? matched.map(it => {
            const loc = getItemSource(it, p);
            const status = isMastered(it)
              ? '<span style="color:var(--ok);font-weight:600;white-space:nowrap">✓ 已攻克</span>'
              : `<span style="color:${scoreOf(it) < weakThreshold ? '#b02e24' : '#96600c'};font-weight:600;white-space:nowrap">${getMasteryInfo(it).label}</span>`;
            const locTxt = [loc, fmtCN(it.learnedDate)].filter(Boolean).join(' · ');
            return `<div class="rd-item"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.content)}</span><span style="display:flex;gap:8px;align-items:center;flex:0 0 auto"><span class="muted" style="white-space:nowrap">${esc(locTxt)}</span>${status}</span></div>`;
          }).join('')
          : '<div class="muted" style="font-size:12.5px">没有相关条目</div>');
      };
      reasonsEl.onclick = e => {
        const el = e.target.closest('[data-reason]');
        if (el) showDetail(el.dataset.reason);
      };
      showDetail(arr[0][0]);
    }
  } else {
    reasonBlock.hidden = true;
    reasonsEl.innerHTML = '';
    detailEl.innerHTML = '';
  }

  const pad = $('#wbNotePad');
  pad.value = p.notePad || '';
  // 笔记输入高频：立即更新内存值，落盘（含 IndexedDB）做防抖，避免每次按键都全量序列化；
  // 切后台/关闭页面有 visibilitychange/pagehide/beforeunload 强制保存兜底，不丢数据
  pad.oninput = () => {
    p.notePad = pad.value; p.updatedAt = Date.now();
    if (pad._saveT) clearTimeout(pad._saveT);
    pad._saveT = setTimeout(() => { pad._saveT = null; saveStore(); }, 600);
  };

  // 单元掌握度：仅背书且开启单元模式时显示（错题不使用单元）
  const unitBlock = $('#wbUnitBlock');
  const unitsEl = $('#wbUnits');
  if (useUnit) {
    unitBlock.hidden = false;
    const units = [...p.units].sort((a, b) => (a.startPage || 0) - (b.startPage || 0));
    function renderWbUnitRow(u, level) {
      const ranges = getUnitPageRanges(u);
      const s = ranges.length ? Math.min(...ranges.map(r => r[0])) : (u.startPage || 0);
      const e = ranges.length ? Math.max(...ranges.map(r => r[1])) : (u.endPage || 0);
      const info = getUnitMastery(p, u);
      let mi, pct, barColor;
      if (p.type === 'mistake') {
        if (info.state === 'no-data' || info.state === 'unlearned') {
          mi = { label: info.state === 'unlearned' ? '尚未学到' : '未收录错题', cls: 'm-new' };
          pct = 0; barColor = '#e8dfd0';
        } else if (info.state === 'learned-no-mistake') {
          mi = { label: '暂无错题', cls: 'm-good' };
          pct = 100; barColor = '#a7d7b5';
        } else {
          const mr = info.masteryRate;
          if (mr >= 0.8) mi = { label: '错题基本攻克', cls: 'm-solid' };
          else if (mr >= 0.5) mi = { label: '错题攻克中', cls: 'm-fuzzy' };
          else mi = { label: '错题待攻克', cls: 'm-weak' };
          pct = Math.round(mr * 100);
          barColor = mr >= 0.8 ? '#096f4e' : (mr >= 0.5 ? '#e0a020' : '#e5484d');
        }
      } else {
        const sc = info.masteryRate;
        mi = masteryFromScore(sc);
        pct = sc === null ? 0 : Math.round(sc * 100);
        barColor = sc === null ? '#e8dfd0' : (sc >= 0.8 ? '#096f4e' : (sc >= 0.4 ? '#e0a020' : '#e5484d'));
      }
      const indent = level * 16;
      const hasChildren = u.children && u.children.length > 0;
      const childInfo = hasChildren ? ` · ${u.children.length}个子单元` : '';
      let html = `<div class="wb-unit-row" style="margin-left:${indent}px">
        <div class="wb-unit-head">
          <span>${level > 0 ? '└ ' : ''}${esc(u.name || '未命名单元')} <span class="muted">P${s}-P${e}${childInfo}</span></span>
          <span class="muted">${pct > 0 ? pct + '% · ' : ''}${mi.label}</span>
        </div>
        <div class="wb-unit-bar"><div class="wb-unit-fill" style="width:${pct}%;background:${barColor}"></div></div>
      </div>`;
      if (hasChildren) u.children.forEach(c => html += renderWbUnitRow(c, level + 1));
      return html;
    }
    unitsEl.innerHTML = units.map(u => renderWbUnitRow(u, 0)).join('');
  } else {
    unitBlock.hidden = true;
    unitsEl.innerHTML = '';
  }
}

