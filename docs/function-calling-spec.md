# Study Tracker AI 助手 Function Calling 工具规格

> 版本：v1.1（2026-10-06）
> 目标：把「系统 Prompt 注入全量数据摘要」改为「AI 按需调用只读工具取数」。
> 修改/创建类操作**不新增**，完全沿用现有 `adjust_daily_comfort` + action 卡片机制。
> 数据源基准：`backend/utils/aiDataAggregator.js` 已导出的聚合函数；工具返回值一律基于这些真实可用的数据，不虚构字段。

---

## 1. 总体设计

### 1.1 权限分层

| 层 | 谁执行 | 是否要用户确认 | 本规格中的载体 |
|---|---|---|---|
| 只读查询 | 后端工具函数，AI 自由调用 | 否 | tools（OpenAI function calling） |
| 修改数据 | 前端在用户点「应用」后改写 store | 是 | **仅现有 `adjust_daily_comfort`**，机制不变 |
| 删除 | — | — | **绝对禁止**，不提供任何工具/action |

### 1.2 工具调用循环（后端内部完成，对前端仍是单次 HTTP）

现有 `POST /api/ai/chat` 是单次请求-响应。引入 function calling 后，后端在请求内部跑「模型→工具→模型」循环，把完整过程记录成 trace，最后一次性返回：

```
messages = [system, ...近10轮历史, user本轮]
tools    = 本规格 §3 的 12 个只读工具（仅当 toolsEnabled）

loop（上限 5 轮，上限 12 次工具调用）:
    resp = callLLM(cfg, messages, { tools, tool_choice:'auto' })
    if resp.message 无 tool_calls → break（这就是最终回复）
    messages.push(resp.message)                    // 带 tool_calls 的 assistant 消息
    for each tool_call in resp.message.tool_calls:
        args   = JSON.parse(tool_call.arguments)
        result = executeReadonlyTool(tool_call.name, args, req.user.id)   // 服务端执行，userId 注入
        trace.push({ seq, name, label, status:'ok'|'error', durationMs })
        messages.push({ role:'tool', tool_call_id, content: JSON.stringify(result) })

finalText = 最后一轮 resp.message.content
{ body, rawActions } = parseReply(finalText)
validActions = filterValidActions(rawActions, store.projects)   // 白名单仍只有 adjust_daily_comfort
落库 user/assistant 消息 → 返回 { reply: body, actions: validActions, toolCalls: trace, ... }
```

关键约束：
- **userId 永远由后端注入**，不接受工具参数里传来的任何用户标识，杜绝跨用户读数据。
- 工具函数内部一律走 `aggregator.loadStore(userId)`，与现有聚合函数同源。
- 任一步出错（模型不支持 tools / 上游 5xx / 解析失败）按 §7 降级，不允许把 chat 流水线打崩（对齐 aggregator 里 `safe()` 防御思路）。

### 1.3 需要改动的现有文件

| 文件 | 改动 |
|---|---|
| `backend/utils/aiProxy.js` | `callLLM` 的 `opts` 增加 `tools`；返回值增加 `toolCalls:[{id,name,arguments}]` 与原始 `message` |
| `backend/utils/aiDataAggregator.js` | 新增 `getWeeklyStats`、`getRecentRecords`、`generateSchedule`、`getReviewForecast` 四个只读 helper（见 §3.13） |
| `backend/routes/ai.js` | `/chat` 改为工具循环；响应增加 `toolCalls`；`ai_configs` 增加 `tools_enabled` 列 |
| `frontend/js/app.js`（AI 模块） | 渲染「AI 查询过程」折叠区（§6）；action 卡片渲染逻辑**不变** |

---

## 2. 数据模型基准（工具返回值的字段以此为准）

摘自 `aiDataAggregator.js` 头部注释，字段缺失一律降级缺省：

```
project = {
  id, name,
  type: 'exercise' | 'recite' | 'mistake',
  total, deadline: 'YYYY-MM-DD',
  bookStartPage, bookEndPage,
  dailyCapacity,            // 刷题本每日容量（页）
  dailyComfort,             // 错题/背书本每日舒适量（条），现有 adjust_daily_comfort 操作的字段
  records: [{ date, startPage, endPage, rid, score?, sections? }],
  items: [{ id, content, learnedDate, reviews:[{date,result}], stage,
            mastered, manualMastered, errTags:[], note, pageStart, pageEnd,
            wrongStreak, setNo, questionType?, examYear? }],
  units: [{ name, startPage, endPage, children }],
  intervals: [...],         // 间隔表，默认 [1,2,4,7,15,30]
  subjectKey?, minutesPerUnit?, targetScoreTier?,
  archived?, updatedAt?
}
```

