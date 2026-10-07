/**
 * routes/ai.js — Study Tracker AI 助手后端（M1+M2 P0 核心）
 *
 * 全部接口走 authRequired（req.user.id 可用）。响应统一 ok/fail。
 * 数据安全：只读 user_data.store_json，绝不 SELECT users 敏感列注入 prompt；
 *           API key 任何 GET 接口都不回传明文，只回 keyPreview。
 *
 * 路由分组：
 *   配置        GET/PUT /api/ai/config, POST /api/ai/config/test
 *   会话        GET/POST /api/ai/conversations, GET messages, DELETE
 *   主对话      POST /api/ai/chat
 *   应用/撤销   POST /api/ai/apply, POST /api/ai/undo, GET /api/ai/actions
 *   画像        GET/PUT /api/ai/profile, POST /api/ai/profile/refresh
 *   L0 本地     GET /api/ai/summary|mistake-report|paper-trend|balance|today-plan
 *   用量        GET /api/ai/usage
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../database');
const { authRequired } = require('../middleware/auth');
const { ok, fail } = require('../utils/respond');
const aiCrypto = require('../utils/aiCrypto');
const aiIntent = require('../utils/aiIntent');
const aggregator = require('../utils/aiDataAggregator');
const aiProxy = require('../utils/aiProxy');
const aiPrompt = require('../utils/aiPrompt');
const aiTools = require('../utils/aiTools');
const aiProviders = require('../utils/aiProviders');

const router = express.Router();
router.use(authRequired);

// AI 路由单独限流：按用户 ID（不是 IP），每分钟 60 次。
// 必须在 authRequired 之后，keyGenerator 才能拿到 req.user.id。
const aiUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.id),
  message: { ok: false, error: 'AI 请求过于频繁，请稍后再试' },
});
router.use(aiUserLimiter);

/**
 * AI 专用错误响应：在标准 {ok:false,error} 上多带 code，前端据 code 显示友好提示/重试按钮。
 * @param {import('express').Response} res
 * @param {string} message 面向用户的文案
 * @param {string} code 业务错误码（INVALID_KEY/INSUFFICIENT_BALANCE/TIMEOUT/RATE_LIMITED/UPSTREAM_ERROR/NOT_CONFIGURED/EMPTY_INPUT）
 * @param {number} status HTTP 状态码
 * @param {object} [extra] 附加字段（如 needConfig/detail）
 */
function failCode(res, message, code, status = 400, extra = {}) {
  return res.status(status).json(Object.assign({ ok: false, error: message, code }, extra));
}

// ── 内部工具 ────────────────────────────────────────────────────────────────

