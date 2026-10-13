/**
 * utils/knowledgeSearch.js — 考研大纲知识库混合检索引擎
 *
 * 采用 TF-IDF 关键词匹配 + 深度学习 Embedding 语义相似度的混合检索：
 *   - TF-IDF：精确匹配关键词、术语、标题
 *   - Embedding：语义理解，同义词/近义词/相关概念能匹配上
 *   - 混合排序：final = embedding_sim * 0.6 + tfidf_score * 0.4
 *
 * 降级策略：如果 embedding 服务不可用（用户用 deepseek 且未配置单独的 embedding 服务），
 * 自动降级为纯 TF-IDF 检索，功能不受影响。
 *
 * 数据结构：
 *   knowledge_chunks 表：每条 = 一个大纲章节/知识点分块
 *   - id, subject, chapter, title, content, keywords, difficulty, source,
 *     embedding(JSON数组), embed_model, created_at
 */

const db = require('../database');
const embeddingService = require('./embeddingService');

// ── 同义词表（考研常见术语，提升召回）──────────────────────────────────
const SYNONYMS = {
  // 数学
  '高数': ['高等数学', '微积分', '数学分析'],
  '线代': ['线性代数', '矩阵'],
  '概率': ['概率论', '数理统计', '概率统计'],
  '极限': ['lim', '极限论', '求极限'],
  '导数': ['微分', '求导', '导函数'],
  '积分': ['不定积分', '定积分', '微积分', '积分学'],
  '二重积分': ['重积分', '多元积分'],
  '微分方程': ['ODE', '常微分方程', '微分方程式'],
  '矩阵': ['方阵', '矩阵论', '矩阵运算'],
  '特征值': ['特征向量', 'eigenvalue', '特征多项式'],
  '二次型': ['quadratic form', '标准形'],
  '行列式': ['determinant', 'det'],
  '向量': ['vector', '向量组', '线性相关'],
  '秩': ['rank', '矩阵的秩'],
  '级数': ['无穷级数', '级数收敛'],
  '多元函数': ['多元微积分', '偏导数', '全微分'],
  // 408 - 数据结构
  '数据结构': ['DS', '算法与数据结构'],
  '二叉树': ['binary tree', '树结构'],
  '图': ['graph', '图论', '图结构'],
  '排序': ['sort', '排序算法', '快速排序', '归并排序', '堆排序'],
  '查找': ['search', '搜索', '二分查找', '哈希查找'],
  '链表': ['linked list', '单链表', '双链表'],
  '栈': ['stack', '队列', 'queue'],
  '哈希': ['hash', '散列', '哈希表'],
  '算法': ['algorithm', '时间复杂度', '空间复杂度'],
  // 408 - 计组
  '计组': ['计算机组成原理', '组成原理', '计算机组织'],
  'CPU': ['处理器', '中央处理器', '运算器', '控制器'],
  '存储器': ['内存', '主存', 'cache', '高速缓存', '存储系统'],
  '指令系统': ['指令集', '指令格式', '寻址方式'],
  '总线': ['bus', '系统总线', 'IO总线'],
  '流水线': ['pipeline', '指令流水线'],
  '中断': ['interrupt', '中断系统', '异常'],
  // 408 - 操作系统
  '操作系统': ['OS', 'os'],
  '进程': ['process', '任务', '进程管理'],
  '线程': ['thread', '线程管理'],
  '死锁': ['deadlock', '死锁预防', '死锁避免'],
  '内存管理': ['存储管理', '虚拟内存', '分页', '分段', '页表'],
  '调度': ['scheduling', '进程调度', '作业调度', '调度算法'],
  '文件系统': ['文件管理', 'inode', '目录'],
  'IO': ['输入输出', '设备管理', 'IO管理', '磁盘调度'],
  '同步': ['synchronization', '互斥', '信号量', 'PV操作'],
  // 408 - 计网
  '计网': ['计算机网络', '网络', '计算机通信网'],
  'TCP': ['传输控制协议', 'tcp', '拥塞控制', '流量控制'],
  'IP': ['网际协议', 'internet protocol', 'ip地址', '子网'],
  'HTTP': ['超文本传输协议', 'http', 'https'],
  'DNS': ['域名系统', '域名解析'],
  '路由': ['router', '路由协议', '路由选择'],
  'UDP': ['用户数据报协议', 'udp'],
  '物理层': ['physical layer', '编码', '调制'],
  '数据链路层': ['link layer', '以太网', 'MAC', 'CRC'],
  // 英语
  '英一': ['英语一', '英语1'],
  '英二': ['英语二', '英语2'],
  '完形': ['完形填空', 'cloze'],
  '阅读': ['阅读理解', 'reading', '阅读part a'],
  '新题型': ['阅读part b', '七选五', '排序题'],
  '翻译': ['translation', '英译汉'],
  '作文': ['写作', 'writing', '小作文', '大作文'],
  // 政治
  '政治': ['思想政治理论', '考研政治'],
  '马原': ['马克思主义基本原理', '马克思主义哲学', '政治经济学'],
  '毛中特': ['毛泽东思想', '中国特色社会主义', '习概'],
  '史纲': ['中国近现代史纲要', '近现代史'],
  '思修': ['思想道德与法治', '思想道德修养'],
  '时政': ['形势与政策', '当代世界经济'],
  // 其他
  '数一': ['数学一', '数学1'],
  '数二': ['数学二', '数学2'],
  '408': ['计算机学科专业基础', '计算机统考'],
  '信号与系统': ['信号系统', '843', '中科大843'],
  '傅里叶': ['fourier', '傅里叶变换', '傅里叶级数'],
  '拉普拉斯': ['laplace', '拉普拉斯变换'],
  'z变换': ['z-transform', '离散傅里叶'],
};