聚合层已产出的紧凑结构（数字保留 1 位小数、content 截 40 字）直接作为工具返回值，不再二次加工：

- `projectStats(p)` → exercise: `{id,name,type,subjectKey,deadline,daysLeft,dailyCapacity,total,done,completionRate,recent7Rate,requiredRate,gap}`；recite: `{…,totalItems,mastered,masteryRate,dueToday,backlog,highRisk}`；mistake: `{…,totalItems,streakyCount,errTagDist}`。
- `getMistakeReport` → `{found,total,errTagDist,byUnit,byQuestionType,semanticTop,streakyTop,pseudoMastered,crossYear}`。
- `getReciteStatus` → `{found,total,mastered,masteryRate,dueToday,backlog,highRisk}`。
- `getPaperTrend` → `{found,projectName,hasScore,points:[{seq,date,score,sections}],hint}`。
- `getMultiSubjectBalance` → `{today,rows,behind,ahead}`。
- `getTodayPlan` → `{budgetMin,allocatedMin,plan:[{projectId,name,kind,estMin,priority}]}`。

---

## 3. 只读工具清单（12 个）

> OpenAI function calling 格式。`description` 用英文（给 LLM 看），其余中文注释。所有工具**不需要也不接受 userId 参数**。

### 3.1 `get_user_profile`

用户基本画像：考研锚点日期、剩余天数、当前阶段、项目数量与类型分布、每日可学时长。

```json
{
  "type": "function",
  "function": {
    "name": "get_user_profile",
    "description": "Get the user's basic study profile: exam anchor date, days left, current study stage, number and type of projects (exercise/recite/mistake), subject list, and daily available study minutes. Call this FIRST when the user asks an open-ended question about their overall situation before diving into any single project.",
    "parameters": {
      "type": "object",
      "properties": {},
      "required": []
    }
  }
}
```

- **后端实现**：`aggregator.getUserProfileSummary(userId)` + 读 `ai_configs.daily_study_minutes`；阶段按 `daysLeft>240 基础/强化期, >90 真题期, else 冲刺期`（复用 `buildLocalProfile` 口径）。
- **返回结构**：
  ```json
  {
    "examAnchor": "2027-12-26",
    "daysLeft": 446,
    "stage": "基础/强化期",
    "dailyStudyMinutes": 240,
    "projectCount": 3,
    "byType": { "exercise": 1, "recite": 1, "mistake": 1 },
    "subjects": ["math"],
    "projectNames": ["数学全书", "英语单词", "数学错题"]
  }
  ```
- **使用场景**：用户问「我现在整体进度怎么样？」「帮我看看复习安排合不合理」。

### 3.2 `get_projects_summary`

所有**未归档**项目的紧凑概览，用于回答「先救谁」「各项目进度对比」。

```json
{
  "type": "function",
  "function": {
    "name": "get_projects_summary",
    "description": "List all active (non-archived) projects with one-line progress each: type, name, subject, deadline, days left, and key metric (completion rate for exercise, mastery rate + due/backlog for recite, streaky count for mistake). Use this when the user compares projects or asks which subject to prioritize.",
    "parameters": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": ["exercise", "recite", "mistake"],
          "description": "Optional filter by project type."
        }
      },
      "required": []
    }
  }
}
```

- **后端实现**：`aggregator.projectList(store).map(aggregator.projectStats)`，按 `type` 过滤。
- **返回结构**：`{ "projects": [ {同 projectStats 的紧凑字段}, … ] }`（去掉 records/items 明细）。
- **使用场景**：用户问「我三个本哪个落后了？」「先救数学还是英语？」。

### 3.3 `get_project_detail`

单个项目的详细诊断：进度、缺口判断（exercise 的 status：落后/正常/超前）、薄弱章节（mistake 的 byUnit top5）、高危条目（recite 的 highRisk top10）。

```json
{
  "type": "function",
  "function": {
    "name": "get_project_detail",
    "description": "Get detailed diagnosis of ONE project by id: completion/mastery rate, pace gap vs deadline, weak units (for mistake book), high-risk entries about to be forgotten (for recite book). Always use a projectId returned by get_projects_summary.",
    "parameters": {
      "type": "object",
      "properties": {
        "projectId": { "type": "string", "description": "Project id from get_projects_summary." }
      },
      "required": ["projectId"]
    }
  }
}
```

