const ks = require('../utils/knowledgeSearch');

// 测试1：数学二 - 二重积分
console.log('=== 测试1：数学二 - 二重积分 ===');
let r = ks.search('二重积分考试要求', { subject: 'math2', limit: 3 });
r.forEach((item, i) => {
  console.log(`${i + 1}. [${item.relevance}] ${item.chapter} - ${item.title}`);
  console.log(`   ${item.content.slice(0, 80)}...`);
});

// 测试2：408 - 进程调度
console.log('\n=== 测试2：408 - 进程调度 ===');
r = ks.search('进程调度算法 死锁', { subject: '408', limit: 3 });
r.forEach((item, i) => {
  console.log(`${i + 1}. [${item.relevance}] ${item.chapter} - ${item.title}`);
});

// 测试3：自动检测科目
console.log('\n=== 测试3：自动检测科目 ===');
console.log('"TCP三次握手" ->', ks.detectSubject('TCP三次握手'));
console.log('"线性代数特征值" ->', ks.detectSubject('线性代数特征值'));
console.log('"英语二作文" ->', ks.detectSubject('英语二作文'));

// 测试4：统计
console.log('\n=== 测试4：知识库统计 ===');
console.log(JSON.stringify(ks.getStats(), null, 2));
