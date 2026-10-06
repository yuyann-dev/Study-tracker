/* 二轮评审种子脚本：造三个考研画像用户 + 真实多科目 store，签 JWT */
const path = require('path');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const DB = 'D:/喻颜资料/大学资料/Studytracker项目/study-tracker-repo/backend/data/review.db';
const JWT_SECRET = '4d65fb21ee73b389a50f06101af42a5dcb1b6b9fffe76db835f447a54234fa7a5f578450e67c210526b6f34bbddaf304';
const db = new Database(DB);
db.pragma('foreign_keys = ON');

function daysAgo(n){ const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }
// 近7天每天均匀打 amount/7
function recPages(amountPerDay, start, n=7){
  const recs=[];
  for(let i=0;i<n;i++){ recs.push({date:daysAgo(i+1), startPage:start+i, endPage:start+i+amountPerDay}); }
  return recs;
}
function reciteItems(total, masteredCount, dueCount, backlogCount){
  const items=[];
  for(let i=0;i<total;i++){
    const mastered = i<masteredCount;
    const age = dueCount+backlogCount - i; // 前几个最早学、已逾期
    items.push({
      id:'it'+i, content:'背诵要点#'+i, learnedDate:daysAgo(Math.max(1, age+5)),
      reviews: mastered?[{date:daysAgo(1),result:'ok'}]:[{date:daysAgo(Math.max(1,age)),result:'模糊'}],
      stage:0, mastered, manualMastered:false, wrongStreak:0
    });
  }
  return items;
}

const DEADLINE='2026-12-19';

function upsertUser(email, username, store){
  const exist = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  let uid;
  if(exist){ uid=exist.id; }
  else {
    const info = db.prepare('INSERT INTO users (username,password_hash,email,is_admin,token_version) VALUES (?,?,?,0,0)')
      .run(username,'x',email);
    uid = info.lastInsertRowid;
  }
  db.prepare('INSERT INTO user_data (user_id, store_json, project_count, updated_at) VALUES (?,?,?,datetime(\'now\')) ON CONFLICT(user_id) DO UPDATE SET store_json=excluded.store_json, project_count=excluded.project_count')
    .run(uid, JSON.stringify(store), Object.keys(store.projects||{}).length);
  const token = jwt.sign({id:uid, username, tv:0}, JWT_SECRET);
  return {uid, token};
}

// ── 画像1：数学+政治+英语，6h ──
const store1 = { projects:{
  math:{ id:'math', name:'高数1800题', type:'exercise', subjectKey:'数学', bookStartPage:1, bookEndPage:600, deadline:DEADLINE, dailyCapacity:3, minutesPerUnit:7, records: recPages(0.7, 1, 7), updatedAt:Date.now() },
  engRead:{ id:'engRead', name:'英语阅读80篇', type:'exercise', subjectKey:'英语', bookStartPage:1, bookEndPage:80, deadline:DEADLINE, dailyCapacity:1, minutesPerUnit:10, records: recPages(0.35, 1, 7), updatedAt:Date.now() },
  polRecite:{ id:'polRecite', name:'政治核心考点背诵', type:'recite', subjectKey:'政治', deadline:DEADLINE, items: reciteItems(120, 30, 18, 10), intervals:[1,2,4,7,15,30], updatedAt:Date.now() },
  engMistake:{ id:'engMistake', name:'英语错题本', type:'mistake', subjectKey:'英语', items:[{id:'m1',content:'阅读长难句',wrongStreak:2,errTags:['语法']},{id:'m2',content:'完型固定搭配',wrongStreak:1,errTags:['词汇']}], updatedAt:Date.now() }
}};

// ── 画像2：不考数学，专业课+英语，进度焦虑 ──
const store2 = { projects:{
  majorRecite:{ id:'majorRecite', name:'专业课大综合背诵', type:'recite', subjectKey:'专业课', deadline:DEADLINE, items: reciteItems(300, 40, 45, 40), intervals:[1,2,4,7,15,30], updatedAt:Date.now() },
  majorEx:{ id:'majorEx', name:'专业课习题集', type:'exercise', subjectKey:'专业课', bookStartPage:1, bookEndPage:400, deadline:DEADLINE, dailyCapacity:1, minutesPerUnit:9, records: recPages(0.5, 1, 7), updatedAt:Date.now() },
  engRead:{ id:'engRead', name:'英语阅读', type:'exercise', subjectKey:'英语', bookStartPage:1, bookEndPage:60, deadline:DEADLINE, dailyCapacity:0.3, minutesPerUnit:10, records: recPages(0.12,1,7), updatedAt:Date.now() }
}};

// ── 画像3：在职，数学+英语，2.5h ──
const store3 = { projects:{
  math:{ id:'math', name:'高数辅导讲义', type:'exercise', subjectKey:'数学', bookStartPage:1, bookEndPage:500, deadline:DEADLINE, dailyCapacity:1, minutesPerUnit:8, records: recPages(0.4, 1, 7), updatedAt:Date.now() },
  eng:{ id:'eng', name:'英语真题', type:'exercise', subjectKey:'英语', bookStartPage:1, bookEndPage:100, deadline:DEADLINE, dailyCapacity:0.3, minutesPerUnit:10, records: recPages(0.15, 1, 7), updatedAt:Date.now() },
  mathMistake:{ id:'mathMistake', name:'数学错题本', type:'mistake', subjectKey:'数学', items:[
    {id:'x1',content:'极限计算',wrongStreak:3,errTags:['极限']},
    {id:'x2',content:'中值定理',wrongStreak:3,errTags:['证明']},
    {id:'x3',content:'级数判敛',wrongStreak:2,errTags:['级数']},
    {id:'x4',content:'积分应用',wrongStreak:2,errTags:['积分']}
  ], updatedAt:Date.now() }
}};

const r1 = upsertUser('p1@review.test','三科并行',store1);
const r2 = upsertUser('p2@review.test','不考数学',store2);
const r3 = upsertUser('p3@review.test','在职慢节奏',store3);
console.log(JSON.stringify({r1,r2,r3},null,2));
