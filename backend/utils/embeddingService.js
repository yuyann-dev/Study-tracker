/**
 * utils/embeddingService.js — 深度学习 Embedding 服务
 *
 * 支持 OpenAI 兼容的 /embeddings 接口（智谱、通义千问、OpenAI 等）。
 * 优先使用用户配置的 AI 提供商的 embedding（如果支持），
 * 否则降级为 TF-IDF（在 knowledgeSearch.js 中处理）。
 *
 * 设计原则：
 * - 异步向量化，不阻塞主流程
 * - 批量处理，减少 API 调用
 * - 失败降级，不影响检索功能
 * - 缓存结果，避免重复计算
 */

const https = require('https');
const http = require('http');

// 支持 embedding 的提供商及其默认模型
const EMBEDDING_MODELS = {
  zhipu: 'embedding-3',
  qwen: 'text-embedding-v3',
  openai: 'text-embedding-3-small',
  moonshot: 'text-embedding-v1', // Moonshot 支持 embedding
};

// 提供商的 baseURL（与 aiProviders.js 保持一致）
const PROVIDER_BASE_URLS = {
  deepseek: 'https://api.deepseek.com/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  openai: 'https://api.openai.com/v1',
  moonshot: 'https://api.mershot.cn/v1',
};

/**
 * 检查提供商是否支持 embedding
 */
function supportsEmbedding(provider) {
  return !!EMBEDDING_MODELS[provider];
}

/**
 * 获取 embedding 配置
 * 优先使用用户配置的 AI 提供商（如果支持 embedding），
 * 否则检查是否配置了单独的 embedding 提供商。
 */
function getEmbeddingConfig(aiConfig) {
  if (!aiConfig) return null;

  // 1. 优先用用户当前的 AI 提供商
  const currentProvider = aiConfig.provider;
  if (currentProvider && supportsEmbedding(currentProvider) && aiConfig.apiKey) {
    return {
      provider: currentProvider,
      baseUrl: PROVIDER_BASE_URLS[currentProvider],
      model: EMBEDDING_MODELS[currentProvider],
      apiKey: aiConfig.apiKey,
    };
  }

  // 2. 检查是否配置了单独的 embedding 提供商（环境变量）
  if (process.env.EMBEDDING_PROVIDER && process.env.EMBEDDING_API_KEY) {
    const prov = process.env.EMBEDDING_PROVIDER;
    if (supportsEmbedding(prov)) {
      return {
        provider: prov,
        baseUrl: PROVIDER_BASE_URLS[prov],
        model: process.env.EMBEDDING_MODEL || EMBEDDING_MODELS[prov],
        apiKey: process.env.EMBEDDING_API_KEY,
      };
    }
  }

  return null;
}

/**
 * 调用 embedding API（支持批量）
 * @param {string[]} texts - 文本数组
 * @param {object} config - embedding 配置
 * @returns {Promise<number[][]>} - 向量数组
 */
function createEmbeddings(texts, config) {
  return new Promise((resolve, reject) => {
    if (!config) {
      return reject(new Error('No embedding config available'));
    }

    const body = JSON.stringify({
      model: config.model,
      input: texts,
    });

    const url = new URL(config.baseUrl + '/embeddings');
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.error) {
            return reject(new Error('Embedding API error: ' + result.error.message));
          }
          if (!result.data || !Array.isArray(result.data)) {
            return reject(new Error('Invalid embedding response format'));
          }
          // 按 index 排序，确保顺序正确
          const sorted = result.data.sort((a, b) => a.index - b.index);
          const vectors = sorted.map((item) => item.embedding);
          resolve(vectors);
        } catch (e) {
          reject(new Error('Failed to parse embedding response: ' + e.message));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Embedding request timeout'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * 余弦相似度计算
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 单条文本向量化（带缓存）
 */
const embeddingCache = new Map();

async function embedText(text, config) {
  const cacheKey = text.slice(0, 100) + '|' + (config ? config.model : 'tfidf');
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey);
  }

  if (!config) {
    throw new Error('No embedding config');
  }

  const vectors = await createEmbeddings([text], config);
  const vec = vectors[0];
  embeddingCache.set(cacheKey, vec);
  return vec;
}

/**
 * 批量向量化（自动分批，每批最多 64 条）
 */
async function embedBatch(texts, config) {
  if (!config) throw new Error('No embedding config');

  const results = new Array(texts.length);
  const batchSize = 64;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vectors = await createEmbeddings(batch, config);
    for (let j = 0; j < vectors.length; j++) {
      results[i + j] = vectors[j];
    }
  }

  return results;
}

module.exports = {
  supportsEmbedding,
  getEmbeddingConfig,
  createEmbeddings,
  cosineSimilarity,
  embedText,
  embedBatch,
  EMBEDDING_MODELS,
};