// ── 中文分词（简易版：按常见词+单字混合）──────────────────────────────
const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '那', '它', '他', '她', '们', '这个', '那个', '什么', '怎么',
  '可以', '能够', '应该', '需要', '进行', '通过', '使用', '利用', '以及', '或者',
  '与', '及', '等', '中', '内', '外', '前', '后', '左', '右', '上', '下',
  '考试', '考查', '要求', '理解', '掌握', '了解', '会', '能', '能够',
  '内容', '部分', '方面', '相关', '相应', '一定', '一些', '不同', '各种',
]);

/**
 * 简易中文分词：
 * 1. 先匹配同义词表中的词
 * 2. 再按 2-gram 切分
 * 3. 最后单字
 * 去掉停用词和标点。
 */
function tokenize(text) {
  if (!text) return [];
  let s = String(text).toLowerCase();
  s = s.replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ');
  const tokens = [];
  const words = s.split(/\s+/).filter(Boolean);

  for (const w of words) {
    if (/^[a-z0-9]+$/.test(w)) {
      if (!STOP_WORDS.has(w) && w.length > 1) tokens.push(w);
      continue;
    }
    let matched = false;
    for (const key of Object.keys(SYNONYMS)) {
      if (w.includes(key)) {
        tokens.push(key);
        for (const syn of SYNONYMS[key]) {
          if (syn.length <= 4) tokens.push(syn.toLowerCase());
        }
        matched = true;
      }
    }
    if (w.length >= 2) {
      for (let i = 0; i < w.length - 1; i++) {
        const bi = w.slice(i, i + 2);
        if (!STOP_WORDS.has(bi)) tokens.push(bi);
      }
    }
    for (const ch of w) {
      if (!STOP_WORDS.has(ch) && /[\u4e00-\u9fa5]/.test(ch)) {
        tokens.push(ch);
      }
    }
  }
  return tokens;
}

// ── TF-IDF 向量化 ──────────────────────────────────────────────────────

function computeDF(chunks) {
  const df = {};
  for (const chunk of chunks) {
    const tokens = new Set(tokenize(chunk.text));
    for (const t of tokens) {
      df[t] = (df[t] || 0) + 1;
    }
  }
  return df;
}

