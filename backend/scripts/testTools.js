const t = require('../utils/aiTools');
console.log('工具数量:', t.TOOL_SCHEMAS.length);
console.log('工具列表:', t.TOOL_SCHEMAS.map(s => s.function.name).join(', '));
console.log('\nsearch_syllabus schema:');
const ss = t.TOOL_SCHEMAS.find(s => s.function.name === 'search_syllabus');
console.log(JSON.stringify(ss, null, 2));