- **后端实现**：
  - `aggregator.getProgressSummary(userId, projectId)`（带 status 判断）；
  - 若 `type==='mistake'`，附加 `getMistakeReport(userId, projectId)` 的 `byUnit.slice(0,5)` 与 `streakyTop.slice(0,5)`；
  - 若 `type==='recite'`，附加 `getReciteStatus(userId, projectId)` 的 `highRisk.slice(0,10)`。
- **返回结构**：`{ "found": true, "progress": {…projectStats+status}, "weakUnits": […], "highRisk": […] }`；项目不存在返回 `{ "found": false, "reason": "项目不存在" }`。
- **使用场景**：用户问「我的数学全书做到哪了？」「英语单词本背得怎么样？」。

### 3.4 `get_today_tasks`

今日待办任务清单：基于时间预算做全局调度，落后的刷题 + 到期背书 + 高危错题此消彼长分配。

```json
{
  "type": "function",
  "function": {
    "name": "get_today_tasks",
    "description": "Get today's study plan: which projects to work on, estimated minutes per block, and priority (P0/P1/P2), allocated within the time budget. Call when the user asks 'what should I do today' or 'plan my day'.",
    "parameters": {
      "type": "object",
      "properties": {
        "budgetMin": {
          "type": "number",
          "description": "Available minutes today. Omit to use the user's configured daily study minutes."
        }
      },
      "required": []
    }
  }
}
```

- **后端实现**：`aggregator.getTodayPlan(userId, budgetMin)`，budgetMin 缺省取 `ai_configs.daily_study_minutes`。
- **返回结构**：`{ "budgetMin": 240, "allocatedMin": 180, "plan": [ { "projectId":…, "name":…, "kind":"exercise|recite|mistake", "estMin":45, "priority":"P0" } ] }`。
- **使用场景**：用户问「今天该学什么？」「帮我排一下今天的任务」。

### 3.5 `get_weekly_stats`

近 N 天（默认 7 天）的学习量趋势：每天刷了多少页、背/错打了几次卡。

```json
{
  "type": "function",
  "function": {
    "name": "get_weekly_stats",
    "description": "Get study volume of the last N days (default 7): pages done per day (exercise), recite check-ins per day, mistake review check-ins per day. Use when the user asks about recent effort, rhythm, or whether they have been slacking.",
    "parameters": {
      "type": "object",
      "properties": {
        "days": { "type": "number", "description": "How many days back, default 7, max 30." }
      },
      "required": []
    }
  }
}
```

- **后端实现**（新增 helper，见 §3.13）：遍历 `projectList(store)` 的所有 records，按 `date` 聚合：exercise 累加 `endPage-startPage`，recite/mistake 每条 record 记 1 次打卡；补齐最近 N 天每天的键（无记录为 0）。
- **返回结构**：
  ```json
  {
    "days": [
      { "date": "2026-09-30", "exercisePages": 12, "reciteCheckins": 20, "mistakeCheckins": 5 },
      { "date": "2026-10-01", "exercisePages": 0,  "reciteCheckins": 0,  "mistakeCheckins": 0 }
    ],
    "totals": { "exercisePages": 60, "reciteCheckins": 120, "mistakeCheckins": 30 }
  }
  ```
- **使用场景**：用户问「我最近一周学了多少？」「我是不是这周摸鱼了？」。

### 3.6 `get_mistake_analysis`

错题薄弱点分析：错因标签分布、章节聚类、题型分布、顽固重错清单、伪掌握检测、跨年顽固题。

```json
{
  "type": "function",
  "function": {
    "name": "get_mistake_analysis",
    "description": "Analyze mistake books: error-tag distribution, weak units (by page range), question-type distribution, top repeated-mistake items (wrongStreak>=2), pseudo-mastered items, and cross-year stubborn items. Omit projectId to analyze ALL mistake books.",
    "parameters": {
      "type": "object",
      "properties": {
        "projectId": { "type": "string", "description": "Which mistake book. Omit to aggregate all mistake books." }
      },
      "required": []
    }
  }
}
```

