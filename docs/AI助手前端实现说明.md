# AI 助手前端实现说明（M1）

| 项 | 内容 |
|---|---|
| 日期 | 2026-10-05 |
| 范围 | Study Tracker AI 助手完整前端（入口 + 三 Tab 抽屉 + 对话 + 建议卡应用/撤销 + 设置 + 红点巡检） |
| 基线 | 纯原生 JS 单文件、复用现有「纸感学院派」视觉与 CSS 变量 |

---

## 一、修改了哪些文件

| 文件 | 改动 |
|---|---|
| `frontend/index.html` | ① body 末尾追加「右下角 FAB 入口 + AI 抽屉（`#aiMask`/`.ai-drawer`）」整段 HTML；② `style.css` 版本号 `20261005c → 20261006-ai`；③ `app.js` 版本号 `20261005d → 20261006-ai`。**未改动主导航、未在全局设置页加任何 AI 内容**。 |
| `frontend/css/style.css` | 文件末尾追加 `/* ===== AI 助手 ===== */` 分节（约 230 行）。仅补 4 个语义别名 `--ai-bubble-ai / --ai-bubble-user / --ai-tint / --ai-ring`（浅/深色各一套），其余全部引用现有变量；未改任何现有变量值。 |
| `frontend/js/app.js` | 文件末尾追加一个自包含 IIFE `(function AIModule(){...})()`，**不改动任何现有函数**，复用全局 `$ / esc / saveStore / render / showToast / lockBodyScroll / unlockBodyScroll / store / genId / todayStr / cur / STAuth`。 |
| `frontend/sw.js` | `CACHE: yystudy-v35 → yystudy-v36`，并补一行 v36 注释。 |

---

## 二、实现了哪些功能

### 1. 入口
- 右下角 36px 圆形浮动按钮 `#aiFab`（✨图标），`z-index:120`，纸感卡片底 + 阴影，hover `scale(1.06)`、active `scale(.94)`，≤150ms 过渡。
- 右上角 8px 红点 `#aiFabDot`（`var(--bad)` + 卡片色描边），淡入 150ms；打开面板即消。

### 2. 面板开合（复用 `.drawer-mask`）
- `#aiMask`（z-index 130）遮罩 + `.ai-drawer`（max-width 400px）三段式 flex：头部固定 / Tab+内容滚动 / 输入区固定。
- 点 FAB 开合、点遮罩关闭、`Esc` 关闭，配合 `lockBodyScroll/unlockBodyScroll`。

### 3. 三 Tab
- **对话 / 历史 / 设置** 分段控件（复刻 `.pct-chip.active` 选中手感），`hidden` 切换无滑动动效。

### 4. 对话 Tab
- 发送消息 → 用户右对齐气泡 → 三点打字指示器 → `POST /api/ai/chat`（一次性返回，非流式）。
- 回复走轻量 markdown 渲染（先 `esc` 防注入，再处理代码块/行内代码/加粗/链接/无序列表/换行）。
- 自动把当前打开项目作为 `context.projectId`、时间 chips（1h/2h/4h/全天）作为 `context.budgetMin` 带入。
- 空输入本地拦截；按后端 `code` 渲染友好错误气泡，并附「重试 / 去设置」按钮（NOT_CONFIGURED、INVALID_KEY 跳设置；TIMEOUT/UPSTREAM_ERROR/NETWORK 可重试）。
- 未配置 Key 时对话区显示 🔑 空态 + 「去设置」。

### 5. 建议卡片（核心）
- 每条 action 一行：勾选框（默认全选）+ 人话 label + 「约 Xmin」小字；不支持的 op 不渲染勾选框，仅作纯文本建议。
- 「全选/清空」+「应用选中 N 条 →」。
- 应用：前端把选中 action 映射为对 `store` 的真实修改（`adjust_daily_capacity`→写 `project.dailyCapacity`；`adjust_deadline`→写 `project.deadline`；`create_project`→新建项目对象；`add_recite_items`→向背书本 push 条目），随后 `saveStore() + render()`，再 `POST /api/ai/apply` 上报（带 storeSigBefore/After）。
- 应用成功：按钮变「↩ 已应用 · 撤销」；点击 `POST /api/ai/undo`，把后端返回的 `inverse` 当新修改应用回 store → `saveStore() + render()`，卡片淡化为「已撤销 · 改动已回滚」。
- 轻提示复用全局 `showToast`。

### 6. 历史 Tab
- `GET /api/ai/conversations` 列表（标题/末条预览/相对时间），点击载入消息、🗑 删除（confirm 后 DELETE）、「＋新会话」。

### 7. 设置 Tab（最终版）
- 服务商下拉（DeepSeek/智谱AI/通义千问/OpenAI/Kimi，来自 `/api/ai/providers`）。
- API Key 密码框 + 眼睛切换 + 「密钥仅加密存储，不会泄露」小字。
- 模型下拉联动服务商，完整模型名，推荐模型后加「· 推荐」。
- 「测试连接」→ `/api/ai/config/test`，成功绿字「✓ 连接成功（Xms）」，失败红字。
- 「如何获取 API key？」折叠教程（DeepSeek 文案原样，链接 `target=_blank`）。
- 每日 token 预算数字框（默认 100000）。
- 用量：今日已用 / 预算 + 进度条（>100% 变红）+ 累计，附「消耗为系统估算值…」小字。
- 「你的学习数据会发送给AI服务商…」告知行。
- 红色「清空全部对话历史」（confirm 后 `DELETE /conversations/all`）。
- 「保存」→ `PUT /api/ai/config`，成功「✓ 已保存」。

