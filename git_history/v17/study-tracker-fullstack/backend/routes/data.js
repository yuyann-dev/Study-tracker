/**
 * routes/data.js — 用户全量数据云同步
 *
 *   GET /api/data  拉取当前用户的 store 快照（无数据返回 store:null）
 *   PUT /api/data  服务端合并写入（与云端现有数据按墓碑/项目/items/records 对称合并，
 *                  落库前 prune 30 天墓碑，并维护 user_data.project_count）
 */
const express = require('express');
const db = require('../database');
const { config } = require('../config');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/respond');
const { mergeStoresServer, pruneTombstones } = require('../utils/syncMerge');

const router = express.Router();
router.use(authRequired);

// GET /api/data
router.get('/', (req, res) => {
  try {
    const row = db.prepare('SELECT store_json, updated_at FROM user_data WHERE user_id = ?').get(req.user.id);
    if (!row) return ok(res, { store: null, updatedAt: null });
    let store = null;
    try { store = JSON.parse(row.store_json); } catch (_) { /* 损坏数据时降级为 null */ }
    return ok(res, { store, updatedAt: row.updated_at });
  } catch (e) {
    console.error('GET /api/data error:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

// PUT /api/data  body: { store: {...} }
router.put('/', (req, res) => {
  try {
    const incoming = (req.body || {}).store;
    if (!incoming || typeof incoming !== 'object') return fail(res, 'store 字段必须是对象');

    // 取云端现有数据，做服务端对称合并，再落库
    const existingRow = db.prepare('SELECT store_json FROM user_data WHERE user_id = ?').get(req.user.id);
    let existing = null;
    if (existingRow && existingRow.store_json) {
      try { existing = JSON.parse(existingRow.store_json); } catch (_) { existing = null; }
    }
    const merged = mergeStoresServer(existing, incoming);

    // 落库前做墓碑 GC（30 天，与前端对齐），防止服务端 tombstones 无限增长（thesis-1.5）
    pruneTombstones(merged, 30);

    // 维护 user_data.project_count 冗余列，admin 列表免 JSON.parse 全表（admin-checklist 1.2/2.1）
    const projectCount = merged.projects && typeof merged.projects === 'object'
      ? Object.keys(merged.projects).length
      : 0;

    const json = JSON.stringify(merged);
    if (json.length > config.jsonBodyLimitBytes) return fail(res, '数据超出大小限制', 413);

    db.prepare(
      `INSERT INTO user_data (user_id, store_json, project_count, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET store_json = excluded.store_json,
              project_count = excluded.project_count, updated_at = excluded.updated_at`
    ).run(req.user.id, json, projectCount);
    const row = db.prepare('SELECT updated_at FROM user_data WHERE user_id = ?').get(req.user.id);
    return ok(res, { updatedAt: row.updatedAt, projectCount });
  } catch (e) {
    console.error('PUT /api/data error:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

module.exports = router;