- **后端实现**：`aggregator.getMistakeReport(userId, projectId || undefined)`。
- **返回结构**：即 `getMistakeReport` 原样（`errTagDist/byUnit/byQuestionType/semanticTop/streakyTop/pseudoMastered/crossYear`）；无错题本返回 `{ "found": false, "reason": "暂无错题项目" }`。
- **使用场景**：用户问「我哪类题总错？」「高数错题主要集中在第几章？」。

### 3.7 `get_recite_status`

背书本状态总览：今日到期数、逾期积压、掌握率、高危条目（上次反馈是模糊/忘记的）。

```json
{
  "type": "function",
  "function": {
    "name": "get_recite_status",
    "description": "Get recite book status: total items, mastery rate, how many items are due today, how many are overdue backlog, and high-risk entries whose last review result was 'forget/fuzzy'. Omit projectId to aggregate all recite books.",
    "parameters": {
      "type": "object",
      "properties": {
        "projectId": { "type": "string", "description": "Which recite book. Omit to aggregate all recite books." }
      },
      "required": []
    }
  }
}
```

- **后端实现**：`aggregator.getReciteStatus(userId, projectId || undefined)`。
- **返回结构**：
  ```json
  {
    "found": true, "total": 320, "mastered": 80, "masteryRate": 25.0,
    "dueToday": 24, "backlog": 6,
    "highRisk": [ { "content": "……截40字", "nextDay": "2026-10-07" } ]
  }
  ```
- **使用场景**：用户问「我今天有多少要背的？」「英语单词积压多少了？」「哪些单词快忘光了？」。

### 3.8 `get_paper_trend`

刷题本（套卷）趋势：逐套分数、各 section 用时与正确率。

```json
{
  "type": "function",
  "function": {
    "name": "get_paper_trend",
    "description": "Get score trend of an exercise project: each practice paper's score, per-section scores and time spent. Use when the user asks about recent paper performance, score trend, or which section is weak.",
    "parameters": {
      "type": "object",
      "properties": {
        "projectId": { "type": "string", "description": "Which exercise project (must be a paper-based exercise book)." }
      },
      "required": ["projectId"]
    }
  }
}
```

- **后端实现**：`aggregator.getPaperTrend(userId, projectId)`。
- **返回结构**：
  ```json
  {
    "found": true, "projectName": "数学真题", "hasScore": true,
    "points": [
      { "seq": 1, "date": "2026-09-20", "score": 95,
        "sections": [ { "name": "选择", "score": 40, "timeMin": 40 } ] }
    ],
    "hint": ""
  }
  ```
  若 records 未录 score/sections，`hasScore=false` 且 `hint` 提示「该项目记录尚未录入 score 字段」。
- **使用场景**：用户问「我最近真题分数怎么样？」「数学选择是不是在拖后腿？」。

### 3.9 `get_multi_subject_balance`

多科目均衡视图：全部项目统一算紧迫度，回答「先救谁」。

```json
{
  "type": "function",
  "function": {
    "name": "get_multi_subject_balance",
    "description": "Compare all projects by urgency: which ones are behind pace (exercise gap, recite backlog, repeated-mistake count), which are on track or ahead. Use when the user asks which subject to prioritize or feels overwhelmed.",
    "parameters": {
      "type": "object",
      "properties": {},
      "required": []
    }
  }
}
```

- **后端实现**：`aggregator.getMultiSubjectBalance(userId)`。
- **返回结构**：
  ```json
  {
    "today": "2026-10-06",
    "rows": [
      { "id":"p1", "name":"数学全书", "type":"exercise", "status":"落后",
        "requiredRate": 0.9, "actualRate": 0.7, "gap": -22.2, "urgency": 22.2 }
    ],
    "behind": ["数学全书"], "ahead": []
  }
  ```
- **使用场景**：用户问「我时间有限先学哪科？」「我现在是不是数学落太多了？」。

### 3.10 `get_study_records`

近期打卡/学习记录明细（最新在前），用于回答「我最近哪天学了什么」。

```json
{
  "type": "function",
  "function": {
    "name": "get_study_records",
    "description": "Get recent check-in records (most recent first): date, project name, what was done (page range for exercise, check-in for recite/mistake). Use when the user asks what they did recently or to verify a specific day.",
    "parameters": {
      "type": "object",
      "properties": {
        "projectId": { "type": "string", "description": "Filter to one project. Omit for all projects." },
        "limit": { "type": "number", "description": "Max records, default 10, max 30." }
      },
      "required": []
    }
  }
}
```

