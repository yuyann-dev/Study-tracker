/**
 * utils/aiTools.js — Function Calling 只读工具引擎（规格 §3）
 *
 * 集中管理 12 个只读工具：
 *   - TOOL_SCHEMAS：OpenAI function calling 格式的参数 schema（英文 description 给 LLM 看）
 *   - executeReadonlyTool(name, args, userId)：按 name 分发到聚合层，userId 由调用方注入
 *   - getToolLabel(name, args, store)：生成中文短句 label，供前端展示查询过程
 *
 * 安全铁律（§9）：
 *   - userId 只从后端注入，工具参数永不接受用户标识；
 *   - projectId 必须命中 store.projects，否则返回 found:false；
 *   - days/limit 夹在合法范围，数字参数 Number.isFinite 校验；
 *   - 任何工具执行异常都吞掉，返回 {error:"该数据暂时读不到"}，绝不抛到路由层。
 */
const db = require('../database');
const aggregator = require('./aiDataAggregator');

// ── 工具 Schema（OpenAI function calling 格式，规格 §3）─────────────────────

const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'get_user_profile',
      description: 'Get the user\'s basic study profile: exam anchor date, days left, current study stage, number and type of projects (exercise/recite/mistake), subject list, and currently configured daily study minutes. Call this FIRST when the user asks an open-ended question about their overall situation before diving into any single project.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_projects_summary',
      description: 'List all active (non-archived) projects with one-line progress each: type, name, subject, deadline, days left, and key metric (completion rate for exercise, mastery rate + due/backlog for recite, streaky count for mistake). Use when the user compares projects or asks which subject to prioritize.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['exercise', 'recite', 'mistake'], description: 'Optional filter by project type.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_project_detail',
      description: 'Get detailed diagnosis of ONE project by id: completion/mastery rate, pace gap vs deadline, weak units (for mistake book), high-risk entries about to be forgotten (for recite book). Always use a projectId returned by get_projects_summary.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project id from get_projects_summary.' },
        },
        required: ['projectId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_today_tasks',
      description: 'Get today\'s study plan: which projects to work on, estimated minutes per block, and priority (P0/P1/P2), allocated within the time budget. Call when the user asks "what should I do today" or "plan my day".',
      parameters: {
        type: 'object',
        properties: {
          budgetMin: { type: 'number', description: 'Available minutes today. Omit to use the user\'s configured daily study minutes.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weekly_stats',
      description: 'Get study volume of the last N days (default 7): pages done per day (exercise), recite check-ins per day, mistake review check-ins per day. Use when the user asks about recent effort, rhythm, or whether they have been slacking.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'How many days back, default 7, max 30.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_mistake_analysis',
      description: 'Analyze mistake books: error-tag distribution, weak units (by page range), question-type distribution, top repeated-mistake items (wrongStreak>=2), pseudo-mastered items, and cross-year stubborn items. Omit projectId to analyze ALL mistake books.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Which mistake book. Omit to aggregate all mistake books.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recite_status',
      description: 'Get recite book status: total items, mastery rate, how many items are due today, how many are overdue backlog, and high-risk entries whose last review result was forget/fuzzy. Omit projectId to aggregate all recite books.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Which recite book. Omit to aggregate all recite books.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_paper_trend',
      description: 'Get score trend of an exercise project: each practice paper\'s score, per-section scores and time spent. Use when the user asks about recent paper performance, score trend, or which section is weak.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Which exercise project (must be a paper-based exercise book).' },
        },
        required: ['projectId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_multi_subject_balance',
      description: 'Compare all projects by urgency: which ones are behind pace (exercise gap, recite backlog, repeated-mistake count), which are on track or ahead. Use when the user asks which subject to prioritize or feels overwhelmed.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_study_records',
      description: 'Get recent check-in records (most recent first): date, project name, what was done (page range for exercise, check-in for recite/mistake). Use when the user asks what they did recently or to verify a specific day.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Filter to one project. Omit for all projects.' },
          limit: { type: 'number', description: 'Max records, default 10, max 30.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_schedule',
      description: 'Generate a structured schedule proposal: today\'s minute allocation PLUS a projection of when each project will finish at the current pace vs the deadline. Use when the user asks "can I finish in time" or "make me a plan". This is READ-ONLY analysis returned as data; the AI only narrates it, nothing is written to the store.',
      parameters: {
        type: 'object',
        properties: {
          budgetMin: { type: 'number', description: 'Daily available minutes. Omit to use configured default.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_review_forecast',
      description: 'Forecast review load for the next N days (default 7): how many recite and mistake items come due each day, to spot coming backlog. Use when the user asks "will review pile up soon" or "how busy will next week be".',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'How many days ahead, default 7, max 21.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'Save a piece of information about the user to long-term memory. Call this ONLY when the user explicitly states a stable preference, goal, or fact that should be remembered across conversations (e.g. target school/major, study habits, daily routine, important dates, personal constraints). Do NOT save transient data like today\'s progress, current stats, or anything that changes daily. Keep content concise (under 100 chars).',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The memory to save, concise and factual.' },
          kind: { type: 'string', enum: ['preference', 'goal', 'fact'], description: 'Memory category.' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for external information. Use this ONLY when the question requires up-to-date or external knowledge NOT available in the user\'s study data: e.g. target school\'s exam subjects/reference books, graduate school admission policies, exam syllabus changes, subject-specific concepts, study methods. Do NOT use for analyzing the user\'s personal data, progress, or scheduling — those use the data tools above. Search results may be imperfect; cite sources when helpful and note uncertainty.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query in Chinese or English, concise and specific.' },
        },
        required: ['query'],
      },
    },
  },
];

// ── 参数校验小工具 ──────────────────────────────────────────────────────────

/** 读取该用户配置的每日可学分钟数（工具内 budgetMin 缺省值） */
function getDailyStudyMinutes(userId) {
  try {
    const row = db.prepare('SELECT daily_study_minutes FROM ai_configs WHERE user_id = ?').get(userId);
    return (row && Number(row.daily_study_minutes) > 0) ? Number(row.daily_study_minutes) : 240;
  } catch (_) {
    return 240;
  }
}

/** 校验 projectId 是否命中 store.projects（含归档，详情类需要） */
function projectExists(userId, projectId) {
  const store = aggregator.loadStore(userId);
  return !!aggregator.findProject(store, projectId);
}

/** 数字夹取：非法用缺省，再夹到 [min,max] */
function clampNum(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// ── 工具实现（每个对应一个 §3.x）─────────────────────────────────────────────

/** §3.1 用户整体画像 */
function implGetUserProfile(userId) {
  const summary = aggregator.getUserProfileSummary(userId);
  const daysLeft = summary.daysLeft;
  const stage = daysLeft > 240 ? '基础/强化期' : daysLeft > 90 ? '真题期' : '冲刺期';
  return {
    examAnchor: summary.examAnchor,
    daysLeft,
    stage,
    configuredDailyStudyMinutes: getDailyStudyMinutes(userId),
    projectCount: summary.projectCount,
    byType: summary.byType,
    subjects: summary.subjects,
    projectNames: (summary.projects || []).map((p) => p.name),
  };
}

/** §3.2 所有未归档项目概览 */
function implGetProjectsSummary(userId, args) {
  const store = aggregator.loadStore(userId);
  let list = aggregator.projectList(store).map(aggregator.projectStats);
  if (args.type && ['exercise', 'recite', 'mistake'].includes(args.type)) {
    list = list.filter((p) => p.type === args.type);
  }
  return { projects: list };
}

/** §3.3 单项目详细诊断 */
function implGetProjectDetail(userId, args) {
  const projectId = String(args.projectId || '').trim();
  if (!projectId || !projectExists(userId, projectId)) {
    return { found: false, reason: '项目不存在' };
  }
  const progress = aggregator.getProgressSummary(userId, projectId);
  const out = { found: true, progress };
  if (progress.type === 'mistake') {
    const report = aggregator.getMistakeReport(userId, projectId);
    out.weakUnits = (report.byUnit || []).slice(0, 5);
    out.streakyTop = (report.streakyTop || []).slice(0, 5);
  } else if (progress.type === 'recite') {
    const status = aggregator.getReciteStatus(userId, projectId);
    out.highRisk = (status.highRisk || []).slice(0, 10);
  }
  return out;
}

/** §3.4 今日待办 */
function implGetTodayTasks(userId, args) {
  let budgetMin = Number(args.budgetMin);
  if (!Number.isFinite(budgetMin) || budgetMin <= 0) budgetMin = getDailyStudyMinutes(userId);
  return aggregator.getTodayPlan(userId, budgetMin);
}

/** §3.5 近 N 天学习量 */
function implGetWeeklyStats(userId, args) {
  const days = clampNum(args.days, 7, 1, 30);
  return aggregator.getWeeklyStats(userId, days);
}

/** §3.6 错题薄弱点 */
function implGetMistakeAnalysis(userId, args) {
  let projectId = args.projectId ? String(args.projectId).trim() : '';
  if (projectId && !projectExists(userId, projectId)) {
    return { found: false, reason: '项目不存在' };
  }
  return aggregator.getMistakeReport(userId, projectId || undefined);
}

/** §3.7 背书状态 */
function implGetReciteStatus(userId, args) {
  let projectId = args.projectId ? String(args.projectId).trim() : '';
  if (projectId && !projectExists(userId, projectId)) {
    return { found: false, reason: '项目不存在' };
  }
  return aggregator.getReciteStatus(userId, projectId || undefined);
}

/** §3.8 套卷分数趋势 */
function implGetPaperTrend(userId, args) {
  const projectId = String(args.projectId || '').trim();
  if (!projectId || !projectExists(userId, projectId)) {
    return { found: false, reason: '项目不存在' };
  }
  return aggregator.getPaperTrend(userId, projectId);
}

/** §3.9 多科目均衡 */
function implGetMultiSubjectBalance(userId) {
  return aggregator.getMultiSubjectBalance(userId);
}

/** §3.10 近期打卡记录 */
function implGetStudyRecords(userId, args) {
  let projectId = args.projectId ? String(args.projectId).trim() : '';
  if (projectId && !projectExists(userId, projectId)) {
    return { found: false, reason: '项目不存在' };
  }
  const limit = clampNum(args.limit, 10, 1, 30);
  return aggregator.getRecentRecords(userId, projectId || undefined, limit);
}

/** §3.11 排期与完成时间投影 */
function implGenerateSchedule(userId, args) {
  let budgetMin = Number(args.budgetMin);
  if (!Number.isFinite(budgetMin) || budgetMin <= 0) budgetMin = getDailyStudyMinutes(userId);
  return aggregator.generateSchedule(userId, budgetMin);
}

/** §3.12 未来 N 天复习压力 */
function implGetReviewForecast(userId, args) {
  const days = clampNum(args.days, 7, 1, 21);
  return aggregator.getReviewForecast(userId, days);
}

// ── 对外分发 ────────────────────────────────────────────────────────────────

/**
 * 执行一个只读工具。所有异常吞掉，统一返回 {error:'该数据暂时读不到'}。
 * @param {string} name 工具名
 * @param {object} args 模型给出的参数对象（已 JSON.parse）
 * @param {number} userId 由路由注入，不接受参数里的用户标识
 * @returns {object} 工具结果
 */
function executeReadonlyTool(name, args, userId) {
  args = args && typeof args === 'object' ? args : {};
  try {
    switch (name) {
      case 'get_user_profile': return implGetUserProfile(userId);
      case 'get_projects_summary': return implGetProjectsSummary(userId, args);
      case 'get_project_detail': return implGetProjectDetail(userId, args);
      case 'get_today_tasks': return implGetTodayTasks(userId, args);
      case 'get_weekly_stats': return implGetWeeklyStats(userId, args);
      case 'get_mistake_analysis': return implGetMistakeAnalysis(userId, args);
      case 'get_recite_status': return implGetReciteStatus(userId, args);
      case 'get_paper_trend': return implGetPaperTrend(userId, args);
      case 'get_multi_subject_balance': return implGetMultiSubjectBalance(userId);
      case 'get_study_records': return implGetStudyRecords(userId, args);
      case 'generate_schedule': return implGenerateSchedule(userId, args);
      case 'get_review_forecast': return implGetReviewForecast(userId, args);
      default: return { error: '未知工具' };
    }
  } catch (e) {
    console.error('[aiTools] execute failed:', name, e.message);
    return { error: '该数据暂时读不到' };
  }
}

/**
 * 根据工具名+参数生成中文 label（规格 §6.2 映射表），供前端展示查询过程。
 * @param {string} name
 * @param {object} args
 * @param {object} store 当前用户 store（用于查 projectName）
 * @returns {string}
 */
function getToolLabel(name, args, store) {
  args = args || {};
  const projects = (store && store.projects) || {};
  const project = args.projectId ? projects[args.projectId] : null;
  const projectName = project ? project.name : null;
  switch (name) {
    case 'get_user_profile': return '查看你的整体学习画像';
    case 'get_projects_summary': return '查看所有项目进度';
    case 'get_project_detail': return projectName ? `查看《${projectName}》详情` : '查看项目详情';
    case 'get_today_tasks': return '生成今日任务清单';
    case 'get_weekly_stats': return `统计近 ${args.days || 7} 天学习量`;
    case 'get_mistake_analysis': return projectName ? `分析《${projectName}》薄弱点` : '分析全部错题薄弱点';
    case 'get_recite_status': return projectName ? `查看《${projectName}》背诵状态` : '查看全部背书本状态';
    case 'get_paper_trend': return projectName ? `查看《${projectName}》分数趋势` : '查看分数趋势';
    case 'get_multi_subject_balance': return '对比各科紧迫度';
    case 'get_study_records': return '查看近期打卡记录';
    case 'generate_schedule': return '计算排期与完成时间投影';
    case 'get_review_forecast': return `预测未来 ${args.days || 7} 天复习压力`;
    case 'save_memory': return '记下你的偏好';
    case 'web_search': return args.query ? `联网搜索：${args.query.slice(0, 30)}` : '联网搜索';
    default: return '查询学习数据';
  }
}

module.exports = { TOOL_SCHEMAS, executeReadonlyTool, getToolLabel };