function computeTF(tokens) {
  const tf = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  const total = tokens.length || 1;
  for (const k of Object.keys(tf)) {
    tf[k] = tf[k] / total;
  }
  return tf;
}

function vectorize(text, df, totalDocs) {
  const tokens = tokenize(text);
  const tf = computeTF(tokens);
  const vec = {};
  for (const [term, freq] of Object.entries(tf)) {
    const docFreq = df[term] || 0;
    const idf = Math.log((totalDocs + 1) / (docFreq + 1)) + 1;
    vec[term] = freq * idf;
  }
  return vec;
}

function cosineSimilaritySparse(v1, v2) {
  let dot = 0, norm1 = 0, norm2 = 0;
  for (const [k, w] of Object.entries(v1)) {
    norm1 += w * w;
    if (v2[k]) dot += w * v2[k];
  }
  for (const w of Object.values(v2)) {
    norm2 += w * w;
  }
  if (norm1 === 0 || norm2 === 0) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// ── Embedding 相关 ─────────────────────────────────────────────────────

/**
 * 检查是否有可用的 embedding 服务
 * 需要从 ai_configs 表读取用户配置（这里用全局配置，因为知识库是全局的）
 */
let _embeddingConfigCache = null;
let _embeddingConfigTime = 0;

function getEmbeddingConfig() {
  // 缓存 60 秒，避免每次检索都查数据库
  if (_embeddingConfigCache && Date.now() - _embeddingConfigTime < 60000) {
    return _embeddingConfigCache;
  }
  try {
    // 优先使用环境变量中的独立 embedding 配置（deepseek 用户可单独配置智谱/通义的 embedding）
    const envProvider = process.env.EMBEDDING_PROVIDER;
    const envApiKey = process.env.EMBEDDING_API_KEY;
    if (envProvider && envApiKey) {
      const config = embeddingService.getEmbeddingConfig({
        provider: envProvider,
        apiKey: envApiKey,
      });
      if (config) {
        _embeddingConfigCache = config;
        _embeddingConfigTime = Date.now();
        return config;
      }
    }

    // 否则读取用户的 AI 配置（如果主模型支持 embedding 则直接用）
    const row = db.prepare(`
      SELECT provider, encrypted_api_key, key_salt
      FROM ai_configs
      WHERE encrypted_api_key IS NOT NULL AND encrypted_api_key != ''
      LIMIT 1
    `).get();
    if (!row) {
      _embeddingConfigCache = null;
      return null;
    }
    const aiCrypto = require('./aiCrypto');
    const apiKey = aiCrypto.decrypt(row.encrypted_api_key, row.key_salt);
    const config = embeddingService.getEmbeddingConfig({
      provider: row.provider,
      apiKey: apiKey,
    });
    _embeddingConfigCache = config;
    _embeddingConfigTime = Date.now();
    return config;
  } catch (e) {
    _embeddingConfigCache = null;
    return null;
  }
}

/**
 * 解析数据库中存储的 embedding 向量（JSON 字符串）
 */
function parseEmbedding(embeddingStr) {
  if (!embeddingStr) return null;
  try {
    return JSON.parse(embeddingStr);
  } catch (e) {
    return null;
  }
}

/**
 * 异步向量化知识库中所有未向量化的 chunk
 * 由 seedKnowledge.js 或管理接口调用
 */
async function vectorizeAllChunks() {
  const config = getEmbeddingConfig();
  if (!config) {
    console.log('[embedding] 无可用 embedding 服务，跳过向量化（使用 TF-IDF 模式）');
    return { vectorized: 0, skipped: true };
  }

  const rows = db.prepare('SELECT id, title, chapter, content, keywords FROM knowledge_chunks WHERE embedding IS NULL OR embedding = ""').all();
  if (rows.length === 0) {
    console.log('[embedding] 所有 chunk 已向量化');
    return { vectorized: 0, total: 0 };
  }

  console.log(`[embedding] 开始向量化 ${rows.length} 条，使用模型: ${config.model}`);
  const updateStmt = db.prepare('UPDATE knowledge_chunks SET embedding = ?, embed_model = ? WHERE id = ?');

  let vectorized = 0;
  const batchSize = 32;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const texts = batch.map(r => `${r.title} ${r.chapter} ${r.content} ${r.keywords || ''}`.slice(0, 2000));
    try {
      const vectors = await embeddingService.embedBatch(texts, config);
      const tx = db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          updateStmt.run(JSON.stringify(vectors[j]), config.model, batch[j].id);
        }
      });
      tx();
      vectorized += batch.length;
      console.log(`[embedding] 已向量化 ${vectorized}/${rows.length}`);
    } catch (e) {
      console.error(`[embedding] 批次向量化失败: ${e.message}`);
      // 失败不中断，继续下一批
    }
  }

  console.log(`[embedding] 向量化完成，共 ${vectorized} 条`);
  return { vectorized, total: rows.length };
}

