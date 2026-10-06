/**
 * backend/test_scheduler.js — 间隔重复调度纯函数单元测试
 *
 * 覆盖前端 transitionReview（移植自 frontend/index.html:6562）的三档质量模型：
 *   good / fuzzy / forgot × 首次学习 / 非首次 / 连续 forgot 退轮 / 边界（最后一轮、stage=0）。
 * 运行：node test_scheduler.js （npm test 会一并跑 test_merge.js）
 */
const assert = require('assert');
const { DEFAULT_INTERVALS, transitionReview, replayReviews, isGraduated } = require('./utils/scheduler');

const IV = DEFAULT_INTERVALS; // [1,2,4,7,15,30]
let pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

// ── 首次学习（isFirstLearn=true）：三档按首间隔比例缩放 ──
test('首次学习 good：stage=0，gap=首间隔1，wrongStreak=0', () => {
  const r = transitionReview(IV, 0, 0, 'good', true);
  assert.deepStrictEqual(r, { stage: 0, gap: 1, wrongStreak: 0 });
});
test('首次学习 fuzzy：gap≈0.5×首间隔，wrongStreak=0', () => {
  const r = transitionReview(IV, 0, 0, 'fuzzy', true);
  assert.strictEqual(r.stage, 0);
  assert.strictEqual(r.gap, 1); // round(1*0.5)=1
  assert.strictEqual(r.wrongStreak, 0);
});
test('首次学习 forgot：gap≈0.3×首间隔，wrongStreak=1', () => {
  const r = transitionReview(IV, 0, 0, 'forgot', true);
  assert.strictEqual(r.stage, 0);
  assert.strictEqual(r.gap, 1); // round(1*0.3)=1
  assert.strictEqual(r.wrongStreak, 1);
});

// ── 非首次：good 进轮 ──
test('非首次 good：stage 0→1，gap 取次轮间隔2', () => {
  const r = transitionReview(IV, 0, 0, 'good', false);
  assert.deepStrictEqual(r, { stage: 1, gap: 2, wrongStreak: 0 });
});
test('非首次 good 在最后一轮：stage 封顶 last，gap=30', () => {
  const r = transitionReview(IV, IV.length - 1, 0, 'good', false);
  assert.strictEqual(r.stage, IV.length - 1);
  assert.strictEqual(r.gap, 30);
});

// ── 非首次：fuzzy 进轮但间隔受限 ──
test('非首次 fuzzy（stage=0）：进一轮且 gap≤max(1.3×cur,nextGap)', () => {
  const r = transitionReview(IV, 0, 0, 'fuzzy', false);
  assert.strictEqual(r.stage, 1);
  assert.strictEqual(r.gap, 2); // min(nextGap=2, max(2,1))=2
  assert.strictEqual(r.wrongStreak, 0);
});
test('fuzzy 在最后一轮不毕业，间隔小幅拉长到 cur×1.3', () => {
  const r = transitionReview(IV, IV.length - 1, 0, 'fuzzy', false);
  assert.strictEqual(r.stage, IV.length - 1);
  assert.strictEqual(r.gap, Math.max(30 + 1, Math.round(30 * 1.3))); // 39
});

// ── 非首次：forgot 停留本轮 / 连续退轮 ──
test('非首次 forgot（首次错）：停留 stage，gap 回首轮，wrongStreak=1', () => {
  const r = transitionReview(IV, 2, 0, 'forgot', false);
  assert.strictEqual(r.stage, 2); // <rollbackAfter 不退轮
  assert.strictEqual(r.gap, 1);
  assert.strictEqual(r.wrongStreak, 1);
});
test('连续第2次 forgot：退一轮（2→1），gap 回首轮', () => {
  const r = transitionReview(IV, 2, 1, 'forgot', false);
  assert.strictEqual(r.wrongStreak, 2);
  assert.strictEqual(r.stage, 1); // 2-1
  assert.strictEqual(r.gap, 1);
});
test('stage=0 连续 forgot：退轮下限 max(0,-1)=0，不穿底', () => {
  const r = transitionReview(IV, 0, 1, 'forgot', false);
  assert.strictEqual(r.stage, 0);
  assert.strictEqual(r.wrongStreak, 2);
});

// ── replay / 毕业判定 ──
test('回放连续 good×6：stage 到最后一轮，满足毕业条件', () => {
  const reviews = ['good', 'good', 'good', 'good', 'good', 'good'].map((q) => ({ quality: q }));
  const r = replayReviews(IV, reviews);
  assert.strictEqual(r.stage, IV.length - 1);
  assert.strictEqual(isGraduated(IV, reviews), true);
});
test('回放中间夹一次 forgot：最近3次不全 good，不毕业', () => {
  const reviews = ['good', 'good', 'good', 'good', 'good', 'forgot'].map((q) => ({ quality: q }));
  assert.strictEqual(isGraduated(IV, reviews), false);
});
test('复习<3 次永不毕业', () => {
  const reviews = ['good', 'good'].map((q) => ({ quality: q }));
  assert.strictEqual(isGraduated(IV, reviews), false);
});
test('首次 forgot 后 good：wrongStreak 清零并正常进轮', () => {
  const r = replayReviews(IV, [{ quality: 'forgot' }, { quality: 'good' }]);
  assert.strictEqual(r.stage, 1);
  assert.strictEqual(r.wrongStreak, 0);
  assert.strictEqual(r.lastGap, 2);
});

// ── 自定义间隔序列首次学习缩放 ──
test('自定义序列 [3,7,15] 首次 fuzzy/forgot 缩放', () => {
  const cust = [3, 7, 15];
  assert.strictEqual(transitionReview(cust, 0, 0, 'fuzzy', true).gap, Math.max(1, Math.round(3 * 0.5))); // 2
  assert.strictEqual(transitionReview(cust, 0, 0, 'forgot', true).gap, Math.max(1, Math.round(3 * 0.3))); // 1
});

console.log('\n' + pass + ' 个调度器测试通过');
