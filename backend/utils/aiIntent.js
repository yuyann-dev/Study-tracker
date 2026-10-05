/**
 * utils/aiIntent.js — 轻量意图分类（本地规则，不走大模型，PRD §8.3）
 *
 * 两级路由的第一级：用关键词/正则先命中确定性意图，直接走对应聚合，零成本。
 * 规则未命中 → general_chat（由大模型在生成时顺带理解，这里不再二次调用）。
 *
 * 意图枚举：
 *   progress_query        进度查询（我进度怎样/这个月学得怎样）
 *   mistake_diagnosis     错题诊断（错题/为什么错/哪块薄弱）
 *   recite_help           背书助手（背不下来/忘了/复习/到期）
 *   plan_generation       今日计划/排计划（今天做什么/帮我排）
 *   multi_subject_balance 多科目平衡（偏科/时间怎么分/先救哪科）
 *   sprint_strategy       冲刺策略（最后一个月/考前/冲刺）
 *   mindset_check         心态（焦虑/慌/不想学/心态）
 *   data_interpretation   数据解读（学了多少/效率/打卡统计）
 *   config_help           配置帮助（key/配置/怎么用/设置）
 *   general_chat          兜底闲聊
 */

// 规则按优先级自上而下匹配，先命中先返回。每条规则给关键词列表，命中即得分。
// confidence：命中强关键词给 0.9，弱匹配给 0.6。
const RULES = [
  {
    intent: 'config_help',
    strong: ['api key', 'apikey', 'base_url', 'baseurl', '配置', '怎么设置', '怎么用这个助手', '开通', '模型怎么填', '连接不上', '测试连接'],
  },
  {
    intent: 'sprint_strategy',
    strong: ['冲刺', '最后一个月', '考前', '最后七天', '最后一周', '临考', '初试前', '剩三十天', '剩30天', '最后几天', '最后阶段'],
  },
  {
    intent: 'mindset_check',
    strong: ['焦虑', '心态', '不想学', '摆烂', '慌', '崩溃', '学不下去', '拖延', 'emo', '抑郁', '累了', '压力大'],
  },
  {
    intent: 'mistake_diagnosis',
    strong: ['错题', '为什么错', '哪块薄弱', '薄弱点', '错因', '错了很多', '总是错', '反复错', '二刷', '刷错题', '粗心'],
    weak: ['错', '薄弱'],
  },
  {
    intent: 'recite_help',
    strong: ['背书', '背不下来', '背不完', '忘了', '记不住', '复习到期', '待复习', '到期复习', '默写', '背诵', '背了就忘'],
    weak: ['背', '复习'],
  },
  {
    intent: 'plan_generation',
    strong: ['今日计划', '今天做什么', '今天学什么', '帮我排', '排计划', '怎么安排今天', '今天安排', '今天可学', '时间块', '几点到几点'],
    weak: ['计划', '安排'],
  },
  {
    intent: 'multi_subject_balance',
    strong: ['偏科', '时间分配', '先救哪科', '多科目', '各科怎么分', '时间怎么分', '哪科落后', '时间不够分', '平衡'],
    weak: ['分配', '平衡'],
  },
  {
    intent: 'data_interpretation',
    strong: ['学了多少', '效率', '打卡', '统计', '套卷趋势', '分数趋势', '做了多少', '累计', '花了多少时间'],
  },
  {
    intent: 'progress_query',
    strong: ['进度', '落后', '完成率', '正常吗', '这个月学', '赶得上吗', '来得及吗', '做到哪', '还差多少', 'deadline', '截止'],
    weak: ['进度', '完成'],
  },
];

/**
 * 意图分类主入口。
 * @param {string} message 用户消息原文
 * @param {{projectId?: string}} [context] 上下文（当前锚定项目）
 * @returns {{intent:string, confidence:number, projectIdHint:(string|undefined)}}
 */
function classify(message, context) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) {
    return { intent: 'general_chat', confidence: 0.3, projectIdHint: context && context.projectId };
  }

  let best = { intent: 'general_chat', confidence: 0.3, projectIdHint: context && context.projectId };

  for (const rule of RULES) {
    let hit = false;
    let conf = 0;
    for (const kw of rule.strong || []) {
      if (text.includes(kw.toLowerCase())) { hit = true; conf = Math.max(conf, 0.9); }
    }
    if (!hit) {
      for (const kw of rule.weak || []) {
        if (text.includes(kw.toLowerCase())) { hit = true; conf = Math.max(conf, 0.6); }
      }
    }
    if (hit) {
      best = { intent: rule.intent, confidence: conf, projectIdHint: context && context.projectId };
      break; // 先命中优先
    }
  }

  return best;
}

module.exports = { classify };
