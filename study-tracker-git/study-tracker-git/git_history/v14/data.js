/**
 * routes/data.js — 用户全量数据云同步
 *
 *   GET /api/data  拉取当前用户的 store 快照（无数据返回 store:null）
 *   PUT /api/data  全量覆盖写入（10 人以内规模下最简单可靠）
 */
const express = require('express');
const db = require('../database');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/respond');

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
    const { store } = req.body || {};
    if (!store || typeof store !== 'object') return fail(res, 'store 字段必须是对象');
    const json = JSON.stringify(store);
    db.prepare(
      `INSERT INTO user_data (user_id, store_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET store_json = excluded.store_json, updated_at = excluded.updated_at`
    ).run(req.user.id, json);
    const row = db.prepare('SELECT updated_at FROM user_data WHERE user_id = ?').get(req.user.id);
    return ok(res, { updatedAt: row.updated_at });
  } catch (e) {
    console.error('PUT /api/data error:', e.message);
    return fail(res, '服务器内部错误', 500);
  }
});

module.exports = router;