### 8. 主动触达红点（本地巡检，零 token）
- 页面加载 1.5s 后读 `store`：连续 3 天无任何打卡记录，或某项目 deadline 7 天内但完成量不足 30% → 点亮红点。
- 不弹窗、不横幅、不声音。

---

## 三、自测结果

| 项 | 结果 |
|---|---|
| `node --check app.js` / `sw.js` | 通过（语法 OK） |
| style.css 大括号配平 | 1566/1566 平衡 |
| AI 模块引用的静态元素 ID 与 index.html 交叉核对 | 全部命中（`aiTyping` 为运行时动态创建，符合预期） |
| HTML 块 div 配平 | 平衡（抽屉容器 → aside → 遮罩关闭标签逐层闭合） |
| 版本号一致 | style.css / app.js 均为 `20261006-ai`；`sw.js` CACHE=`yystudy-v36` |
| 深浅色 | 全部走现有 CSS 变量 + 4 个 `--ai-*` 别名（深色块补值），无硬编码色 |
| 现有功能影响 | 所有新增代码追加在文件末尾，未改任何现有函数/导航/全局设置页 |

> 说明：本环境无后端与登录态，未做端到端「真 key 对话」联调；假 key 的错误提示路径已按 `code` 字段映射实现，需在有后端的环境里用真 key/假 key 各跑一次确认。

---

## 四、已知限制

1. **非流式**：按后端约定一次性返回，等待期只显示三点打字指示器，无逐字输出（M1 范围内）。
2. **action 映射为最小可用实现**：`create_project` 用最小项目骨架（缺省 `dailyComfort/intervals` 等），未走新建表单的全部字段；`add_recite_items` 仅 push 基础条目，未做智能排期。复杂 op（`compare_plans`、`mark_units_optional` 等）按纯文本建议渲染，不进勾选。
3. **messageId 透传**：chat 响应体未明确含 messageId，前端透传 `resp.messageId || resp.id`，缺失时传 `null`；后端 apply 仍可落 action_log（以 selected + 签名为主）。
4. **锚定项目**：打开面板时自动取当前 `store.currentId` 作为锚定并显示 chip，未做面板内点击切换/清除锚定（M2 可补）。
5. **L0 本地接口**（summary/mistake-report/balance/today-plan）与画像编辑页、超 token 横幅降级路径未在 M1 接入，留待后续。
6. **红点巡检**为本地粗算（记录日期 + deadline/总量），未与后端主动触达规则对齐，仅作低噪提醒。

---

## 五、体验评审问题修复记录（2026-10-05）

| # | 问题 | 修复方式 |
|---|---|---|
| 1 | apply 时 messageId 为 null | chat 响应后读取 `resp.messageId \|\| resp.id` 存入建议卡 rec；调 `/api/ai/apply` 时回传；旧版无 messageId 时退化为 null 并注释说明 |
| 2 | apply 先改本地再调 API，失败时数据已改无撤销 | 改为**先上报后端**（拿 actionLogId+inverse），**成功后才** `applyAction→saveStore→render`；失败时本地 store 保持原样，仅复位按钮并 toast 报错 |
| 3 | SUPPORTED_OPS 仅 6 个，v2 新 op 不支持 | 白名单扩到 12 个；新增实现 `create_review_list`（错题→背书本）、`defer_low_risk_items`（顺延 nextReviewDate，复用全局 `addDays`）、`mark_units_optional`（units 标 `optional=true`）、`create_mock_paper_project`、`compress_intervals`（写 intervals 数组）、`lower_mastered_freq`（置 `lowFreqExtended=true`） |
| 4 | 「全天」chip data-min=0 被后端回退 240 | 改为 `data-min="720"`（12h，考研党全天上限） |
| 5 | 不支持的 op 被静默忽略 | 不支持的 op 仍渲染为一行，但 checkbox `disabled` 置灰，旁边加「暂不支持一键应用」灰色小胶囊；全选/计数/应用按钮均只统计 `:not(:disabled)` 的可应用行 |

复测：`node --check app.js` 通过；style.css 大括号 1569/1569 平衡；新 op 分支对缺省字段做了防御（无 project/无 items/无 units 时安全跳过）。

---

## 六、技术+审美复审 P0/P1 修复记录（2026-10-05 第二轮）

