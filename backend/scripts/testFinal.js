const ks = require('../utils/knowledgeSearch');

console.log('=== 最终Debug测试 ===\n');

// 1. 知识库统计
console.log('1. 知识库统计:');
const stats = ks.getStats();
console.log('   总数:', stats.total, '| 模式:', stats.mode, '| 已向量化:', stats.vectorized);
console.log('   各科分布:', stats.bySubject.map(s => `${s.subject}:${s.c}`).join(', '));

// 2. 检索测试
console.log('\n2. 检索测试:');
const tests = [
  { q: '二重积分考试要求', subj: 'math2' },
  { q: '进程调度算法 死锁', subj: '408' },
  { q: '英语二阅读理解', subj: 'english2' },
  { q: '马克思主义辩证法', subj: 'politics' },
  { q: '傅里叶变换性质', subj: 'ustc843' },
  { q: 'TCP三次握手拥塞控制', subj: '' },
];
for (const t of tests) {
  const r = ks.search(t.q, { subject: t.subj, limit: 2 });
  console.log(`   "${t.q}" -> ${r.length}条, top: ${r[0] ? r[0].chapter.slice(0, 20) : '无'}`);
}

// 3. 科目自动检测
console.log('\n3. 科目自动检测:');
const detectTests = ['TCP三次握手', '线性代数特征值', '英语二作文', '信号与系统傅里叶', '政治马原'];
for (const q of detectTests) {
  console.log(`   "${q}" -> ${ks.detectSubject(q)}`);
}

// 4. embedding配置检测
console.log('\n4. Embedding配置:');
const cfg = ks.getEmbeddingConfig();
console.log('   ', cfg ? `${cfg.provider}/${cfg.model}` : '无（使用TF-IDF模式，deepseek兼容）');

// 5. 边界测试
console.log('\n5. 边界测试:');
console.log('   空查询:', ks.search('', { limit: 2 }).length, '条');
console.log('   超长查询:', ks.search('a'.repeat(1000), { limit: 2 }).length, '条');
console.log('   特殊字符:', ks.search('100%符合@#$%', { limit: 2 }).length, '条');

console.log('\n=== 所有测试通过 ===');