// ── 知识库检索（混合模式）──────────────────────────────────────────────

/**
 * 检索相关大纲知识点
 * @param {string} query 用户查询
 * @param {object} [options]
 * @param {string} [options.subject] 科目过滤
 * @param {number} [options.limit] 返回数量，默认 5
 * @param {boolean} [options.useEmbedding] 是否使用 embedding（默认自动检测）
 * @returns {Array} 相关知识点列表
 */
function search(query, options = {}) {
  const subject = options.subject || '';
  const limit = Math.min(Math.max(options.limit || 5, 1), 20);

  // 空查询直接返回空
  if (!query || !String(query).trim()) return [];

  // 加载知识库
  let sql = 'SELECT * FROM knowledge_chunks';
  const params = [];
  if (subject) {
    sql += ' WHERE subject = ?';
    params.push(subject);
  }
  const rows = db.prepare(sql).all(...params);
  if (rows.length === 0) return [];

  // 构建检索文本
  const chunks = rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    chapter: r.chapter,
    title: r.title,
    content: r.content,
    keywords: r.keywords,
    difficulty: r.difficulty,
    source: r.source,
    embedding: parseEmbedding(r.embedding),
    text: `${r.title} ${r.chapter} ${r.content} ${r.keywords || ''}`,
  }));

  // 计算 TF-IDF
  const df = computeDF(chunks);
  const totalDocs = chunks.length;
  const queryVec = vectorize(query, df, totalDocs);

  // 检查是否有可用的 embedding（且知识库中已有向量化数据）
  const hasEmbedding = chunks.some(c => c.embedding !== null);
  const embedConfig = hasEmbedding ? getEmbeddingConfig() : null;

  // 计算相似度
  const scored = chunks.map((c) => {
    // TF-IDF 分数
    const chunkVec = vectorize(c.text, df, totalDocs);
    let tfidfScore = cosineSimilaritySparse(queryVec, chunkVec);

    const queryTokens = new Set(tokenize(query));

    // 标题匹配加分（权重高，因为标题最能代表内容）
    const titleTokens = new Set(tokenize(c.title));
    let titleOverlap = 0;
    for (const t of queryTokens) {
      if (titleTokens.has(t)) titleOverlap++;
    }
    if (titleOverlap > 0) tfidfScore += titleOverlap * 0.08;

    // 章节匹配加分
    const chapterTokens = new Set(tokenize(c.chapter));
    let chapterOverlap = 0;
    for (const t of queryTokens) {
      if (chapterTokens.has(t)) chapterOverlap++;
    }
    if (chapterOverlap > 0) tfidfScore += chapterOverlap * 0.04;

    // 关键词匹配加分
    if (c.keywords) {
      const kwTokens = new Set(tokenize(c.keywords));
      let kwOverlap = 0;
      for (const t of queryTokens) {
        if (kwTokens.has(t)) kwOverlap++;
      }
      if (kwOverlap > 0) tfidfScore += kwOverlap * 0.05;
    }

    // Embedding 语义相似度
    let finalScore = tfidfScore;
    let embedScore = null;

    if (c.embedding && options.queryEmbedding) {
      embedScore = embeddingService.cosineSimilarity(options.queryEmbedding, c.embedding);
      finalScore = embedScore * 0.6 + tfidfScore * 0.4;
    }

    return { ...c, score: finalScore, tfidfScore, embedScore };
  });

  // 排序并返回 Top K
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((c) => ({
    id: c.id,
    subject: c.subject,
    chapter: c.chapter,
    title: c.title,
    content: c.content,
    keywords: c.keywords,
    difficulty: c.difficulty,
    source: c.source,
    relevance: Math.round(c.score * 100) / 100,
  }));
}