- **后端实现**（新增 helper，见 §3.13）：收集 `projectList(store)`（或单项目）的 records，每条补上 `projectName` 与 `projectType`，按 `date` 倒序截取 limit。
- **返回结构**：
  ```json
  {
    "records": [
      { "date": "2026-10-05", "projectName": "数学全书", "projectType": "exercise",
        "detail": "P120-P135" },
      { "date": "2026-10-05", "projectName": "英语单词", "projectType": "recite", "detail": "打卡" }
    ]
  }
  ```
- **使用场景**：用户问「我上周末学了啥？」「我 10 月 3 号那天进度录了吗？」。

### 3.11 `generate_schedule`

基于当前数据和目标日期生成结构化排期建议：今日分配 + 各项目按当前速率的完成时间投影。**纯查询**，AI 只负责把结果用人话讲出来，不直接写库。

```json
{
  "type": "function",
  "function": {
    "name": "generate_schedule",
    "description": "Generate a structured schedule proposal: today's minute allocation PLUS a projection of when each project will finish at the current pace vs the deadline. Use when the user asks 'can I finish in time' or 'make me a plan'. This is READ-ONLY analysis returned as data; the AI only narrates it, nothing is written to the store.",
    "parameters": {
      "type": "object",
      "properties": {
        "budgetMin": { "type": "number", "description": "Daily available minutes. Omit to use configured default." }
      },
      "required": []
    }
  }
}
```

- **后端实现**（新增 helper，见 §3.13）：
  1. `aggregator.getTodayPlan(userId, budgetMin)`；
  2. 对每个 exercise 项目算 `daysToFinish = remain / recent7Rate`（rate≤0 时给 `null` 并标注「近 7 天无产出」）；
  3. recite 项目给 `masteryRate` 与 `backlog` 消化天数估计。
- **返回结构**：
  ```json
  {
    "today": { "budgetMin": 240, "allocatedMin": 180, "plan": […] },
    "projection": [
      { "projectId": "p1", "name": "数学全书", "type": "exercise",
        "remainingPages": 400, "requiredRate": 0.9, "actualRate": 0.7,
        "daysToFinishAtCurrentPace": 571, "deadlineGap": "落后" }
    ],
    "overallVerdict": "按当前速率，数学全书将比截止日晚约 120 天完成，需要提速或调整目标。"
  }
  ```
  （`overallVerdict` 由后端按规则拼好中文短句，不让模型自己编数字。）
- **使用场景**：用户问「来得及吗？」「帮我做个到考前的计划」。注意：本工具**只出建议数据**，不写库；若用户听完想调舒适量，仍由 AI 输出现有 `adjust_daily_comfort` action 卡片。

### 3.12 `get_review_forecast`

未来 N 天（默认 7 天）复习压力预测：每天有多少背书/错题到期，是否有堆积风险。

```json
{
  "type": "function",
  "function": {
    "name": "get_review_forecast",
    "description": "Forecast review load for the next N days (default 7): how many recite and mistake items come due each day, to spot coming backlog. Use when the user asks 'will review pile up soon' or 'how busy will next week be'.",
    "parameters": {
      "type": "object",
      "properties": {
        "days": { "type": "number", "description": "How many days ahead, default 7, max 21." }
      },
      "required": []
    }
  }
}
```

- **后端实现**（新增 helper，见 §3.13）：遍历所有 recite/mistake 项目的未掌握 items，用现有 `nextReviewDay(item, intervals)` 算每个条目的下次复习日，按日聚合条数；与 `dailyComfort` 对比标记「超额日」。
- **返回结构**：
  ```json
  {
    "days": [
      { "date": "2026-10-07", "dueRecite": 24, "dueMistake": 8, "overComfort": false },
      { "date": "2026-10-08", "dueRecite": 40, "dueMistake": 12, "overComfort": true }
    ],
    "peakDate": "2026-10-08",
    "peakLoad": 52
  }
  ```
- **使用场景**：用户问「下周复习会堆起来吗？」「我哪天会被复习压垮？」。

### 3.13 新增 helper 实现要点（写在 `aiDataAggregator.js` 里）