// 固定东八区日期，避免服务器时区为 UTC 时跨日统计错乱（与 ai_usage_daily.date 口径一致）
function todayLocal() {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // 偏移到 UTC+8
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

function getConfigRow(userId) {
  return db.prepare('SELECT * FROM ai_configs WHERE user_id = ?').get(userId);
}

function getTodayUsage(userId, date) {
  return db.prepare('SELECT * FROM ai_usage_daily WHERE user_id = ? AND date = ?').get(userId, date);
}

function bumpUsage(userId, date, tokensIn, tokensOut) {
  db.prepare(
    `INSERT INTO ai_usage_daily (user_id, date, tokens_in, tokens_out, calls)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(user_id, date) DO UPDATE SET
       tokens_in = tokens_in + excluded.tokens_in,
       tokens_out = tokens_out + excluded.tokens_out,
       calls = calls + 1`
  ).run(userId, date, tokensIn, tokensOut);
}

// 长期记忆上限：DB 最多保留 MEMORY_MAX 条，超出时按「强度低→最久未用→最早」淘汰。
// /chat 与 /chat/stream 注入同一条数，避免两个入口记忆表现不一致。
const MEMORY_MAX = 15;
const MEMORY_INJECT_LIMIT = 15;
const MEMORY_STRENGTH_CAP = 20;

/**
 * 取要注入到 system prompt 的记忆，并顺带把这些记忆标记为"刚被使用"：
 * strength+1（封顶）、last_used_at=now，让淘汰真正变成 LRU（旧逻辑 strength 恒为 1，
 * last_used_at 从不写，淘汰退化为按 id 的 FIFO）。
 * 注意：必须在把 memories 传给 buildSystemPrompt 之前调用，且与记忆开关解耦——
 * 开关关闭时调用方直接传 []，不走这里。
 */
function selectMemoriesForPrompt(userId) {
  const rows = db.prepare(
    'SELECT id, content FROM ai_memory WHERE user_id=? ORDER BY strength DESC, last_used_at DESC, id ASC LIMIT ?'
  ).all(userId, MEMORY_INJECT_LIMIT);
  if (rows.length) {
    const idList = rows.map((r) => r.id);
    db.prepare(
      `UPDATE ai_memory SET strength = MIN(strength + 1, ${MEMORY_STRENGTH_CAP}), last_used_at = datetime('now')
       WHERE user_id=? AND id IN (${idList.map(() => '?').join(',')})`
    ).run(userId, ...idList);
  }
  return rows;
}

/**
 * 落库一条长期记忆：内容精确去重；达到上限先淘汰最弱/最久未用；
 * sourceMessageId 关联本轮消息，删除会话时按消息级联清理（修复此前恒写 NULL 导致级联失效）。
 */
function saveMemoryForUser(userId, kind, content, sourceMessageId) {
  const exists = db.prepare('SELECT id FROM ai_memory WHERE user_id=? AND content=?').get(userId, content);
  if (exists) return;
  const count = db.prepare('SELECT COUNT(*) AS c FROM ai_memory WHERE user_id=?').get(userId).c;
  if (count >= MEMORY_MAX) {
    db.prepare(
      'DELETE FROM ai_memory WHERE user_id=? ORDER BY strength ASC, last_used_at ASC, id ASC LIMIT 1'
    ).run(userId);
  }
  db.prepare(
    "INSERT INTO ai_memory (user_id, kind, content, strength, source_message_id, created_at) VALUES (?, ?, ?, 1, ?, datetime('now'))"
  ).run(userId, kind, content, sourceMessageId);
}

/** 读取该用户 store 里所有 project id（用于校验 actions.projectId） */
function storeProjects(userId) {
  const store = aggregator.loadStore(userId);
  return (store && store.projects) || {};
}

/** 构建本地启发式画像（不调大模型，省 token） */
function buildLocalProfile(userId) {
  const summary = aggregator.getUserProfileSummary(userId);
  const exercise = summary.projects.filter((p) => p.type === 'exercise');
  const subjects = [...new Set(exercise.map((p) => p.subjectKey || p.name).filter(Boolean))];
  const behind = exercise.filter((p) => p.gap < -20).map((p) => p.name);
  const profile = {
    version: 1,
    examAnchor: aggregator.DEFAULT_EXAM_ANCHOR,
    subjects,
    projectCount: summary.projectCount,
    behind,
    stage: summary.daysLeft > 240 ? '基础/强化期' : summary.daysLeft > 90 ? '真题期' : '冲刺期',
    builtAt: new Date().toISOString(),
  };
  return profile;
}

function upsertProfile(userId, profileJson, editedFields) {
  db.prepare(
    `INSERT INTO ai_profile (user_id, profile_json, edited_fields_json, built_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       profile_json = excluded.profile_json,
       built_at = excluded.built_at,
       updated_at = excluded.updated_at`
  ).run(userId, JSON.stringify(profileJson), JSON.stringify(editedFields || []));
}

/** 按意图取数（chat 流水线用），支持多选视角 projectIds 数组 */
function gatherDataByIntent(userId, intent, projectIdHint, budgetMin, projectIds) {
  // 统一目标项目：优先用 projectIds 数组（多选/当前项目），空数组表示全局
  const targetIds = Array.isArray(projectIds) && projectIds.length ? projectIds : null;
  switch (intent) {
    case 'progress_query':
      return { overview: aggregator.getUserProfileSummary(userId) };
    case 'mistake_diagnosis':
      return aggregator.getMistakeReport(userId, targetIds);
    case 'recite_help':
      return aggregator.getReciteStatus(userId, targetIds);
    case 'plan_generation':
      return { todayPlan: aggregator.getTodayPlan(userId, budgetMin) };
    case 'multi_subject_balance':
      return aggregator.getMultiSubjectBalance(userId);
    case 'sprint_strategy':
      return { overview: aggregator.getUserProfileSummary(userId), balance: aggregator.getMultiSubjectBalance(userId) };
    case 'mindset_check':
      return { overview: aggregator.getUserProfileSummary(userId) };
    case 'data_interpretation':
      if (targetIds && targetIds.length === 1) {
        return { progress: aggregator.getProgressSummary(userId, targetIds[0]), paper: aggregator.getPaperTrend(userId, targetIds[0]) };
      }
      return { balance: aggregator.getMultiSubjectBalance(userId) };
    default:
      return { overview: aggregator.getUserProfileSummary(userId) };
  }
}

// ══════════════ 配置接口 ═══════════════════════════════════════════════════

// GET /api/ai/config — 脱敏配置（不回传明文 key）
router.get('/config', (req, res) => {
  try {
    const row = getConfigRow(req.user.id);
    if (!row) {
      return ok(res, { configured: false, enabled: false, provider: 'deepseek', model: '' });
    }
    return ok(res, {
      configured: true,
      provider: row.provider || 'deepseek',
      model: row.model || '',
      enabled: row.enabled === 1,
      keyPreview: row.key_preview || '',
      dailyTokenBudget: row.daily_token_budget,
      dailyStudyMinutes: row.daily_study_minutes || 240,
      memoryEnabled: row.memory_enabled !== 0,
    });
  } catch (e) {
    console.error('GET /api/ai/config error:', e.message);
    return fail(res, '服务器开小差了', 500);
  }
});

// PUT /api/ai/config — body {provider, model, apiKey?, dailyTokenBudget?}
// provider 与 model 必填（用户选了服务商+具体模型才能保存）；不传 apiKey 表示不改 key。
// 校验 model 必须属于该服务商的模型列表（防篡改）。
router.put('/config', async (req, res) => {
  try {
    const body = req.body || {};
    const apiKey = body.apiKey != null ? String(body.apiKey) : undefined;
    const dailyTokenBudget = body.dailyTokenBudget != null ? Number(body.dailyTokenBudget) : undefined;

    const row = getConfigRow(req.user.id);

    // provider 必填校验
    const provider = body.provider != null && String(body.provider).trim() !== ''
      ? String(body.provider).trim().toLowerCase()
      : (row && row.provider) || '';
    if (!provider) return fail(res, '请选择服务商');
    const prov = aiProviders.getProvider(provider);
    if (!prov) return fail(res, '不支持的服务商');

    // model 必填校验 + 必须属于该服务商
    const model = body.model != null && String(body.model).trim() !== ''
      ? String(body.model).trim()
      : (row && row.model) || '';
    if (!model) return fail(res, '请选择模型');
    if (!aiProviders.modelBelongsTo(provider, model)) return fail(res, '所选模型不属于该服务商');

    // baseUrl 取服务商默认
    const newBaseUrl = prov.baseUrl;

    // apiKey 三种情况：
    //   undefined → 不改 key；''（显式空串）→ 删除 key（清空并停用）；非空 → 加密保存
    let newEncKey = row && row.encrypted_api_key;
    let newSalt = row && row.key_salt;
    let newPreview = row && row.key_preview;
    if (apiKey === '') {
      newEncKey = null; newSalt = null; newPreview = null;
    } else if (apiKey !== undefined && apiKey !== '') {
      if (!newSalt) newSalt = aiCrypto.generateSalt();
      newEncKey = aiCrypto.encrypt(apiKey, newSalt);
      newPreview = aiCrypto.previewOf(apiKey);
    }

    const newBudget = dailyTokenBudget && Number.isFinite(dailyTokenBudget) && dailyTokenBudget > 0
      ? Math.floor(dailyTokenBudget)
      : (row ? row.daily_token_budget : 100000);

    // 每日可学分钟数：30-960（0.5h-16h），不传则沿用已存
    let newStudyMin = row ? (row.daily_study_minutes || 240) : 240;
    if (body.dailyStudyMinutes != null && Number.isFinite(Number(body.dailyStudyMinutes))) {
      newStudyMin = Math.max(30, Math.min(960, Math.floor(Number(body.dailyStudyMinutes))));
    }

    // 记忆开关：默认开启，传0关闭
    let newMemEnabled = row ? (row.memory_enabled !== 0 ? 1 : 0) : 1;
    if (body.memoryEnabled != null) {
      newMemEnabled = body.memoryEnabled ? 1 : 0;
    }

    // 配好 provider baseUrl + model + key 即视为开通；key 被删则停用
    const enabled = newBaseUrl && model && newEncKey ? 1 : 0;

    db.prepare(
      `INSERT INTO ai_configs (user_id, provider, base_url, model, encrypted_api_key, key_salt, key_preview,
             daily_token_budget, daily_study_minutes, memory_enabled, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         provider = excluded.provider,
         base_url = excluded.base_url,
         model = excluded.model,
         encrypted_api_key = excluded.encrypted_api_key,
         key_salt = excluded.key_salt,
         key_preview = excluded.key_preview,
         daily_token_budget = excluded.daily_token_budget,
         daily_study_minutes = excluded.daily_study_minutes,
         memory_enabled = excluded.memory_enabled,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`
    ).run(req.user.id, provider, newBaseUrl, model, newEncKey, newSalt, newPreview, newBudget, newStudyMin, newMemEnabled, enabled);

    return ok(res, {
      provider, model, enabled: enabled === 1,
      keyPreview: newPreview || '', dailyTokenBudget: newBudget,
      dailyStudyMinutes: newStudyMin, memoryEnabled: newMemEnabled === 1,
    });
  } catch (e) {
    console.error('PUT /api/ai/config error:', e.message);
    return fail(res, '保存配置失败', 500);
  }
});

// GET /api/ai/providers — 5 个服务商 + 各自模型列表（供前端渲染）
router.get('/providers', (req, res) => {
  try {
    return ok(res, { providers: aiProviders.listProviders() });
  } catch (e) {
    console.error('GET /api/ai/providers error:', e.message);
    return fail(res, '服务器开小差了', 500);
  }
});

// POST /api/ai/config/test — body {provider?, model?, apiKey?}（可传未保存的 key）
// 用服务商 baseUrl + 指定/已选 model 发一个最简请求测连通。
router.post('/config/test', async (req, res) => {
  try {
    const body = req.body || {};
    const row = getConfigRow(req.user.id);

    // provider：传入 > 已存 > 默认
    const provider = (body.provider != null && String(body.provider).trim())
      ? String(body.provider).trim().toLowerCase()
      : (row && row.provider) || aiProviders.DEFAULT_PROVIDER;
    const prov = aiProviders.getProvider(provider);
    if (!prov) return fail(res, '不支持的服务商');

    // model：传入 > 已存；未给则无法测
    const baseUrl = prov.baseUrl;
    const model = (body.model != null && String(body.model).trim())
      ? String(body.model).trim()
      : (row && row.model) || '';
    if (!model) return fail(res, '请先选择模型');

    let apiKey = body.apiKey != null ? String(body.apiKey) : '';

    // 校验 baseUrl（取自注册表，仍走一遍 SSRF 防护）
    try {
      await aiProxy.assertSafeBaseUrl(baseUrl);
    } catch (e) {
      return fail(res, e.message || 'baseUrl 不安全');
    }

    // 未传 key 则用已存的解密
    if (!apiKey) {
      if (!row || !row.encrypted_api_key) return fail(res, '请先填写 API Key');
      try { apiKey = aiCrypto.decrypt(row.encrypted_api_key, row.key_salt); }
      catch (e) { return fail(res, '已存 Key 解密失败，请重新填写', 400); }
    }

    const start = Date.now();
    try {
      const r = await aiProxy.callLLM(
        { baseUrl, model, apiKey, docsUrl: prov.docsUrl },
        [{ role: 'user', content: '回复 ok 两个字母即可' }],
        { maxTokens: 10 }
      );
      return ok(res, { latencyMs: Date.now() - start, provider: prov.key, reply: (r.content || '').slice(0, 50) });
    } catch (e) {
      const extra = e.aiDetail ? { detail: e.aiDetail } : {};
      return failCode(res, e.aiMessage || e.message || '连通测试失败', e.aiCode || 'UPSTREAM_ERROR', e.status || 502, extra);
    }
  } catch (e) {
    console.error('POST /api/ai/config/test error:', e.message);
    return failCode(res, '连通测试失败', 'UPSTREAM_ERROR', 502);
  }
});

// ══════════════ 会话接口 ═══════════════════════════════════════════════════

// GET /api/ai/conversations — 置顶优先，其余按最近更新倒序，分页
router.get('/conversations', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const before = parseInt(req.query.before, 10) || 0; // cursor: id
    let rows;
    if (before > 0) {
      rows = db.prepare(
        'SELECT id, title, is_pinned, last_at, created_at FROM ai_conversations WHERE user_id=? AND id < ? ORDER BY is_pinned DESC, last_at DESC, id DESC LIMIT ?'
      ).all(req.user.id, before, limit);
    } else {
      rows = db.prepare(
        'SELECT id, title, is_pinned, last_at, created_at FROM ai_conversations WHERE user_id=? ORDER BY is_pinned DESC, last_at DESC, id DESC LIMIT ?'
      ).all(req.user.id, limit);
    }
    rows = rows.map((r) => ({ id: r.id, title: r.title, isPinned: r.is_pinned === 1, lastAt: r.last_at, createdAt: r.created_at }));
    return ok(res, { conversations: rows });
  } catch (e) {
    console.error('GET /api/ai/conversations error:', e.message);
    return fail(res, '服务器开小差了', 500);
  }
});

