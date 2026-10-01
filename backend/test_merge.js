/**
 * 服务端合并逻辑测试：模拟多设备并发推送的各种场景
 */
const assert = require('assert');
const { mergeStoresServer } = require('./utils/syncMerge');

let pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

const proj = (id, updatedAt, recordIds) => ({
  id, name: id, updatedAt,
  records: (recordIds || []).map(rid => ({ rid, date: '2026-09-01' })),
});
const empty = { currentId: null, projects: {}, unitTemplates: [], paperTemplates: [], tombstones: {} };

// 场景1：A 删除 X 已落云端，B 随后推送仍含 X 的旧数据 → X 必须保持删除（核心）
test('删除不被旧数据推送复活', () => {
  const cloudAfterDelete = { ...empty, tombstones: { X: 200 } };
  const bPush = { ...empty, projects: { X: proj('X', 100) } };
  const merged = mergeStoresServer(cloudAfterDelete, bPush);
  assert.strictEqual(merged.projects.X, undefined, 'X 应已删除');
  assert.strictEqual(merged.tombstones.X, 200, '墓碑保留');
});

// 场景2：B 推送的 X 比删除时间新（删除后又编辑）→ X 复活
test('删除后更新的编辑会复活项目', () => {
  const cloudAfterDelete = { ...empty, tombstones: { X: 200 } };
  const bPush = { ...empty, projects: { X: proj('X', 300) } };
  const merged = mergeStoresServer(cloudAfterDelete, bPush);
  assert.ok(merged.projects.X, 'X 应复活');
  assert.strictEqual(merged.projects.X.updatedAt, 300);
});

// 场景3：双方各有不同项目 → 都保留
test('不同设备的不同项目都保留', () => {
  const a = { ...empty, projects: { X: proj('X', 100) } };
  const b = { ...empty, projects: { Y: proj('Y', 100) } };
  const merged = mergeStoresServer(a, b);
  assert.ok(merged.projects.X && merged.projects.Y);
});

// 场景4：同一项目双方各新增不同 records → records 合并去重
test('同一项目的 records 合并去重', () => {
  const a = { ...empty, projects: { X: proj('X', 100, ['r1']) } };
  const b = { ...empty, projects: { X: proj('X', 200, ['r1', 'r2']) } };
  const merged = mergeStoresServer(a, b);
  const rids = merged.projects.X.records.map(r => r.rid).sort();
  assert.deepStrictEqual(rids, ['r1', 'r2']);
});

// 场景5：A 删 X、B 删 Y 的墓碑对称合并 → 两个墓碑都在
test('双方不同删除的墓碑都保留', () => {
  const a = { ...empty, tombstones: { X: 200 } };
  const b = { ...empty, tombstones: { Y: 300 } };
  const merged = mergeStoresServer(a, b);
  assert.strictEqual(merged.tombstones.X, 200);
  assert.strictEqual(merged.tombstones.Y, 300);
});

// 场景6：连续两次推送，第一次删 X，第二次只含 Y（无 X 墓碑）→ X 仍删除
test('墓碑不会被一次"无关推送"冲掉', () => {
  const afterX = { ...empty, tombstones: { X: 200 }, projects: { Y: proj('Y', 100) } };
  const pushY = { ...empty, projects: { Y: proj('Y', 300) } };
  const merged = mergeStoresServer(afterX, pushY);
  assert.strictEqual(merged.projects.X, undefined);
  assert.strictEqual(merged.tombstones.X, 200);
  assert.strictEqual(merged.projects.Y.updatedAt, 300);
});

// 场景7：空云端首次推送 → 正常写入
test('空云端首次推送', () => {
  const push = { ...empty, projects: { X: proj('X', 100) }, currentId: 'X' };
  const merged = mergeStoresServer(null, push);
  assert.ok(merged.projects.X);
  assert.strictEqual(merged.currentId, 'X');
});

// 场景8：自定义模板对称合并
test('自定义模板合并', () => {
  const a = { ...empty, unitTemplates: [{ id: 't1', name: 't1' }] };
  const b = { ...empty, unitTemplates: [{ id: 't2', name: 't2' }] };
  const merged = mergeStoresServer(a, b);
  const ids = merged.unitTemplates.map(t => t.id).sort();
  assert.deepStrictEqual(ids, ['t1', 't2']);
});

// 场景9：两台设备改不同 item → 两个 item 都保留（thesis-57 items 字段级合并，核心）
test('两端改不同 item 互不覆盖', () => {
  const a = { ...empty, projects: { X: { id: 'X', name: 'X', updatedAt: 100, records: [], items: [
    { id: 'i1', updatedAt: 100, stage: 0, reviews: [] },
  ] } } };
  const b = { ...empty, projects: { X: { id: 'X', name: 'X', updatedAt: 200, records: [], items: [
    { id: 'i2', updatedAt: 200, stage: 1, reviews: [] },
  ] } } };
  const merged = mergeStoresServer(a, b);
  const ids = merged.projects.X.items.map((it) => it.id).sort();
  assert.deepStrictEqual(ids, ['i1', 'i2'], 'i1/i2 两个 item 都应保留');
});

// 场景10：同一 item 两端都改 → 按 updatedAt 较新者胜（字段级 LWW）
test('同一 item 按 updatedAt LWW', () => {
  const a = { ...empty, projects: { X: { id: 'X', updatedAt: 100, records: [], items: [
    { id: 'i1', updatedAt: 100, stage: 0, reviews: [] },
  ] } } };
  const b = { ...empty, projects: { X: { id: 'X', updatedAt: 200, records: [], items: [
    { id: 'i1', updatedAt: 300, stage: 2, reviews: [] },
  ] } } };
  const merged = mergeStoresServer(a, b);
  assert.strictEqual(merged.projects.X.items[0].stage, 2, '更新的一端 stage=2 应胜出');
});

// 场景11：同一 item updatedAt 相同 → reviews 较长者胜
test('updatedAt 相同时按 reviews 长度 LWW', () => {
  const a = { ...empty, projects: { X: { id: 'X', updatedAt: 100, records: [], items: [
    { id: 'i1', updatedAt: 100, stage: 0, reviews: [{ q: 1 }, { q: 2 }] },
  ] } } };
  const b = { ...empty, projects: { X: { id: 'X', updatedAt: 200, records: [], items: [
    { id: 'i1', updatedAt: 100, stage: 1, reviews: [{ q: 1 }] },
  ] } } };
  const merged = mergeStoresServer(a, b);
  assert.strictEqual(merged.projects.X.items[0].stage, 0, 'reviews 更长的 a 端（stage0）应胜出');
});

// 场景12：墓碑 GC —— 30 天前墓碑被清，新墓碑保留（thesis-61）
test('pruneTombstones 清理过期墓碑保留新墓碑', () => {
  const { pruneTombstones } = require('./utils/syncMerge');
  const now = Date.now();
  const store = { tombstones: { old: now - 60 * 86400 * 1000, recent: now - 10 * 86400 * 1000 } };
  pruneTombstones(store, 30);
  assert.strictEqual(store.tombstones.old, undefined, '60 天前墓碑应被清');
  assert.strictEqual(store.tombstones.recent, now - 10 * 86400 * 1000, '10 天前墓碑应保留');
});

console.log('\n' + pass + ' 个测试通过');