```js
// getWeeklyStats(userId, days=7)
//   遍历 projectList(store) → records，按 r.date 聚合 exercisePages / reciteCheckins / mistakeCheckins
//   补最近 days 天每天的 0 填充，返回 { days:[{date,exercisePages,reciteCheckins,mistakeCheckins}], totals }

// getRecentRecords(userId, projectId?, limit=10)
//   收集 records，补 projectName/projectType/detail（exercise: `P${startPage}-P${endPage}`；其余: '打卡'）
//   按 date 倒序，slice(0, limit)

// generateSchedule(userId, budgetMin)
//   today = getTodayPlan(userId, budgetMin)
//   projection = projectList(store).map(projectStats) 后按 type 算 daysToFinish / backlogDays
//   overallVerdict 规则：存在 gap<-20 的 exercise → "按当前速率，{name}将比截止日晚约 X 天…"

// getReviewForecast(userId, days=7)
//   遍历 recite/mistake 项目未掌握 items，复用 nextReviewDay(item, intervals) 算下次复习日
//   按日聚合 dueRecite / dueMistake，与 project.dailyComfort 对比标 overComfort
//   返回 { days:[{date,dueRecite,dueMistake,overComfort}], peakDate, peakLoad }
```

四个 helper 都要包进现有 `safe()` 防御包装里导出。

---

## 4. 修改 / 创建类 Action 清单

### 4.1 结论：不新增，沿用现有机制

Function Calling **不引入任何新的修改/创建类 action**。现有 action 机制完全不变：

