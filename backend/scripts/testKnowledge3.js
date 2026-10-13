const ks = require('../utils/knowledgeSearch');

console.log('=== 知识库统计 ===');
const stats = ks.getStats();
console.log('总数:', stats.total, '模式:', stats.mode, '已向量化:', stats.vectorized);

console.log('\n=== 测试1：数学二 - 二重积分 ===');
let r = ks.search('二重积分考试要求', { subject: 'math2', limit: 3 });
r.forEach((item, i) => {
  console.log(`${i + 1}. [${item.relevance}] ${item.chapter} - ${item.title}`);
});

console.log('\n=== 测试2：408 - 进程调度死锁 ===');
r = ks.search('进程调度算法 死锁', { subject: '408', limit: 3 });
r.forEach((item, i) => {
  console.log(`${i + 1}. [${item.relevance}] ${item.chapter} - ${item.title}`);
});

console.log('\n=== 测试3：英语二 - 阅读 ===');
r = ks.search('英语二阅读理解题型', { limit: 3 });
r.forEach((item, i) => {
  console.log(`${i + 1}. [${item.relevance}] ${item.chapter} - ${item.title}`);
});

console.log('\n=== 测试4：政治 - 马原 ===');
r = ks.search('马克思主义基本原理 辩证法', { limit: 3 });
r.forEach((item, i) => {
  console.log(`${i + 1}. [${item.relevance}] ${item.chapter} - ${item.title}`);
});

console.log('\n=== 测试5：自动检测科目 ===');
console.log('TCP三次握手 ->', ks.detectSubject('TCP三次握手'));
console.log('线性代数特征值 ->', ks.detectSubject('线性代数特征值'));
console.log('英语二作文 ->', ks.detectSubject('英语二作文'));
console.log('信号与系统傅里叶 ->', ks.detectSubject('信号与系统傅里叶'));

console.log('\n所有测试完成！');
