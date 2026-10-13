/**
 * utils/knowledgeSearch.js — 考研大纲知识库向量检索引擎
 *
 * 采用 TF-IDF 向量化 + 余弦相似度检索，纯 JS 实现，无外部依赖。
 * 后续可平滑升级为深度学习 embedding（只需替换 embed() 函数）。
 *
 * 数据结构：
 *   knowledge_chunks 表：每条 = 一个大纲章节/知识点分块
 *   - id, subject(科目), chapter(章节), title(标题), content(内容),
 *     keywords(关键词), difficulty(难度), source(来源), created_at
 *
 * 检索流程：
 *   1. 用户查询 → 分词（中文按字/词混合）→ TF-IDF 向量化
 *   2. 与知识库中所有 chunk 计算余弦相似度
 *   3. 按科目过滤 + 相似度排序 → 返回 Top K
 *   4. 同义词扩展提升召回率
 */

const db = require('../database');

// ── 同义词表（考研常见术语，提升召回）──────────────────────────────────
const SYNONYMS = {
  '高数': ['高等数学', '微积分', '数学分析'],
  '线代': ['线性代数', '矩阵'],
  '概率': ['概率论', '数理统计', '概率统计'],
  '数据结构': ['DS', '算法与数据结构'],
  '计组': ['计算机组成原理', '组成原理', '计算机组织'],
  '操作系统': ['OS', 'os'],
  '计网': ['计算机网络', '网络', '计算机通信网'],
  '408': ['计算机学科专业基础', '计算机统考'],
  '英一': ['英语一', '英语1'],
  '英二': ['英语二', '英语2'],
  '数一': ['数学一', '数学1'],
  '数二': ['数学二', '数学2'],
  '政治': ['思想政治理论', '考研政治'],
  '信号与系统': ['信号系统', '843', '中科大843'],
  '极限': ['lim', '极限论'],
  '导数': ['微分', '求导'],
  '积分': ['不定积分', '定积分', '微积分'],
  '微分方程': ['ODE', '常微分方程'],
  '矩阵': ['方阵', '矩阵论'],
  '特征值': ['特征向量', 'eigenvalue'],
  '二次型': ['quadratic form'],
  '进程': ['process', '任务'],
  '线程': ['thread'],
  '死锁': ['deadlock'],
  '内存管理': ['存储管理', '虚拟内存'],
  'TCP': ['传输控制协议', 'tcp'],
  'IP': ['网际协议', 'internet protocol'],
  'HTTP': ['超文本传输协议', 'http'],
  '二叉树': ['binary tree'],
  '图': ['graph', '图论'],
  '排序': ['sort', '排序算法'],
  '查找': ['search', '搜索'],
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
  // 保留中英文、数字
  s = s.replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ');
  const tokens = [];
  const words = s.split(/\s+/).filter(Boolean);

  for (const w of words) {
    // 英文/数字直接作为 token
    if (/^[a-z0-9]+$/.test(w)) {
      if (!STOP_WORDS.has(w) && w.length > 1) tokens.push(w);
      continue;
    }
    // 中文：先尝试匹配同义词表
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
    // 2-gram 切分
    if (w.length >= 2) {
      for (let i = 0; i < w.length - 1; i++) {
        const bi = w.slice(i, i + 2);
        if (!STOP_WORDS.has(bi)) tokens.push(bi);
      }
    }
    // 单字（只保留有意义的）
    for (const ch of w) {
      if (!STOP_WORDS.has(ch) && /[\u4e00-\u9fa5]/.test(ch)) {
        tokens.push(ch);
      }
    }
  }
  return tokens;
}

// ── TF-IDF 向量化 ──────────────────────────────────────────────────────

/** 计算文档频率（DF）：每个 token 出现在多少个 chunk 中 */
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

/** 计算词频（TF） */
function computeTF(tokens) {
  const tf = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  // 归一化
  const total = tokens.length || 1;
  for (const k of Object.keys(tf)) {
    tf[k] = tf[k] / total;
  }
  return tf;
}