- `ACTION_WHITELIST` 仍只有 `adjust_daily_comfort` 一个 op；
- AI 仍在回复末尾输出 ```actions JSON 块；
- `parseReply` / `filterValidActions` 逻辑不变；
- 前端仍渲染 `.ai-suggest` 建议卡片，用户点「应用」后前端改写 store；
- `POST /api/ai/apply` 上报 inverse、`POST /api/ai/undo` 回滚，协议不变。

### 4.2 为什么不扩展

- 修改类操作必须用户确认，走卡片是对的，但把截止日、归档、标记掌握、新建项目都塞进 AI 对话，会让「聊天框」变成「后台管理台」，违背纸感学院派的克制调性；
- 这些操作在项目主界面已有更顺手的入口（项目设置、条目长按菜单），AI 只负责在对话里**用文字建议**（例如「你可以把截止日往后调两周」），用户自己去主界面改；
- 唯一已经跑通、且确实需要 AI 给量化建议的，就是 `adjust_daily_comfort`（舒适量直接影响自动排期，AI 看到复习积压后给个具体数字最自然）。

### 4.3 AI 被问到改设置时的话术规范（写进系统 Prompt）

- 用户说「帮我调一下截止日 / 归档这个项目 / 标记这题为掌握」→ AI 用文字说明**去哪改**（「在项目设置里可以改截止日」「长按那条错题就能标记掌握」），**不输出 actions 块**；
- 只有当用户明确表达「复习太多每天做不完，帮我调舒适量」这类节奏问题时，才输出 `adjust_daily_comfort` action 卡片；
- 不要主动建议延后截止日（现有规则保留）。

---

## 5. API 响应契约（`POST /api/ai/chat`）

### 5.1 现状响应

```json
{
  "ok": true,
  "data": {
    "conversationId": 12,
    "messageId": 345,
    "reply": "……",
    "intent": "progress_query",
    "actions": [ {op, projectId, label, reason, …} ],
    "tokens": { "in": 1200, "out": 350 },
    "profileUpdated": false
  }
}
```

### 5.2 扩展后响应（新增 `toolCalls`，其余字段位置不变）

```json
{
  "ok": true,
  "data": {
    "conversationId": 12,
    "messageId": 345,
    "reply": "……（最终自然语言回复，不变）",
    "intent": "progress_query",
    "actions": [ …（仍只可能是 adjust_daily_comfort，不变） ],
    "tokens": { "in": 2400, "out": 350 },
    "profileUpdated": false,
    "toolCalls": [
      {
        "seq": 1,
        "name": "get_projects_summary",
        "label": "查看所有项目进度",
        "status": "ok",
        "durationMs": 12
      },
      {
        "seq": 2,
        "name": "get_project_detail",
        "label": "查看《数学全书》详情",
        "status": "ok",
        "durationMs": 8
      }
    ]
  }
}
```

字段说明：
- `toolCalls`：本次对话 AI 实际调用过的只读工具 trace，**仅用于前端展示过程**，不带任何原始参数/返回 JSON。
- `label`：由后端按工具名+参数预生成的中文短句（映射表见 §6.2），不是模型输出的。
- `status`：`ok` / `error`；`error` 时带 `error:"友好文案"`，前端展示失败但不阻断最终回复。
- `durationMs`：该工具执行耗时（本地读 SQLite，通常 <20ms）。
- 若模型一轮就答、没调任何工具，`toolCalls` 为 `[]`，前端不显示过程区。

### 5.3 单次响应 vs SSE 的取舍

**本版本采用「后端跑完整循环 + 单次响应带 trace」**，理由：
- 现有前端是 `fetch` 单次取 JSON，改 SSE 要动整个消息渲染层，成本高；
- 工具执行是本地 SQLite 查询（毫秒级），耗时主要在模型第二轮往返，单次响应只是用户多等 1~3 秒。

预留升级位（未来）：若后续要做「流式逐步显示」，把 `toolCalls` 改成 SSE 的 `event: tool` 帧即可，字段结构不变；单次响应模式保持兼容。

---

## 6. UX 流程规范

### 6.1 展示位置与样式

- 在最终 `reply` 正文**上方**、用户气泡与 AI 回复之间，插入一个折叠区：
  - 默认态：一行小字「AI 查询了 2 项学习数据 ▸」（纸感学院派风格：灰色小字、细线分隔、无渐变无彩色块）。
  - 展开态：列出每次工具的中文 label，前面带序号与完成勾；失败项标灰并显示友好文案。
- **绝不暴露**：工具英文 name、原始 JSON、参数对象、SQL、返回数据。用户看到的只有中文短句。
- actions 建议卡片位置不变（仍在回复正文下方，`.ai-suggest` 渲染逻辑沿用）。

### 6.2 工具名 → 中文 label 映射表（后端生成 trace 时用）

| 工具 | label 模板 |
|---|---|
| `get_user_profile` | 查看你的整体学习画像 |
| `get_projects_summary` | 查看所有项目进度 |
| `get_project_detail` | 查看《{projectName}》详情 |
| `get_today_tasks` | 生成今日任务清单 |
| `get_weekly_stats` | 统计近 {days} 天学习量 |
| `get_mistake_analysis` | 分析错题薄弱点（{项目名\|全部错题本}） |
| `get_recite_status` | 查看背诵状态（{项目名\|全部背书本}） |
| `get_paper_trend` | 查看《{projectName}》分数趋势 |
| `get_multi_subject_balance` | 对比各科紧迫度 |
| `get_study_records` | 查看近期打卡记录 |
| `generate_schedule` | 计算排期与完成时间投影 |
| `get_review_forecast` | 预测未来 {days} 天复习压力 |

### 6.3 多轮调用进度指示

- HTTP 请求进行中：前端原有的「AI 正在思考…」loading 不变；
- 响应回来后：`toolCalls.length` 即步数，折叠区标题写「AI 查询了 N 项学习数据」；
- 单步失败：该项显示「查看《X》详情失败，已跳过」，不弹错误框，不影响最终回复。

### 6.4 过程与结果的关系

- **工具调用 = 过程**（只读、自动、不需确认）；
- **action 卡片 = 结果建议**（仅 `adjust_daily_comfort`，必须用户点「应用」）。
- 折叠区可折叠、可默认收起，不干扰阅读正文。

---

## 7. 降级策略

### 7.1 模型不支持 function calling

1. `ai_configs` 新增列 `tools_enabled INTEGER NOT NULL DEFAULT 1`。
2. `/chat` 流程：
   - `tools_enabled=1` 时带 `tools` 参数调一次；
   - 若上游返回 400 且错误信息含 `tools` / `function` / `unknown parameter` 字样 → 自动把该用户 `tools_enabled` 置 0，并**回退到现有模式**：按意图 `gatherDataByIntent` 注入数据摘要，不带 tools 重调一次；
   - 回退后响应里 `toolCalls: []`，并带 `degraded: 'tools_unsupported'` 标记（前端可静默，不打扰用户）。
3. 每次对话开始都先看 `tools_enabled`，被自动关闭后除非用户在设置里手动打开，否则一直走注入模式。

### 7.2 工具执行失败

- 单个工具抛错 → trace 记 `status:'error'`，喂给模型的 tool 消息内容为 `{"error":"该数据暂时读不到"}`，让模型基于已有数据继续答；
- 全部工具失败且模型第一轮就要工具 → 等同降级，直接回退注入模式。

### 7.3 超 token 预算

沿用现有 `overBudget` 分支：不调模型，直接本地返回数据摘要 + 提示文案（现有逻辑不变）。

---

## 8. 成本控制规范

### 8.1 什么时候必须调工具（写进系统 Prompt）

- 用户问题**指代他自己的具体数据**时：「我进度/排名/今天学什么/哪章错得多/来得及吗/分数趋势」→ 必须先调工具再答，不许凭印象编数字。

### 8.2 什么时候直接答（不许调工具）

- 学习方法、心态、作息、记忆原理等通用建议；
- 寒暄、鼓励、情绪疏导；
- 上一轮刚查过、本轮只是追问同一数据的细节（对话历史里已有结论）。

### 8.3 防重复调用

- **请求内去重**：后端对同一 `toolName + 参数 JSON` 在本次 chat 请求内做缓存 Map，第二次直接返回同结果，不二次读 store；
- **系统 Prompt 约束**：告诉模型「`get_user_profile` 与 `get_projects_summary` 二选一即可，不要两个都调」「`get_today_tasks` 已含今日计划，不要重复调 `get_projects_summary`」「分析错题用 `get_mistake_analysis`，不要先用 `get_project_detail` 再问一次」；
- **硬上限**：单次请求最多 5 轮工具循环、最多 12 次工具调用，超出后强制让模型基于已有信息收尾。

### 8.4 token 记账

- 工具往返产生的额外 prompt tokens 一并计入 `usage.prompt_tokens`，走现有 `bumpUsage`，受 `daily_token_budget` 约束。

---

## 9. 安全校验清单

### 9.1 只读工具通用校验

| 校验项 | 规则 |
|---|---|
| 用户隔离 | userId 只从 `req.user.id` 注入，工具参数永不接受用户标识 |
| projectId | 命中 `store.projects` 才执行，否则返回 `{found:false, reason:'项目不存在'}`；且只从 `projectList(store)` 查，归档项目也查得到（详情类需要），但概览类自动过滤归档 |
| limit / days | `get_weekly_stats.days`、`get_review_forecast.days` 夹在 1~30/21；`get_study_records.limit` 夹在 1~30 |
| 敏感字段 | 工具返回值永远不含 `password / email / encrypted_api_key / jwt`；只读 `user_data.store_json` 与 `ai_configs.daily_study_minutes`，绝不 SELECT users 表其他列 |
| 输入消毒 | 所有字符串参数 trim；数字参数 `Number()` 转换后 `Number.isFinite` 校验，非法值用缺省 |

### 9.2 现有 adjust_daily_comfort action 校验

沿用 `filterValidActions` 现有逻辑，不放宽：
- `op` 必须在 `ACTION_WHITELIST`（目前仅这一个）；
- `projectId` 必须命中 `store.projects`；
- `value` 为正整数（现有前端卡片生成时已夹范围，后端透传不做二次夹，但拒绝非数字/负数）。

### 9.3 绝对红线

- **不提供任何删除用户数据的工具或 action**；
- 不提供任何新建/修改项目、条目的工具或 action（本版本明确不做）；
- 不触碰密码、邮箱、API Key、JWT；
- 不访问其他用户数据（所有查询强制 `WHERE user_id = req.user.id`）；
- action 落库前再过一遍 `filterValidActions`，模型 hallucinate 出白名单外 op 直接丢弃。

---

## 10. 落地检查单（编码时对照）

- [ ] `aiProxy.callLLM`：opts 增加 `tools`，请求体带 `tools` / `tool_choice`；返回增加 `toolCalls:[{id,name,arguments}]`、`message` 原文。
- [ ] `aiDataAggregator`：新增 `getWeeklyStats` / `getRecentRecords` / `generateSchedule` / `getReviewForecast` 并包 `safe()` 导出。
- [ ] 新增 `backend/utils/aiTools.js`：集中放 12 个工具的 schema、`executeReadonlyTool(name, args, userId)` 分发、trace label 生成。
- [ ] `routes/ai.js` `/chat`：改为 §1.2 循环；响应加 `toolCalls`；`tools_enabled` 自动降级分支。
- [ ] `aiPrompt.js`：系统 Prompt 加工具使用规范（§8.1/8.2/8.3）与「改设置类问题用文字指路、不输出 actions」规范（§4.3）；`ACTION_WHITELIST` 保持不变。
- [ ] 前端：折叠区组件（§6.1）；action 卡片渲染逻辑不变。
- [ ] 数据库迁移：`ALTER TABLE ai_configs ADD COLUMN tools_enabled INTEGER NOT NULL DEFAULT 1`。