// POST /api/ai/conversations — body {title?}
router.post('/conversations', (req, res) => {
  try {
    const title = String((req.body && req.body.title) || '新对话').slice(0, 60);
    const info = db.prepare(
      "INSERT INTO ai_conversations (user_id, title, last_at, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'), datetime('now'))"
    ).run(req.user.id, title);
    return ok(res, { id: info.lastInsertRowid, title });
  } catch (e) {
    console.error('POST /api/ai/conversations error:', e.message);
    return fail(res, '创建会话失败', 500);
  }
});

// PUT /api/ai/conversations/:id — body {title?, isPinned?}，重命名 / 置顶
router.put('/conversations/:id', (req, res) => {
  try {
    const convId = Number(req.params.id);
    const conv = db.prepare('SELECT id FROM ai_conversations WHERE id=? AND user_id=?').get(convId, req.user.id);
    if (!conv) return fail(res, '会话不存在', 404);
    const body = req.body || {};
    const sets = [];
    const params = [];
    if (body.title != null) {
      // 空串/纯空格视为无效重命名，忽略（不把标题刷成空白）；正常标题截到 60 字
      const t = String(body.title).trim().slice(0, 60);
      if (t) { sets.push('title = ?'); params.push(t); }
    }
    if (body.isPinned != null) {
      sets.push('is_pinned = ?');
      params.push(body.isPinned ? 1 : 0);
    }
    if (!sets.length) return ok(res, { updated: false });
    sets.push('updated_at = datetime(\'now\')');
    params.push(convId);
    db.prepare(`UPDATE ai_conversations SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    const row = db.prepare('SELECT id, title, is_pinned FROM ai_conversations WHERE id=?').get(convId);
    return ok(res, { id: row.id, title: row.title, isPinned: row.is_pinned === 1 });
  } catch (e) {
    console.error('PUT /api/ai/conversations/:id error:', e.message);
    return fail(res, '更新会话失败', 500);
  }
});

// DELETE /api/ai/conversations/all — 清空当前用户全部对话历史（messages 由外键级联删除）
// 注意：必须注册在 /:id 之前，否则 "all" 会被当成会话 id
router.delete('/conversations/all', (req, res) => {
  try {
    // 先删关联记忆（source_message_id 属于该用户的消息）
    db.prepare('DELETE FROM ai_memory WHERE user_id=? AND source_message_id IN (SELECT id FROM ai_messages WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE user_id=?))').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM ai_conversations WHERE user_id = ?').run(req.user.id);
    return ok(res, { deleted: true });
  } catch (e) {
    console.error('DELETE /api/ai/conversations/all error:', e.message);
    return fail(res, '清空对话失败', 500);
  }
});

// GET /api/ai/conversations/:id/messages — 分页 cursor
router.get('/conversations/:id/messages', (req, res) => {
  try {
    const convId = Number(req.params.id);
    const conv = db.prepare('SELECT id FROM ai_conversations WHERE id=? AND user_id=?').get(convId, req.user.id);
    if (!conv) return fail(res, '会话不存在', 404);
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const before = parseInt(req.query.before, 10) || 0;
    let rows;
    if (before > 0) {
      rows = db.prepare(
        'SELECT id, role, content, intent, actions_json, tokens_in, tokens_out, created_at FROM ai_messages WHERE conversation_id=? AND id < ? ORDER BY id DESC LIMIT ?'
      ).all(convId, before, limit);
    } else {
      rows = db.prepare(
        'SELECT id, role, content, intent, actions_json, tokens_in, tokens_out, created_at FROM ai_messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?'
      ).all(convId, limit);
    }
    // 反转为正序返回
    rows = rows.reverse().map((r) => ({
      id: r.id, role: r.role, content: r.content, intent: r.intent,
      actions: safeParse(r.actions_json), tokens: { in: r.tokens_in, out: r.tokens_out },
      createdAt: r.created_at,
    }));
    return ok(res, { messages: rows });
  } catch (e) {
    console.error('GET messages error:', e.message);
    return fail(res, '服务器开小差了', 500);
  }
});

// DELETE /api/ai/conversations/:id — 级联删 messages
router.delete('/conversations/:id', (req, res) => {
  try {
    const convId = Number(req.params.id);
    // 先删关联记忆
    db.prepare('DELETE FROM ai_memory WHERE user_id=? AND source_message_id IN (SELECT id FROM ai_messages WHERE conversation_id=?)').run(req.user.id, convId);
    const info = db.prepare('DELETE FROM ai_conversations WHERE id=? AND user_id=?').run(convId, req.user.id);
    // messages 由外键 ON DELETE CASCADE 删除（已开 foreign_keys=ON）
    return info.changes > 0 ? ok(res, { deleted: true }) : fail(res, '会话不存在', 404);
  } catch (e) {
    console.error('DELETE conversation error:', e.message);
    return fail(res, '删除失败', 500);
  }
});

// DELETE /api/ai/memory — 清空当前用户的所有长期记忆（不影响历史对话记录）
router.delete('/memory', (req, res) => {
  try {
    const info = db.prepare('DELETE FROM ai_memory WHERE user_id=?').run(req.user.id);
    return ok(res, { deleted: info.changes || 0 });
  } catch (e) {
    console.error('DELETE memory error:', e.message);
    return fail(res, '清空记忆失败', 500);
  }
});

// ══════════════ 主对话接口 ═══════════════════════════════════════════════════

// POST /api/ai/chat
router.post('/chat', async (req, res) => {
  try {
    const body = req.body || {};
    const userMessage = String(body.message || '').trim();
    if (!userMessage) return failCode(res, '请输入你的问题', 'EMPTY_INPUT', 400);
    const ctx = body.context || {};
    const ctxBudgetMin = ctx.budgetMin;

    // 1. 查配置
    const cfg = getConfigRow(req.user.id);
    if (!cfg || cfg.enabled !== 1 || !cfg.encrypted_api_key || !cfg.base_url || !cfg.provider || !cfg.model) {
      return failCode(res, '请先在AI设置中配置API key', 'NOT_CONFIGURED', 409, { needConfig: true });
    }

    // 时间预算：前端传了用前端，否则用用户设置的默认每日可学分钟数
    const budgetMin = (Number(ctxBudgetMin) > 0) ? Number(ctxBudgetMin) : (cfg.daily_study_minutes || 240);

    const date = todayLocal();

    // 2. 今日预算检查（管理员不受限；普通用户超预算只提醒不阻止，因为 api 是用户自己的）
    const usage = getTodayUsage(req.user.id, date);
    const usedIn = usage ? usage.tokens_in : 0;
    const usedOut = usage ? usage.tokens_out : 0;
    const budget = cfg.daily_token_budget || 100000;
    const isAdmin = req.user.isAdmin === true;
    let overBudget = !isAdmin && (usedIn + usedOut) >= budget;

    // 3. 意图分类（支持多选视角：ctx.projectIds 数组）
    const { intent, projectIdHint } = aiIntent.classify(userMessage, ctx);
    const projectIds = Array.isArray(ctx.projectIds) && ctx.projectIds.length
      ? ctx.projectIds.map(String)
      : (ctx.projectId ? [String(ctx.projectId)] : (projectIdHint ? [String(projectIdHint)] : []));
    const projectId = projectIds.length === 1 ? projectIds[0] : null;
    console.log(`[ai/chat] user=${req.user.id} admin=${isAdmin} provider=${cfg.provider} model=${cfg.model} intent=${intent} overBudget=${overBudget} budgetMin=${budgetMin} projectIds=${projectIds.join(',') || '全局'}`);

    // 4. 按意图取数聚合（多选时聚合多个项目）
    const dataSummary = gatherDataByIntent(req.user.id, intent, projectId, budgetMin, projectIds);

    // 超预算不阻止生成，只在最终回复中加一句提醒（api 是用户自己的，花用户自己的钱）

    // 5. 组 prompt
    let profileRow = db.prepare('SELECT profile_json, edited_fields_json FROM ai_profile WHERE user_id=?').get(req.user.id);
    let profile = null;
    let profileUpdated = false;
    if (profileRow && profileRow.profile_json) {
      try { profile = JSON.parse(profileRow.profile_json); } catch (_) { profile = null; }
    } else {
      // 首次：本地建一份画像
      profile = buildLocalProfile(req.user.id);
      upsertProfile(req.user.id, profile, []);
      profileUpdated = true;
    }
    // 长期记忆：用户关闭记忆开关时不读取，每次对话相当于全新开始（历史对话仍保留）
    const memories = (cfg.memory_enabled === 0)
      ? []
      : selectMemoriesForPrompt(req.user.id);

    const promptCtx = Object.assign({}, ctx, { budgetMin });
    // 历史近 10 轮（只存 user/assistant 正文；tool role 消息不入历史）
    const history = loadRecentMessages(req.user.id, body.conversationId, 10);

    // 加载一次 store，供工具 label 生成 + actions 校验复用
    const store = aggregator.loadStore(req.user.id);

    // 6. 解密 key（FC / 降级两种模式都要用）
    let apiKey;
    try { apiKey = aiCrypto.decrypt(cfg.encrypted_api_key, cfg.key_salt); }
    catch (e) { return failCode(res, 'API key似乎无效，请检查后重新输入', 'INVALID_KEY', 401); }
    const prov = aiProviders.getProvider(cfg.provider) || {};
    const llmCfg = { baseUrl: cfg.base_url, model: cfg.model, apiKey, docsUrl: prov.docsUrl };

    // 是否启用 function calling（老用户默认 1；模型不支持 tools 时自动置 0 降级全量注入）
    let useTools = (cfg.tools_enabled !== 0);
    let finalContent = '';
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    const trace = [];
    const searchReferences = []; // 收集 web_search 返回的来源 URL，用于前端渲染参考文献
    let degradedReason = null;
    const pendingMemories = []; // 本轮 save_memory 收集，待消息落库后关联 source_message_id 写入

    if (useTools) {
      // ── FC 模式：轻量 prompt + 工具循环（最多 5 轮 / 12 次调用）──
      const systemPrompt = aiPrompt.buildSystemPrompt(profile, memories, { enableTools: true });
      const userPrompt = aiPrompt.buildUserPrompt(intent, null, userMessage, promptCtx, { enableTools: true });
      const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userPrompt }];
      const dedupCache = new Map();
      let toolCallCount = 0;
      try {
        for (let round = 0; round < 5; round++) {
          const resp = await aiProxy.callLLM(llmCfg, messages, { tools: aiTools.TOOL_SCHEMAS, toolChoice: 'auto', maxTokens: 8000 });
          totalTokensIn += resp.usage.prompt_tokens;
          totalTokensOut += resp.usage.completion_tokens;

          if (!resp.toolCalls || resp.toolCalls.length === 0) {
            finalContent = resp.content || '';
            break;
          }
          // 推入带 tool_calls 的 assistant 消息（原样回传）
          messages.push(resp.message);

          for (const tc of resp.toolCalls) {
            toolCallCount++;
            if (toolCallCount > 12) {
              messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: '已达单次查询次数上限，本次查询跳过' }) });
              continue;
            }
            const cacheKey = tc.name + '|' + JSON.stringify(tc.args || {});
            let result;
            if (dedupCache.has(cacheKey)) {
              result = dedupCache.get(cacheKey);
            } else {
              const start = Date.now();
              const label = aiTools.getToolLabel(tc.name, tc.args, store);
              try {
                if (tc.name === 'save_memory') {
                  if (cfg.memory_enabled !== 0) {
                    const content = String(tc.args.content || '').trim().slice(0, 200);
                    const kind = ['preference', 'goal', 'fact'].includes(tc.args.kind) ? tc.args.kind : 'fact';
                    if (content) pendingMemories.push({ kind, content });
                  }
                  result = { ok: true };
                  trace.push({ seq: toolCallCount, name: tc.name, label, status: 'ok', durationMs: Date.now() - start });
                } else if (tc.name === 'web_search') {
                  // 异步联网搜索
                  const tavilySearch = require('../utils/tavilySearch');
                  result = await tavilySearch.search(tc.args.query, req.user.id, isAdmin);
                  trace.push({ seq: toolCallCount, name: tc.name, label, status: result.searched ? 'ok' : 'skipped', durationMs: Date.now() - start });
                  // 收集搜索结果引用（去重，按 URL；清洗乱码标题）
                  if (result.searched && Array.isArray(result.results)) {
                    result.results.forEach(function (r) {
                      if (r && r.url && !searchReferences.some(function (s) { return s.url === r.url; })) {
                        var cleanTitle = String(r.title || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s\-\—\:\：\(\)（）\[\]【】《》""''！!？?，,。.、；;]/g, '').trim();
                        if (!cleanTitle || cleanTitle.length < 2) cleanTitle = r.url;
                        searchReferences.push({ title: cleanTitle.slice(0, 80), url: r.url });
                      }
                    });
                  }
                } else if (tc.name === 'set_task_estimates') {
                  // 写入工具：AI 预估任务时长写回 store
                  result = aiTools.implSetTaskEstimates(req.user.id, tc.args);
                  trace.push({ seq: toolCallCount, name: tc.name, label, status: 'ok', durationMs: Date.now() - start });
                } else {
                  result = aiTools.executeReadonlyTool(tc.name, tc.args, req.user.id);
                  trace.push({ seq: toolCallCount, name: tc.name, label, status: 'ok', durationMs: Date.now() - start });
                }
              } catch (e2) {
                result = { error: '该数据暂时读不到' };
                trace.push({ seq: toolCallCount, name: tc.name, label, status: 'error', durationMs: Date.now() - start, error: '查询失败，已跳过' });
              }
              dedupCache.set(cacheKey, result);
            }
            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
          }

          if (toolCallCount > 12) {
            // 超硬上限：不带 tools 强制收尾，让模型基于已有信息回答
            const finalResp = await aiProxy.callLLM(llmCfg, messages, { maxTokens: 8000 });
            totalTokensIn += finalResp.usage.prompt_tokens;
            totalTokensOut += finalResp.usage.completion_tokens;
            finalContent = finalResp.content || '';
            break;
          }
        }
        // 跑满 5 轮仍没拿到正文（极端情况）：再补一次无 tools 调用收尾
        if (!finalContent) {
          const finalResp = await aiProxy.callLLM(llmCfg, messages, { maxTokens: 8000 });
          totalTokensIn += finalResp.usage.prompt_tokens;
          totalTokensOut += finalResp.usage.completion_tokens;
          finalContent = finalResp.content || '';
        }
      } catch (e) {
        // 模型不支持 tools（400 且报错含 tool/function/unknown parameter）→ 自动关开关，回退降级
        const bodyText = String(e.upstreamBody || '').toLowerCase();
        if (e.status === 400 && (bodyText.includes('tool') || bodyText.includes('function') || bodyText.includes('unknown parameter'))) {
          console.log(`[ai/chat] tools unsupported, auto-disable for user=${req.user.id}`);
          db.prepare("UPDATE ai_configs SET tools_enabled=0, updated_at=datetime('now') WHERE user_id=?").run(req.user.id);
          degradedReason = 'tools_unsupported';
          useTools = false;
          trace.length = 0; // 降级后不带 trace
          totalTokensIn = 0; totalTokensOut = 0;
        } else {
          // 其他 LLM 错误统一走原有失败分支（不计入用量）
          console.log(`[ai/chat] LLM failed code=${e.aiCode || '?'} status=${e.status || '?'}`);
          const extra = Object.assign({ note: '调用失败，本次不计入系统消耗统计' }, e.aiDetail ? { detail: e.aiDetail } : {});
          return failCode(res, e.aiMessage || 'AI服务暂时不可用，请稍后再试', e.aiCode || 'UPSTREAM_ERROR', e.status || 502, extra);
        }
      }
    }

    if (!useTools) {
      // ── 降级模式（含模型不支持 tools 自动回退）：全量数据注入，单次调用 ──
      const systemPrompt = aiPrompt.buildSystemPrompt(profile, memories);
      const userPrompt = aiPrompt.buildUserPrompt(intent, dataSummary, userMessage, promptCtx);
      const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userPrompt }];
      let llm;
      try {
        llm = await aiProxy.callLLM(llmCfg, messages, { maxTokens: 8000 });
      } catch (e) {
        console.log(`[ai/chat] LLM failed code=${e.aiCode || '?'} status=${e.status || '?'}`);
        const extra = Object.assign({ note: '调用失败，本次不计入系统消耗统计' }, e.aiDetail ? { detail: e.aiDetail } : {});
        return failCode(res, e.aiMessage || 'AI服务暂时不可用，请稍后再试', e.aiCode || 'UPSTREAM_ERROR', e.status || 502, extra);
      }
      totalTokensIn += llm.usage.prompt_tokens;
      totalTokensOut += llm.usage.completion_tokens;
      finalContent = llm.content || '';
    }
    console.log(`[ai/chat] done mode=${useTools ? 'fc' : 'degraded'} tokensIn=${totalTokensIn} tokensOut=${totalTokensOut} toolCalls=${trace.length} replyLen=${(finalContent || '').length}${degradedReason ? ' degraded=' + degradedReason : ''}`);

    // 7. 解析回复（正文 + actions）；actions 解析失败降级为纯文本，actions 空数组
    const { body: replyBody, actions: rawActions } = aiPrompt.parseReply(finalContent);
    const projects = storeProjects(req.user.id);
    const validActions = aiPrompt.filterValidActions(rawActions, projects);

    // 超预算提醒（普通用户，不阻止生成，只在回复末尾加一句）
    let finalReply = replyBody;
    if (overBudget && !isAdmin) {
      finalReply = replyBody + '\n\n> ⚠️ 今日 Token 用量已超过你设置的每日预算（' + budget + '），继续使用会产生额外费用，请注意控制。';
    }

    // 8. 落库 + 累计用量（仅成功后累计；多轮 token 已累加）
    const convId = await ensureConversation(req, body.conversationId, userMessage);
    await saveMessage(req.user.id, convId, 'user', userMessage, intent, null, 0, 0);
    const assistantMsgId = saveMessage(req.user.id, convId, 'assistant', replyBody, intent, validActions, totalTokensIn, totalTokensOut);
    // 本轮收集到的长期记忆：关联到本轮 assistant 消息，删除会话时可级联清理
    for (const m of pendingMemories) saveMemoryForUser(req.user.id, m.kind, m.content, assistantMsgId);
    bumpUsage(req.user.id, date, totalTokensIn, totalTokensOut);
    touchConversation(convId);

    return ok(res, {
      conversationId: convId,
      messageId: assistantMsgId,
      reply: finalReply,
      intent,
      actions: validActions,
      tokens: { in: totalTokensIn, out: totalTokensOut },
      profileUpdated,
      toolCalls: trace,
      searchReferences: searchReferences.length > 0 ? searchReferences : null,
      ...(degradedReason ? { degraded: degradedReason } : {}),
    });
  } catch (e) {
    console.error('POST /api/ai/chat error:', e.message);
    return fail(res, 'AI 服务暂不可用，请稍后重试', 502);
  }
});

/**
 * 流式对话：先执行工具调用（和 /chat 一样），然后最终回复用 SSE 流式输出（打字机效果）。
 * 前端用 fetch + ReadableStream 读取，逐字渲染。
 */
router.post('/chat/stream', async (req, res) => {
  // SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁用 Nginx 缓冲

  // 客户端断连检测：网络中断/关页面后停止打字机循环、不再写库，避免挂起与对死 socket 写入
  // （正常 end 后 req 也会触发 close，加 writableEnded 判断避免误标）
  let clientGone = false;
  req.on('close', () => { if (!res.writableEnded) clientGone = true; });

  // 心跳：工具调用阶段（可能连续多次 30s 上游请求）期间无任何字节输出，
  // Nginx/浏览器代理会因读超时而断开 SSE。每 10s 发一条 SSE 注释行（前端解析时自动忽略）。
  const beat = setInterval(() => {
    if (res.writableEnded || res.destroyed || clientGone) return;
    try { res.write(': ping\n\n'); } catch (_) { clientGone = true; }
  }, 10000);
  if (beat.unref) beat.unref();
  const stopBeat = () => clearInterval(beat);

  const sendSSE = (event, data) => {
    if (res.writableEnded || res.destroyed || clientGone) return false;
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch (_) { clientGone = true; return false; }
  };
  const sendError = (code, message) => {
    sendSSE('error', { code, message });
    try { if (!res.writableEnded && !res.destroyed) res.end(); } catch (_) {}
    stopBeat();
  };

  try {
    const body = req.body || {};
    const userMessage = String(body.message || '').trim();
    if (!userMessage) return sendError('EMPTY_INPUT', '请输入你的问题');
    const ctx = body.context || {};
    const ctxBudgetMin = ctx.budgetMin;

    const cfg = getConfigRow(req.user.id);
    if (!cfg || cfg.enabled !== 1 || !cfg.encrypted_api_key || !cfg.base_url || !cfg.provider || !cfg.model) {
      return sendError('NOT_CONFIGURED', '请先在AI设置中配置API key');
    }

    const budgetMin = (Number(ctxBudgetMin) > 0) ? Number(ctxBudgetMin) : (cfg.daily_study_minutes || 240);
    const date = todayLocal();
    const usage = getTodayUsage(req.user.id, date);
    const usedIn = usage ? usage.tokens_in : 0;
    const usedOut = usage ? usage.tokens_out : 0;
    const budget = cfg.daily_token_budget || 100000;
    const isAdmin = req.user.isAdmin === true;
    const overBudget = !isAdmin && (usedIn + usedOut) >= budget;

    const { intent, projectIdHint } = aiIntent.classify(userMessage, ctx);
    const projectIds = Array.isArray(ctx.projectIds) && ctx.projectIds.length
      ? ctx.projectIds.map(String)
      : (ctx.projectId ? [String(ctx.projectId)] : (projectIdHint ? [String(projectIdHint)] : []));
    const projectId = projectIds.length === 1 ? projectIds[0] : null;

    const dataSummary = gatherDataByIntent(req.user.id, intent, projectId, budgetMin, projectIds);

    // 超预算不阻止生成（api 是用户自己的），只在最终回复中加提醒

    let profileRow = db.prepare('SELECT profile_json, edited_fields_json FROM ai_profile WHERE user_id=?').get(req.user.id);
    let profile = null;
    let profileUpdated = false;
    if (profileRow && profileRow.profile_json) {
      try { profile = JSON.parse(profileRow.profile_json); } catch (_) { profile = null; }
    } else {
      profile = buildLocalProfile(req.user.id);
      upsertProfile(req.user.id, profile, []);
      profileUpdated = true;
    }
    const memories = (cfg.memory_enabled === 0)
      ? []
      : selectMemoriesForPrompt(req.user.id);

    // 静默预估：把长期记忆直接注入用户消息，且不进历史记录
    const isSilentEstimate = ctx.silentEstimate === true;
    let effectiveUserMessage = userMessage;
    if (isSilentEstimate && memories.length > 0) {
      const memText = memories.map(function (m) { return '- ' + (m.content || ''); }).join('\n');
      effectiveUserMessage = '【用户长期记忆】\n' + memText + '\n\n' + userMessage + '\n\n注意：如果长期记忆中用户明确规定了某项任务的时间或速度，必须严格听取用户的，不要自行估算。';
    }

    const promptCtx = Object.assign({}, ctx, { budgetMin });
    const history = loadRecentMessages(req.user.id, body.conversationId, 10);
    const store = aggregator.loadStore(req.user.id);

    let apiKey;
    try { apiKey = aiCrypto.decrypt(cfg.encrypted_api_key, cfg.key_salt); }
    catch (e) { return sendError('INVALID_KEY', 'API key似乎无效，请检查后重新输入'); }
    const prov = aiProviders.getProvider(cfg.provider) || {};
    const llmCfg = { baseUrl: cfg.base_url, model: cfg.model, apiKey, docsUrl: prov.docsUrl };

    const useTools = (cfg.tools_enabled !== 0);
    let finalContent = '';
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    const trace = [];
    const searchReferences = [];
    let degradedReason = null;
    const pendingMemories = []; // 本轮 save_memory 收集，待消息落库后关联 source_message_id 写入

    // ── 工具调用循环（和 /chat 完全一样）──
    if (useTools) {
      const systemPrompt = aiPrompt.buildSystemPrompt(profile, memories, { enableTools: true });
      const userPrompt = aiPrompt.buildUserPrompt(intent, null, effectiveUserMessage, promptCtx, { enableTools: true });
      const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userPrompt }];
      const dedupCache = new Map();
      let toolCallCount = 0;
      try {
        for (let round = 0; round < 5; round++) {
          const resp = await aiProxy.callLLM(llmCfg, messages, { tools: aiTools.TOOL_SCHEMAS, toolChoice: 'auto', maxTokens: 8000 });
          totalTokensIn += resp.usage.prompt_tokens;
          totalTokensOut += resp.usage.completion_tokens;
          if (!resp.toolCalls || resp.toolCalls.length === 0) {
            finalContent = resp.content || '';
            break;
          }
          messages.push(resp.message);
          for (const tc of resp.toolCalls) {
            toolCallCount++;
            if (toolCallCount > 12) {
              messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: '已达单次查询次数上限，本次查询跳过' }) });
              continue;
            }
            const cacheKey = tc.name + '|' + JSON.stringify(tc.args || {});
            let result;
            if (dedupCache.has(cacheKey)) {
              result = dedupCache.get(cacheKey);
            } else {
              const start = Date.now();
              const label = aiTools.getToolLabel(tc.name, tc.args, store);
              try {
                if (tc.name === 'save_memory') {
                  if (cfg.memory_enabled !== 0) {
                    const content = String(tc.args.content || '').trim().slice(0, 200);
                    const kind = ['preference', 'goal', 'fact'].includes(tc.args.kind) ? tc.args.kind : 'fact';
                    if (content) pendingMemories.push({ kind, content });
                  }
                  result = { ok: true };
                  trace.push({ seq: toolCallCount, name: tc.name, label, status: 'ok', durationMs: Date.now() - start });
                } else if (tc.name === 'web_search') {
                  const tavilySearch = require('../utils/tavilySearch');
                  result = await tavilySearch.search(tc.args.query, req.user.id, isAdmin);
                  trace.push({ seq: toolCallCount, name: tc.name, label, status: result.searched ? 'ok' : 'skipped', durationMs: Date.now() - start });
                  if (result.searched && Array.isArray(result.results)) {
                    result.results.forEach(function (r) {
                      if (r && r.url && !searchReferences.some(function (s) { return s.url === r.url; })) {
                        var cleanTitle = String(r.title || '').replace(/[^一-龥a-zA-Z0-9\s\-\—\:\：\(\)（）\[\]【】《》""''！!？?，,。.、；;]/g, '').trim();
                        if (!cleanTitle || cleanTitle.length < 2) cleanTitle = r.url;
                        searchReferences.push({ title: cleanTitle.slice(0, 80), url: r.url });
                      }
                    });
                  }
                } else if (tc.name === 'set_task_estimates') {
                  // 写入工具：AI 预估任务时长写回 store
                  result = aiTools.implSetTaskEstimates(req.user.id, tc.args);
                  trace.push({ seq: toolCallCount, name: tc.name, label, status: 'ok', durationMs: Date.now() - start });
                } else {
                  result = aiTools.executeReadonlyTool(tc.name, tc.args, req.user.id);
                  trace.push({ seq: toolCallCount, name: tc.name, label, status: 'ok', durationMs: Date.now() - start });
                }
              } catch (e2) {
                result = { error: '该数据暂时读不到' };
                trace.push({ seq: toolCallCount, name: tc.name, label, status: 'error', durationMs: Date.now() - start, error: '查询失败，已跳过' });
              }
              dedupCache.set(cacheKey, result);
            }
            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
          }
          if (toolCallCount > 12) {
            const finalResp = await aiProxy.callLLM(llmCfg, messages, { maxTokens: 8000 });
            totalTokensIn += finalResp.usage.prompt_tokens;
            totalTokensOut += finalResp.usage.completion_tokens;
            finalContent = finalResp.content || '';
            break;
          }
        }
        if (!finalContent) {
          const finalResp = await aiProxy.callLLM(llmCfg, messages, { maxTokens: 8000 });
          totalTokensIn += finalResp.usage.prompt_tokens;
          totalTokensOut += finalResp.usage.completion_tokens;
          finalContent = finalResp.content || '';
        }
      } catch (e) {
        if (e.kind === 'unauthorized') return sendError('INVALID_KEY', e.aiMessage || 'API key似乎无效');
        if (e.kind === 'insufficient_balance') return sendError('INSUFFICIENT_BALANCE', e.aiMessage || '余额不足');
        if (e.kind === 'rate_limited') return sendError('RATE_LIMITED', e.aiMessage || '问得太快啦');
        if (e.kind === 'timeout') return sendError('TIMEOUT', e.aiMessage || 'AI开小差了');
        degradedReason = 'tools_fallback';
        const systemPrompt = aiPrompt.buildSystemPrompt(profile, memories, { enableTools: false, data: dataSummary });
        const userPrompt = aiPrompt.buildUserPrompt(intent, dataSummary, effectiveUserMessage, promptCtx, { enableTools: false });
        const msgs = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userPrompt }];
        const fb = await aiProxy.callLLM(llmCfg, msgs, { maxTokens: 8000 });
        totalTokensIn += fb.usage.prompt_tokens;
        totalTokensOut += fb.usage.completion_tokens;
        finalContent = fb.content || '';
      }
    } else {
      const systemPrompt = aiPrompt.buildSystemPrompt(profile, memories, { enableTools: false, data: dataSummary });
      const userPrompt = aiPrompt.buildUserPrompt(intent, dataSummary, effectiveUserMessage, promptCtx, { enableTools: false });
      const msgs = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userPrompt }];
      const fb = await aiProxy.callLLM(llmCfg, msgs, { maxTokens: 8000 });
      totalTokensIn += fb.usage.prompt_tokens;
      totalTokensOut += fb.usage.completion_tokens;
      finalContent = fb.content || '';
    }

    // 通知前端：工具调用完成，开始流式输出正文
    sendSSE('meta', { toolCalls: trace, profileUpdated });

    // ── 流式输出最终回复 ──
    // 重新组一个不带 tools 的 messages（用 finalContent 作为 assistant 消息，让模型润色输出？不，直接流式输出 finalContent）
    // 为了简单可靠：直接把 finalContent 逐字推给前端（模拟打字机），不再次调用 LLM
    // 这样避免二次调用增加成本和延迟，且 finalContent 已经是完整回复
    const fullText = finalContent || '';
    const chunkSize = 3; // 每次推 3 个字，模拟打字机速度
    for (let i = 0; i < fullText.length; i += chunkSize) {
      if (clientGone) break; // 客户端已断开，停止推送
      const chunk = fullText.slice(i, i + chunkSize);
      sendSSE('delta', { text: chunk });
      await new Promise(r => setTimeout(r, 15)); // 15ms 间隔，约 200 字/秒
    }
    if (clientGone) { stopBeat(); return; } // 半截回复不再解析 actions/落库/发 done

    // 解析 actions
    const { body: replyBody, actions: rawActions } = aiPrompt.parseReply(fullText);
    const projects = storeProjects(req.user.id);
    const validActions = aiPrompt.filterValidActions(rawActions, projects);

    // 超预算提醒（普通用户，不阻止生成，只在回复末尾加一句）
    let finalReply = replyBody;
    if (overBudget && !isAdmin) {
      finalReply = replyBody + '\n\n> ⚠️ 今日 Token 用量已超过你设置的每日预算（' + budget + '），继续使用会产生额外费用，请注意控制。';
    }

    // 落库（静默预估不进历史记录）
    let convId = body.conversationId || null;
    let assistantMsgId = null;
    if (!isSilentEstimate) {
      convId = await ensureConversation(req, body.conversationId, userMessage);
      await saveMessage(req.user.id, convId, 'user', userMessage, intent, null, 0, 0);
      assistantMsgId = saveMessage(req.user.id, convId, 'assistant', finalReply, intent, validActions, totalTokensIn, totalTokensOut);
      touchConversation(convId);
    }
    // 本轮收集到的长期记忆：关联到本轮 assistant 消息（静默预估时 source_message_id 为 null）
    for (const m of pendingMemories) saveMemoryForUser(req.user.id, m.kind, m.content, assistantMsgId);
    bumpUsage(req.user.id, date, totalTokensIn, totalTokensOut);

    // 发送完成事件
    sendSSE('done', {
      conversationId: convId,
      messageId: assistantMsgId,
      reply: finalReply,
      intent,
      actions: validActions,
      tokens: { in: totalTokensIn, out: totalTokensOut },
      profileUpdated,
      toolCalls: trace,
      searchReferences: searchReferences.length > 0 ? searchReferences : null,
      ...(degradedReason ? { degraded: degradedReason } : {}),
    });
    stopBeat();
    res.end();
  } catch (e) {
    console.error('POST /api/ai/chat/stream error:', e.message);
    stopBeat();
    sendError('UPSTREAM_ERROR', 'AI 服务暂不可用，请稍后重试');
  }
});

// ── chat 内部助手 ──
function safeParse(s) {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch (_) { return []; }
}

async function ensureConversation(req, conversationId, firstMessage) {
  if (conversationId) {
    const conv = db.prepare('SELECT id FROM ai_conversations WHERE id=? AND user_id=?').get(conversationId, req.user.id);
    if (conv) return conv.id;
  }
  const title = String(firstMessage || '新对话').slice(0, 30);
  const info = db.prepare(
    "INSERT INTO ai_conversations (user_id, title, last_at, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'), datetime('now'))"
  ).run(req.user.id, title);
  return info.lastInsertRowid;
}

function touchConversation(convId) {
  db.prepare("UPDATE ai_conversations SET last_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(convId);
}

function saveMessage(userId, convId, role, content, intent, actionsJson, tokensIn, tokensOut) {
  const info = db.prepare(
    `INSERT INTO ai_messages (conversation_id, user_id, role, content, intent, actions_json, tokens_in, tokens_out, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(convId, userId, role, content, intent || null,
    actionsJson ? JSON.stringify(actionsJson) : null, tokensIn || 0, tokensOut || 0);
  return info.lastInsertRowid;
}

function loadRecentMessages(userId, conversationId, n) {
  if (!conversationId) return [];
  // IDOR 防护：会话必须属于当前用户，否则任何人传他人 conversationId 都能读历史
  const rows = db.prepare(
    `SELECT role, content FROM ai_messages
       WHERE conversation_id = ?
         AND conversation_id IN (SELECT id FROM ai_conversations WHERE user_id = ?)
         AND role IN ('user','assistant')
       ORDER BY id DESC LIMIT ?`
  ).all(conversationId, userId, n).reverse();
  // 只取正文（不带 actions 代码块历史，避免上下文膨胀）
  return rows.map((r) => ({ role: r.role, content: String(r.content || '').slice(0, 800) }));
}

// ══════════════ 建议应用与撤销 ══════════════════════════════════════════════

// POST /api/ai/apply — body {messageId, selected, storeSigBefore, storeSigAfter}
router.post('/apply', (req, res) => {
  try {
    const body = req.body || {};
    const messageId = Number(body.messageId);
    const selected = Array.isArray(body.selected) ? body.selected : [];
    if (!messageId) return fail(res, '缺少 messageId');

    const msg = db.prepare('SELECT id, conversation_id, actions_json FROM ai_messages WHERE id=? AND user_id=?')
      .get(messageId, req.user.id);
    if (!msg) return fail(res, '消息不存在', 404);

    // 逆操作 inverse 由前端在应用 action 时根据"修改前 store 状态"计算并随 selected 上报；
    // 后端只负责存储与回传，不要求 AI 生成 inverse。
    const inverse = selected.filter((a) => a && a.inverse).map((a) => a.inverse);
    const actionType = selected[0] && selected[0].op ? selected[0].op : 'batch';

    const info = db.prepare(
      `INSERT INTO ai_action_logs
       (user_id, conversation_id, message_id, action_type, actions_json, selected_json, inverse_json,
        store_sig_before, store_sig_after, status, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', datetime('now'))`
    ).run(req.user.id, msg.conversation_id, messageId, actionType,
      msg.actions_json || null, JSON.stringify(selected), JSON.stringify(inverse),
      body.storeSigBefore || null, body.storeSigAfter || null);

    return ok(res, { actionLogId: info.lastInsertRowid, inverse });
  } catch (e) {
    console.error('POST /api/ai/apply error:', e.message);
    return fail(res, '记录应用失败', 500);
  }
});

// POST /api/ai/undo — body {actionLogId}
router.post('/undo', (req, res) => {
  try {
    const actionLogId = Number(req.body && req.body.actionLogId);
    if (!actionLogId) return fail(res, '缺少 actionLogId');
    const log = db.prepare('SELECT * FROM ai_action_logs WHERE id=? AND user_id=?').get(actionLogId, req.user.id);
    if (!log) return fail(res, '撤销记录不存在', 404);
    if (log.status !== 'applied') return fail(res, '该记录已是撤销状态', 400);

    let inverse = [];
    try { inverse = JSON.parse(log.inverse_json || '[]'); } catch (_) { inverse = []; }

    db.prepare("UPDATE ai_action_logs SET status='undone', undone_at=datetime('now') WHERE id=?").run(actionLogId);
    return ok(res, { actionLogId, inverse });
  } catch (e) {
    console.error('POST /api/ai/undo error:', e.message);
    return fail(res, '撤销失败', 500);
  }
});

// GET /api/ai/actions?status=applied — 撤销历史
router.get('/actions', (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    let rows;
    if (status) {
      rows = db.prepare(
        'SELECT id, action_type, actions_json, status, applied_at, undone_at, conversation_id, message_id FROM ai_action_logs WHERE user_id=? AND status=? ORDER BY id DESC LIMIT 50'
      ).all(req.user.id, status);
    } else {
      rows = db.prepare(
        'SELECT id, action_type, actions_json, status, applied_at, undone_at, conversation_id, message_id FROM ai_action_logs WHERE user_id=? ORDER BY id DESC LIMIT 50'
      ).all(req.user.id);
    }
    rows = rows.map((r) => ({
      id: r.id, actionType: r.action_type, status: r.status,
      appliedAt: r.applied_at, undoneAt: r.undone_at,
      actions: safeParse(r.actions_json),
    }));
    return ok(res, { actions: rows });
  } catch (e) {
    console.error('GET /api/ai/actions error:', e.message);
    return fail(res, '服务器开小差了', 500);
  }
});

// ══════════════ 画像接口 ═══════════════════════════════════════════════════

// 画像可编辑白名单字段
const PROFILE_EDITABLE = ['subjects', 'notes', 'preferences', 'targetScoreTier', 'habit'];

// GET /api/ai/profile
router.get('/profile', (req, res) => {
  try {
    const row = db.prepare('SELECT profile_json, edited_fields_json FROM ai_profile WHERE user_id=?').get(req.user.id);
    let profile = {};
    let editedFields = [];
    if (row) {
      try { profile = JSON.parse(row.profile_json || '{}'); } catch (_) { profile = {}; }
      try { editedFields = JSON.parse(row.edited_fields_json || '[]'); } catch (_) { editedFields = []; }
    }
    return ok(res, { profile, editedFields });
  } catch (e) {
    console.error('GET /api/ai/profile error:', e.message);
    return fail(res, '服务器开小差了', 500);
  }
});

// PUT /api/ai/profile — body {profile:{...}, editedFields:[...]}
router.put('/profile', (req, res) => {
  try {
    const incoming = (req.body && req.body.profile) || {};
    const editedFields = Array.isArray(req.body && req.body.editedFields) ? req.body.editedFields : [];
    // 取现有画像
    const row = db.prepare('SELECT profile_json FROM ai_profile WHERE user_id=?').get(req.user.id);
    let current = {};
    if (row && row.profile_json) { try { current = JSON.parse(row.profile_json); } catch (_) { current = {}; } }
    // 只允许白名单字段覆盖
    for (const k of PROFILE_EDITABLE) {
      if (incoming[k] !== undefined) current[k] = incoming[k];
    }
    upsertProfile(req.user.id, current, editedFields);
    return ok(res, { profile: current, editedFields });
  } catch (e) {
    console.error('PUT /api/ai/profile error:', e.message);
    return fail(res, '保存画像失败', 500);
  }
});

// POST /api/ai/profile/refresh — 强制重跑本地画像
router.post('/profile/refresh', (req, res) => {
  try {
    const profile = buildLocalProfile(req.user.id);
    // 保留用户手改字段
    const row = db.prepare('SELECT profile_json, edited_fields_json FROM ai_profile WHERE user_id=?').get(req.user.id);
    let editedFields = [];
    if (row) {
      try { editedFields = JSON.parse(row.edited_fields_json || '[]'); } catch (_) { editedFields = []; }
      try {
        const old = JSON.parse(row.profile_json || '{}');
        for (const k of editedFields) if (old[k] !== undefined) profile[k] = old[k];
      } catch (_) {}
    }
    upsertProfile(req.user.id, profile, editedFields);
    return ok(res, { profile, editedFields });
  } catch (e) {
    console.error('POST /api/ai/profile/refresh error:', e.message);
    return fail(res, '刷新画像失败', 500);
  }
});

// ══════════════ L0 本地轻量查询（零 token）═════════════════════════════════

// GET /api/ai/summary?projectId=
router.get('/summary', (req, res) => {
  try {
    const projectId = req.query.projectId ? String(req.query.projectId) : null;
    if (!projectId) return ok(res, { overview: aggregator.getUserProfileSummary(req.user.id) });
    return ok(res, aggregator.getProgressSummary(req.user.id, projectId));
  } catch (e) {
    console.error('GET /api/ai/summary error:', e.message);
    return fail(res, '服务器开小差了', 500);
  }
});

// GET /api/ai/mistake-report?projectId=（不传则全局视角）
router.get('/mistake-report', (req, res) => {
  try {
    const projectId = req.query.projectId ? String(req.query.projectId) : null;
    return ok(res, aggregator.getMistakeReport(req.user.id, projectId));
  } catch (e) {
    console.error('GET /api/ai/mistake-report error:', e.message);
    return fail(res, '服务器开小差了', 500);
  }
});

// GET /api/ai/paper-trend?projectId=
router.get('/paper-trend', (req, res) => {
  try {
    const projectId = req.query.projectId ? String(req.query.projectId) : null;
    if (!projectId) return fail(res, '请提供 projectId');
    return ok(res, aggregator.getPaperTrend(req.user.id, projectId));
  } catch (e) {
    console.error('GET /api/ai/paper-trend error:', e.message);
    return fail(res, '服务器开小差了', 500);
  }
});

// GET /api/ai/balance
router.get('/balance', (req, res) => {
  try {
    return ok(res, aggregator.getMultiSubjectBalance(req.user.id));
  } catch (e) {
    console.error('GET /api/ai/balance error:', e.message);
    return fail(res, '服务器开小差了', 500);
  }
});

// GET /api/ai/today-plan?budgetMin=（不传/0/空 → 全天上限 720，由聚合层兜底）
router.get('/today-plan', (req, res) => {
  try {
    const q = req.query.budgetMin;
    const budgetMin = (q != null && String(q).trim() !== '') ? Number(q) : undefined;
    return ok(res, aggregator.getTodayPlan(req.user.id, budgetMin));
  } catch (e) {
    console.error('GET /api/ai/today-plan error:', e.message);
    return fail(res, '服务器开小差了', 500);
  }
});

// ══════════════ Token 用量 ══════════════════════════════════════════════════

// GET /api/ai/usage — 今日 + 累计
router.get('/usage', (req, res) => {
  try {
    const date = todayLocal();
    const today = getTodayUsage(req.user.id, date) || { tokens_in: 0, tokens_out: 0, calls: 0 };
    const total = db.prepare(
      'SELECT COALESCE(SUM(tokens_in),0) tin, COALESCE(SUM(tokens_out),0) tout, COALESCE(SUM(calls),0) calls FROM ai_usage_daily WHERE user_id=?'
    ).get(req.user.id);
    const cfg = getConfigRow(req.user.id);
    const budget = cfg ? cfg.daily_token_budget : 100000;
    const todayTok = { tokensIn: today.tokens_in || 0, tokensOut: today.tokens_out || 0, calls: today.calls || 0 };
    let totalTok = { tokensIn: total.tin || 0, tokensOut: total.tout || 0, calls: total.calls || 0 };
    // 不变量保护：累计 = 所有日期之和，必然 >= 今日；若历史数据/时区漂移导致倒挂，以累计为准兜底
    if (totalTok.tokensIn < todayTok.tokensIn) totalTok.tokensIn = todayTok.tokensIn;
    if (totalTok.tokensOut < todayTok.tokensOut) totalTok.tokensOut = todayTok.tokensOut;
    if (totalTok.calls < todayTok.calls) totalTok.calls = todayTok.calls;
    return ok(res, {
      today: todayTok,
      total: totalTok,
      dailyBudget: budget,
      note: '消耗为系统估算值，真实扣费以服务商账单为准；调用失败不计入系统消耗统计',
    });
  } catch (e) {
    console.error('GET /api/ai/usage error:', e.message);
    return fail(res, '服务器开小差了', 500);
  }
});

module.exports = router;
