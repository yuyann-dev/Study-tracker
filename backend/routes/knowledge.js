/**
 * routes/knowledge.js — 考研大纲知识库管理 API
 *
 * 仅超管可写（添加/更新/删除大纲分块），所有登录用户可读（检索）。
 * 检索接口供 AI 工具 search_syllabus 内部调用，也提供公开查询接口。
 */
const express = require('express');
const db = require('../database');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/respond');
const knowledgeSearch = require('../utils/knowledgeSearch');

const router = express.Router();
router.use(authRequired);

// ── 公开检索接口（所有登录用户可用）────────────────────────────────────

/**
 * GET /api/knowledge/search?q=xxx&subject=math2&limit=5
 * 检索相关大纲知识点
 */
router.get('/search', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return fail(res, '查询不能为空');
    const subject = String(req.query.subject || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 20);
    const results = knowledgeSearch.search(q, { subject, limit });
    return ok(res, { query: q, count: results.length, results });
  } catch (e) {
    console.error('[knowledge] search error:', e);
    return fail(res, '检索失败');
  }
});

/**
 * GET /api/knowledge/stats
 * 知识库统计
 */
router.get('/stats', (req, res) => {
  try {
    const stats = knowledgeSearch.getStats();
    return ok(res, stats);
  } catch (e) {
    return fail(res, '获取统计失败');
  }
});

/**
 * GET /api/knowledge/subjects
 * 科目列表
 */
router.get('/subjects', (req, res) => {
  try {
    const subjects = knowledgeSearch.listSubjects();
    return ok(res, { subjects });
  } catch (e) {
    return fail(res, '获取科目列表失败');
  }
});

// ── 超管管理接口（仅 is_admin=2 可用）──────────────────────────────────

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.is_admin !== 2) {
    return res.status(403).json({ ok: false, error: '仅超管可操作' });
  }
  next();
}

/**
 * POST /api/knowledge/chunk
 * 添加/更新大纲分块（id 存在则更新）
 */
router.post('/chunk', requireSuperAdmin, (req, res) => {
  try {
    const { id, subject, chapter, title, content, keywords, difficulty, source } = req.body;
    if (!subject || !chapter || !title || !content) {
      return fail(res, 'subject/chapter/title/content 为必填项');
    }
    const validSubjects = ['math1', 'math2', 'english1', 'english2', 'politics', '408', 'ustc843'];
    if (!validSubjects.includes(subject)) {
      return fail(res, '科目不合法');
    }
    if (id) {
      db.prepare(`UPDATE knowledge_chunks SET subject=?, chapter=?, title=?, content=?, keywords=?, difficulty=?, source=? WHERE id=?`)
        .run(subject, chapter, title, content, keywords || '', difficulty || 'normal', source || '', id);
      return ok(res, { id, updated: true });
    } else {
      const result = db.prepare(`INSERT INTO knowledge_chunks (subject, chapter, title, content, keywords, difficulty, source) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(subject, chapter, title, content, keywords || '', difficulty || 'normal', source || '');
      return ok(res, { id: result.lastInsertRowid, created: true });
    }
  } catch (e) {
    console.error('[knowledge] chunk save error:', e);
    return fail(res, '保存失败');
  }
});

/**
 * POST /api/knowledge/batch
 * 批量导入大纲分块
 */
router.post('/batch', requireSuperAdmin, (req, res) => {
  try {
    const chunks = req.body.chunks;
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return fail(res, 'chunks 必须是非空数组');
    }
    const validSubjects = ['math1', 'math2', 'english1', 'english2', 'politics', '408', 'ustc843'];
    let inserted = 0, skipped = 0;
    const stmt = db.prepare(`INSERT INTO knowledge_chunks (subject, chapter, title, content, keywords, difficulty, source) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const tx = db.transaction((items) => {
      for (const c of items) {
        if (!c.subject || !c.chapter || !c.title || !c.content) { skipped++; continue; }
        if (!validSubjects.includes(c.subject)) { skipped++; continue; }
        stmt.run(c.subject, c.chapter, c.title, c.content, c.keywords || '', c.difficulty || 'normal', c.source || '');
        inserted++;
      }
    });
    tx(chunks);
    return ok(res, { inserted, skipped, total: chunks.length });
  } catch (e) {
    console.error('[knowledge] batch error:', e);
    return fail(res, '批量导入失败');
  }
});

/**
 * DELETE /api/knowledge/chunk/:id
 * 删除分块
 */
router.delete('/chunk/:id', requireSuperAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    db.prepare('DELETE FROM knowledge_chunks WHERE id = ?').run(id);
    return ok(res, { deleted: true });
  } catch (e) {
    return fail(res, '删除失败');
  }
});

/**
 * GET /api/knowledge/list?subject=math2
 * 列出所有分块（超管用）
 */
router.get('/list', requireSuperAdmin, (req, res) => {
  try {
    const subject = String(req.query.subject || '').trim();
    let sql = 'SELECT * FROM knowledge_chunks';
    const params = [];
    if (subject) { sql += ' WHERE subject = ?'; params.push(subject); }
    sql += ' ORDER BY subject, chapter, id';
    const rows = db.prepare(sql).all(...params);
    return ok(res, { chunks: rows });
  } catch (e) {
    return fail(res, '获取列表失败');
  }
});

module.exports = router;