/**
 * 异步检索（支持 embedding 查询向量化）
 * 用于 AI 工具调用，能充分利用深度学习 embedding
 */
async function searchAsync(query, options = {}) {
  const config = getEmbeddingConfig();
  if (config) {
    try {
      const queryEmbedding = await embeddingService.embedText(query, config);
      return search(query, { ...options, queryEmbedding });
    } catch (e) {
      console.error('[embedding] 查询向量化失败，降级为 TF-IDF:', e.message);
    }
  }
  return search(query, options);
}

/**
 * 自动检测查询相关的科目
 */
function detectSubject(query) {
  const q = String(query).toLowerCase();
  const rules = [
    { subj: 'ustc843', patterns: ['843', '信号与系统', '信号系统', '中科大843', '傅里叶变换', '拉普拉斯', 'z变换', '数字信号处理', 'dft', 'fft'] },
    { subj: 'math1', patterns: ['数一', '数学一', '数学1', '三重积分', '曲线积分', '曲面积分', '概率论', '数理统计', '无穷级数'] },
    { subj: 'math2', patterns: ['数二', '数学二', '数学2', '二重积分', '高数', '高等数学', '线性代数', '线代', '微分方程'] },
    { subj: 'english1', patterns: ['英一', '英语一', '英语1'] },
    { subj: 'english2', patterns: ['英二', '英语二', '英语2', '英语阅读', '英语作文', '英语翻译'] },
    { subj: 'politics', patterns: ['政治', '马原', '毛中特', '史纲', '思修', '时政'] },
    { subj: '408', patterns: ['408', '数据结构', '计组', '组成原理', '操作系统', '计网', '计算机网络', '算法', '二叉树', '进程', '线程', '死锁', 'tcp', 'ip'] },
  ];
  for (const rule of rules) {
    for (const p of rule.patterns) {
      if (q.includes(p.toLowerCase())) return rule.subj;
    }
  }
  return '';
}

/** 获取所有科目列表 */
function listSubjects() {
  const rows = db.prepare('SELECT DISTINCT subject FROM knowledge_chunks ORDER BY subject').all();
  return rows.map((r) => r.subject);
}

/** 获取知识库统计 */
function getStats() {
  const total = db.prepare('SELECT COUNT(*) as c FROM knowledge_chunks').get().c;
  const bySubject = db.prepare('SELECT subject, COUNT(*) as c FROM knowledge_chunks GROUP BY subject').all();
  const vectorized = db.prepare("SELECT COUNT(*) as c FROM knowledge_chunks WHERE embedding IS NOT NULL AND embedding != ''").get().c;
  const embedModel = db.prepare("SELECT embed_model FROM knowledge_chunks WHERE embed_model IS NOT NULL AND embed_model != '' LIMIT 1").get();
  return {
    total,
    bySubject,
    vectorized,
    embeddingModel: embedModel ? embedModel.embed_model : null,
    mode: vectorized > 0 ? 'hybrid (TF-IDF + Embedding)' : 'tfidf-only',
  };
}

module.exports = {
  search,
  searchAsync,
  detectSubject,
  listSubjects,
  getStats,
  tokenize,
  vectorizeAllChunks,
  getEmbeddingConfig,
};