| 级别 | 问题 | 修复方式 |
|---|---|---|
| 🔴 P0-H2 | 撤销是假操作：后端 `selected.filter(a=>a.inverse)` 恒为空，store 不回滚却提示「已撤销」 | 新增 `prepareAction(a)`：改 store **之前**读旧值、预分配 projectId/item id，并构造 inverse 挂回 `a.inverse`。覆盖：adjust_daily_capacity（存旧值）、adjust_deadline（存旧值）、create_*/create_review_list（inverse=delete_project）、add_recite_items（inverse=delete_recite_items+新 itemIds）、defer_low_risk_items（inverse=restore_item_review_dates，存旧 nextReviewDate）、mark_units_optional（inverse=restore_units_optional，存旧 optional）、compress_intervals（存旧 intervals）、lower_mastered_freq（存旧 lowFreqExtended）。applyAction 新增对应 inverse op 的回滚分支。 |
| 🟠 P1 | storeSigAfter 错填成 storeSigBefore | applySelected 改为：prepareAction → sigBefore → applyAction 改 store → **重新** JSON.stringify 得 sigAfter → 带 inverse 调 /api/ai/apply。失败时用已算好的 inverse 逆序回滚本地再 saveStore/render，不留脏数据。 |
| 🟠 审美 P1-1 | 未配 Key 时输入框/时间 chips 仍亮着 | 新增 `hasKeyConfigured()` + `updateInputVisibility()`；输入区仅在「对话 Tab 且已配 Key」时显示，未配 Key 只留空态引导。 |
| 🟠 审美 P1-2 | 触控目标不足 44px | CSS 追加：#aiFab 44px、.ai-send 44px、.ai-tab min-height 44px、.ai-eye / .hi-del ≥36~44px 命中区、checkbox 放大到 20px 并加 padding。 |

复测：`node --check app.js` 通过；CSS 大括号 1575/1575 平衡；undo 路径（/api/ai/undo 返回 inverse → applyAction 回滚）对全部支持 op 闭环。

---

## 七、用户验收第三轮：体验+移动端修复（2026-10-05 第三轮，版本 v37 / ?v=20261006-ai2）

| # | 问题 | 修复方式 |
|---|---|---|
| #3 | 发消息收不到回复 | `send()` 重构：新增 `renderAiReply(text)`，md() 包 try/catch 失败退化为纯文本；空 reply 判「AI 返回了空回复，请重试」；typing 在 try/catch/finally 路径都保证移除 |
| #1 | 视角切换 | 输入区顶部加三按钮「全局/当前项目/多选项目」，state.perspective；send() 按视角组装 context：global 不传、current 传 projectId（无项目则提示）、multi 传 projectIds 数组；#aiPerspHint 实时显示当前视角，#aiMultiList 弹项目 checkbox 列表 |
| #2 | Key 眼睛按钮 | 登录页密码框本就无眼睛，AI Key 保留单一 #aiKeyToggle 👁，无重复 |
| #6 | FAB 图标 | ✨ 改为品牌底白字「AI」圆角按钮（.ai-fab-text），红点保留，hover 提示 |
| #7 | 示例问题 | 内置 10 条考研场景问句，空对话时随机显示 3~4 个胶囊，点击直接 send；打开面板/新会话随机换一批（#aiSamples） |
| #8 | 保存/测试反馈 | 保存成功按钮临时「✓ 已保存」2s + showToast「设置已保存」，停留设置页；测试连接按钮「测试中…」disabled 态 + 成功/失败 toast |
| #9 | 学习时长 | 弃用固定 chips，改为自由数字输入框（0.5–16h，步进0.5，clamp）+ 2h/4h/6h/8h 快捷按钮；恰好命中快捷值才高亮；发送时 budgetMin = 小时×60 |
| #10 | markdown 重写 | md() 改块级解析：标题 h1-h3、有序/嵌套列表、表格（边框+表头加粗）、引用 blockquote、斜体、分割线 hr、段落 p；代码块右上角「复制」按钮（事件委托，clipboard+execCommand 兜底）；长回复 >500 字折叠前 300px +「展开全文/收起」；配套排版 CSS 全部走变量（新增 --ai-code-bg，深浅色各一值） |
| #11/#12 | 手机端收不到回复、时长点不动 | **根因**：基础 `.drawer` 为 `height:100%`（=整个布局视口，手机上含地址栏下方），导致 AI 抽屉比可视区高，底部输入区/时长行被顶到可视区外。修复：`.ai-drawer` 改 `height:100vh; height:100dvh; overflow:hidden`，只让 `.ai-body` 滚动；输入区已有 safe-area 底部留白 |
| #13 | 推荐更高级模型 | 后端 aiProviders.js 推荐标记本已正确（deepseek-v4-pro / glm-4-air / qwen-plus / gpt-4o / kimi-k2-thinking）；前端 fillModels 增加 MODEL_DESC 短标签（推荐·质量高 / 省钱·速度快 等），默认选中推荐模型 |

复测：`node --check app.js` 通过；CSS 大括号 1616/1616 平衡；新 ID（aiPerspHint/aiMultiList/aiBudgetHours/aiSamples 等）与 index.html 交叉核对全部存在；版本号 index.html `?v=20261006-ai2`、sw.js `yystudy-v37`。

已知限制：md() 不支持深层嵌套列表缩进层级（只区分 ul/ol 一级）；打字机逐字效果按需求兜底为整段淡入显示（避免破坏 markdown 时序）；数据来源「📊来自你的数据」标签未实现（需后端标注）。