/** 计算 TF-IDF 向量（稀疏表示：{token: weight}） */
function vectorize(text, df, totalDocs) {
  const tokens = tokenize(text);
  const tf = computeTF(tokens);
  const vec = {};
  for (const [term, freq] of Object.entries(tf)) {
    const docFreq = df[term] || 0;
    // IDF = log((N+1)/(DF+1)) + 1，避免除零
    const idf = Math.log((totalDocs + 1) / (docFreq + 1)) + 1;
    vec[term] = freq * idf;
  }
  return vec;
}

/** 余弦相似度 */
function cosineSimilarity(v1, v2) {
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

// ── 知识库检索 ─────────────────────────────────────────────────────────

/**
 * 检索相关大纲知识点
 * @param {string} query 用户查询
 * @param {object} [options]
 * @param {string} [options.subject] 科目过滤（math1/math2/english1/english2/politics/408/ustc843）
 * @param {number} [options.limit] 返回数量，默认 5
 * @returns {Array} 相关知识点列表
 */
function search(query, options = {}) {
  const subject = options.subject || '';
  const limit = Math.min(Math.max(options.limit || 5, 1), 20);

  // 加载知识库
  let sql = 'SELECT * FROM knowledge_chunks';
  const params = [];
  if (subject) {
    sql += ' WHERE subject = ?';
    params.push(subject);
  }
  const rows = db.prepare(sql).all(...params);
  if (rows.length === 0) return [];

  // 构建检索文本（标题+章节+内容+关键词）
  const chunks = rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    chapter: r.chapter,
    title: r.title,
    content: r.content,
    keywords: r.keywords,
    difficulty: r.difficulty,
    source: r.source,
    text: `${r.title} ${r.chapter} ${r.content} ${r.keywords || ''}`,
  }));

  // 计算 DF
  const df = computeDF(chunks);
  const totalDocs = chunks.length;

  // 查询向量化
  const queryVec = vectorize(query, df, totalDocs);

  // 计算相似度
  const scored = chunks.map((c) => {
    const chunkVec = vectorize(c.text, df, totalDocs);
    let sim = cosineSimilarity(queryVec, chunkVec);
    // 标题匹配加分
    const titleTokens = new Set(tokenize(c.title));
    const queryTokens = new Set(tokenize(query));
    let titleOverlap = 0;
    for (const t of queryTokens) {
      if (titleTokens.has(t)) titleOverlap++;
    }
    if (titleOverlap > 0) sim += titleOverlap * 0.05;
    // 关键词匹配加分
    if (c.keywords) {
      const kwTokens = new Set(tokenize(c.keywords));
      let kwOverlap = 0;
      for (const t of queryTokens) {
        if (kwTokens.has(t)) kwOverlap++;
      }
      if (kwOverlap > 0) sim += kwOverlap * 0.03;
    }
    return { ...c, score: sim };
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
 * 自动检测查询相关的科目
 */
function detectSubject(query) {
  const q = String(query).toLowerCase();
  const rules = [
    { subj: 'math1', patterns: ['数一', '数学一', '数学1', '三重积分', '曲线积分', '曲面积分', '傅里叶', '概率论', '数理统计'] },
    { subj: 'math2', patterns: ['数二', '数学二', '数学2', '二重积分', '高数', '高等数学', '线性代数', '线代', '微分方程'] },
    { subj: 'english1', patterns: ['英一', '英语一', '英语1'] },
    { subj: 'english2', patterns: ['英二', '英语二', '英语2', '英语阅读', '英语作文', '英语翻译'] },
    { subj: 'politics', patterns: ['政治', '马原', '毛中特', '史纲', '思修', '时政'] },
    { subj: '408', patterns: ['408', '数据结构', '计组', '组成原理', '操作系统', '计网', '计算机网络', '算法', '二叉树', '进程', '线程', '死锁', 'tcp', 'ip'] },
    { subj: 'ustc843', patterns: ['843', '信号与系统', '信号系统', '中科大843', '傅里叶变换', '拉普拉斯', 'z变换'] },
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
  return { total, bySubject };
}

module.exports = {
  search,
  detectSubject,
  listSubjects,
  getStats,
  tokenize, // 导出供测试
};
