/**
 * utils/tavilySearch.js — Tavily 联网搜索工具
 *
 * 功能：
 *   - 调用 Tavily Search API 获取联网搜索结果
 *   - SQLite 缓存：相同关键词 24 小时内不重复调用
 *   - 用户限额：10 次/天，3 次/分钟
 *   - 全局限额：800 次/月（留 200 次余量）
 *   - 超时 5 秒自动降级
 *   - 结果清洗：只取前 5 条的标题+摘要+URL
 *
 * 安全：
 *   - API Key 从环境变量 TAVILY_API_KEY 读取，不硬编码
 *   - 搜索关键词做长度限制（最多 200 字符）
 *   - 任何异常都吞掉，返回 {searched:false, reason}，不影响主对话
 */

const db = require('../database');

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';
const SEARCH_TIMEOUT_MS = 5000;
const MAX_RESULTS = 8;
const CACHE_TTL_HOURS = 24;
const USER_DAILY_LIMIT = 10;
const USER_MINUTE_LIMIT = 3;
const GLOBAL_MONTHLY_LIMIT = 800;

// 确保表存在（启动时调用一次即可，幂等）
function initTables() {
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ai_search_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        results TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_search_cache_query ON ai_search_cache(query)
    `).run();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ai_search_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        query TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_search_usage_user ON ai_search_usage(user_id, created_at)
    `).run();
  } catch (e) {
    console.error('[tavilySearch] initTables failed:', e.message);
  }
}

// 检查用户限额
function checkUserLimit(userId) {
  try {
    // 每分钟限额
    const minuteCount = db.prepare(`
      SELECT COUNT(*) AS c FROM ai_search_usage
      WHERE user_id = ? AND created_at >= datetime('now', '-1 minute')
    `).get(userId).c;
    if (minuteCount >= USER_MINUTE_LIMIT) {
      return { allowed: false, reason: '搜索太频繁了，稍等一下再试' };
    }
    // 每天限额
    const dayCount = db.prepare(`
      SELECT COUNT(*) AS c FROM ai_search_usage
      WHERE user_id = ? AND created_at >= datetime('now', 'start of day')
    `).get(userId).c;
    if (dayCount >= USER_DAILY_LIMIT) {
      return { allowed: false, reason: '今天搜索次数用完了，明天再来吧' };
    }
    // 全局每月限额
    const monthCount = db.prepare(`
      SELECT COUNT(*) AS c FROM ai_search_usage
      WHERE created_at >= datetime('now', 'start of month')
    `).get().c;
    if (monthCount >= GLOBAL_MONTHLY_LIMIT) {
      return { allowed: false, reason: '本月搜索额度用完了' };
    }
    return { allowed: true };
  } catch (e) {
    console.error('[tavilySearch] checkUserLimit failed:', e.message);
    return { allowed: true }; // 限额检查失败时放行，不阻塞用户
  }
}

// 记录搜索使用
function recordUsage(userId, query) {
  try {
    db.prepare('INSERT INTO ai_search_usage (user_id, query) VALUES (?, ?)').run(userId, query);
  } catch (e) {
    console.error('[tavilySearch] recordUsage failed:', e.message);
  }
}

// 查缓存
function getCached(query) {
  try {
    const row = db.prepare(`
      SELECT results FROM ai_search_cache
      WHERE query = ? AND created_at >= datetime('now', ?)
    `).get(query, `-${CACHE_TTL_HOURS} hours`);
    if (row) {
      return JSON.parse(row.results);
    }
    return null;
  } catch (e) {
    return null;
  }
}

// 写缓存
function setCache(query, results) {
  try {
    // 先删旧缓存
    db.prepare('DELETE FROM ai_search_cache WHERE query = ?').run(query);
    db.prepare('INSERT INTO ai_search_cache (query, results) VALUES (?, ?)').run(query, JSON.stringify(results));
  } catch (e) {
    console.error('[tavilySearch] setCache failed:', e.message);
  }
}

// 调用 Tavily API
async function callTavily(query) {
  if (!TAVILY_API_KEY) {
    return { searched: false, reason: '搜索服务未配置' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query: query,
        search_depth: 'basic', // basic 更快更省，advanced 更全但更贵
        max_results: MAX_RESULTS,
        include_answer: true, // 让 Tavily 返回 AI 生成的摘要答案，减少下游 token
        include_raw_content: false,
        language: 'zh-CN', // 中文优化，提升中文搜索结果相关性
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[tavilySearch] API error ${resp.status}: ${text.slice(0, 200)}`);
      return { searched: false, reason: `搜索服务返回 ${resp.status}` };
    }

    const data = await resp.json();
    const results = (data.results || []).slice(0, MAX_RESULTS).map(r => ({
      title: (r.title || '').slice(0, 200),
      url: r.url || '',
      content: (r.content || '').slice(0, 500),
    }));

    return {
      searched: true,
      query: query,
      answer: data.answer ? String(data.answer).slice(0, 800) : null, // Tavily AI 生成的摘要
      results: results,
      resultCount: results.length,
    };
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') {
      return { searched: false, reason: '搜索超时了' };
    }
    console.error('[tavilySearch] callTavily failed:', e.message);
    return { searched: false, reason: '搜索服务暂时不可用' };
  }
}

/**
 * 执行搜索（对外主入口）
 * @param {string} query 搜索关键词
 * @param {number} userId 用户ID
 * @returns {Promise<object>} 搜索结果
 */
async function search(query, userId) {
  query = String(query || '').trim().slice(0, 200);
  if (!query) {
    return { searched: false, reason: '搜索关键词为空' };
  }

  // 1. 查缓存
  const cached = getCached(query);
  if (cached) {
    return { ...cached, cached: true };
  }

  // 2. 检查限额
  const limitCheck = checkUserLimit(userId);
  if (!limitCheck.allowed) {
    return { searched: false, reason: limitCheck.reason };
  }

  // 3. 调用 API
  const result = await callTavily(query);

  // 4. 成功则记录使用和缓存
  if (result.searched) {
    recordUsage(userId, query);
    setCache(query, result);
  }

  return result;
}

module.exports = { search, initTables };
