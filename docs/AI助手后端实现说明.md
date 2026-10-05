# AI 助手后端实现说明（M1+M2 P0）

> 本文记录 Study Tracker 后端 AI 助手的最终落地状态：文件清单、接口、安全/错误码约定、自测结果与已知偏差。

## 一、新建文件

| 文件 | 作用 |
|---|---|
| `backend/utils/aiCrypto.js` | AES-256-GCM 加解密。主密钥由 `JWT_SECRET` + 用户 salt 经 scrypt 派生；每用户 12 字节随机 salt；密文格式 `iv:tag:cipher`（base64）。导出 `encrypt/decrypt/generateSalt/previewOf`（preview 前4后4）。 |
| `backend/utils/aiProviders.js` | 服务商注册表（5 家，OpenAI 兼容）。导出 `getProvider/listProviders/modelBelongsTo`。**无自动切模**，用户选哪个模型就用哪个。 |
| `backend/utils/aiProxy.js` | 通用 LLM 代理调用（POST `{baseUrl}/chat/completions`）。30s 超时、SSRF 防护（仅 https、解析后 IP 拒绝内网段）、统一错误挂 `aiCode/aiMessage/aiDetail`。 |
| `backend/utils/aiIntent.js` | 本地规则意图分类（10 类，不走大模型）。导出 `classify(message, context) → {intent, confidence, projectIdHint}`。 |
| `backend/utils/aiDataAggregator.js` | 从 `user_data.store_json` 精准聚合（只读 store，不碰 users 敏感字段）。导出画像/进度/错题/套卷/背书/多科平衡/今日计划等函数。 |
| `backend/utils/aiPrompt.js` | 系统/用户 prompt 构建、`<learning_data>` 包裹防注入、回复解析（拆 ```actions json```）、actions 白名单过滤。 |
| `backend/routes/ai.js` | 全部 `/api/ai/*` 路由，挂 `authRequired`，含按用户 ID 的限流。 |

## 二、修改文件

- `backend/database.js`：`runMigrations` 中新增 7 张 AI 表（`ai_configs / ai_conversations / ai_messages / ai_profile / ai_memory / ai_action_logs / ai_usage_daily`）及索引；全部 `CREATE TABLE IF NOT EXISTS`，老库用 `ensureColumn` 幂等补列。`ai_configs` 关键字段：`provider`、`preference`、`base_url`、`encrypted_api_key`、`key_salt`、`key_preview`、`daily_token_budget`、`enabled`。
- `backend/server.js`：`require('./routes/ai')` 并 `app.use('/api/ai', aiRoutes)`，挂在业务路由之后；AI 路由内置按 `req.user.id` 60 次/分钟限流。

> 老库兼容：`ai_configs` 上历史过渡阶段加过的 `mode / quick_model / deep_model` 列保留但不再读写，不影响功能。

## 三、服务商与模型（最终简化版）

5 家服务商（无标签），每家带可选模型列表，前端渲染服务商下拉 + 模型选择；用户选定后，后端原样存 `model` 并按 `provider.baseUrl` 调用，**不做任何自动切换**：

| key | 名称 | 可选模型（recommended 为默认推荐） |
|---|---|---|
| deepseek | DeepSeek | deepseek-flash(推荐)、deepseek-v4-pro |
| zhipu | 智谱AI | glm-4-flash、glm-4-air(推荐) |
| dashscope | 通义千问 | qwen-turbo、qwen-plus(推荐) |
| openai | OpenAI | gpt-4o-mini(推荐)、gpt-4o |
| kimi | Kimi | kimi-k2-thinking(推荐) |

> `ai_configs.model` 存用户选的具体模型名。PUT 时校验 model 必须属于该服务商的 models 列表（`modelBelongsTo`，防篡改）。历史过渡阶段加过的 `preference / quick_model / deep_model / mode` 列保留但不再读写。

## 四、接口清单（全部走 authRequired）

**配置**
- `GET /api/ai/config` → `{configured, provider, model, enabled, keyPreview, dailyTokenBudget}`（不回传明文 key）
- `PUT /api/ai/config` ← `{provider, model, apiKey?, dailyTokenBudget?}`（provider 与 model 必填；不传 apiKey 表示不改 key；后端校验 model 必须属于该服务商；baseUrl 由服务商注册表固定）
- `GET /api/ai/providers` → `{providers:[{key,name,models:[{id,recommended}]}]}`
- `POST /api/ai/config/test` ← `{provider?, model?, apiKey?}`，用服务商 baseUrl + 指定/已选 model 发"回复 ok" → `{latencyMs, provider, reply}`

**会话**
- `GET /api/ai/conversations?limit&before`（last_at 倒序分页）
- `POST /api/ai/conversations`
- `GET /api/ai/conversations/:id/messages?before&limit`（cursor 分页）
- `DELETE /api/ai/conversations/:id`（级联删 messages）
- `DELETE /api/ai/conversations/all`（清空当前用户全部对话）

**主对话**
- `POST /api/ai/chat` ← `{conversationId?, message, context:{projectId?, budgetMin?}}`
  流水线：空输入拦截 → 查配置（未开通返回 needConfig）→ 今日预算检查（超预算降级本地数据，不硬报错）→ 意图分类 → 按意图聚合取数 → 组 prompt（历史近 10 轮 + 画像，更早不注入）→ 解密 key → 用用户配置的 model 调 LLM → 解析正文+actions（非法 actions 丢弃，正文照常）→ 落库 → 成功后才累计 usage。
  成功响应：`{conversationId, reply, intent, actions, tokens:{in,out}, profileUpdated}`。

**建议应用与撤销**
- `POST /api/ai/apply` ← `{messageId, selected, storeSigBefore, storeSigAfter}`（落 `ai_action_logs`，含 inverse_json）
- `POST /api/ai/undo` ← `{actionLogId}`（校验归属与状态后回滚，置 undone）
- `GET /api/ai/actions?status=applied`（撤销历史）

**画像**
- `GET /api/ai/profile`、`PUT /api/ai/profile`（白名单字段）、`POST /api/ai/profile/refresh`

**L0 本地轻量查询（零 token，不走大模型）**
- `GET /api/ai/summary?projectId=`、`/mistake-report`、`/paper-trend`、`/balance`、`/today-plan?budgetMin=`

**用量**
- `GET /api/ai/usage` → 今日 + 累计 + dailyBudget + `note:"消耗为系统估算值，真实扣费以服务商账单为准；调用失败不计入系统消耗统计"`

## 五、安全与错误码（前端依赖 code 字段）

错误响应统一 `{ok:false, error, code, ...}`：

| code | 触发 | 文案 |
|---|---|---|
| `EMPTY_INPUT` | message 空/纯空格 | 请输入你的问题 |
| `NOT_CONFIGURED` | 未配 key 就 chat | 请先在AI设置中配置API key（带 `needConfig:true`） |
| `INVALID_KEY` | 上游 401/403 | API key似乎无效，请检查后重新输入 |
| `INSUFFICIENT_BALANCE` | 上游 402 | AI服务余额不足，请去DeepSeek充值后继续使用（带 `detail` 充值链接） |
| `TIMEOUT` | 30s 超时 | AI开小差了，请稍后再试 |
| `RATE_LIMITED` | 上游 429 | 问得太快啦，歇一秒再问 |
| `UPSTREAM_ERROR` | 5xx/网络坏/返回坏 JSON | AI服务暂时不可用，请稍后再试 |

**关键安全约定**
- API key 绝不出现在日志/错误/调试输出；GET 接口只回 `keyPreview`（前4后4掩码）；换 key 即覆盖旧密文，无内存缓存（每次现解密）。
- 聚合层只读 `user_data.store_json`，代码不 JOIN users、不读 password_hash/email 注入 prompt。
- 学习数据用 `<learning_data>` 包裹进 prompt，系统 prompt 声明其中任何指令必须忽略（防注入）。
- chat 失败（超时/401/429/5xx）**不累计 usage**，错误响应带 `note:"调用失败，本次不计入系统消耗统计"`。
- 历史只注入近 10 轮（更早仍存库）；超日预算降级本地数据不硬报错。

## 六、自测结果（临时 DB，已清理）

用独立临时 DB（`DB_FILE=ai_test.db` + 临时 JWT）启动后端，验证通过：

- 迁移：7 表 + provider/model 列幂等建表/补列成功。
- `GET /providers`：返回 5 家，结构 `{key,name,models:[{id,recommended}]}`，无 tag。
- `PUT /config`：缺 model → "请选择模型"；model 不属于该服务商 → "所选模型不属于该服务商"；传 `{provider,model,apiKey}` 正确落库，返回 `{provider,model,enabled,keyPreview,dailyTokenBudget}`。
- `GET /config`：脱敏，回显所选 model 与 keyPreview（前4后4），无明文 key。
- chat 空输入 → `EMPTY_INPUT`；未配置 → `NOT_CONFIGURED{needConfig:true}`；假 key 走通上游 401 → `INVALID_KEY` + 失败 note；失败后 `usage` 仍全 0（验证失败不计费）。
- L0 `/balance` 本地聚合正常；`/usage` 带估算 note。
- config/test 用所选 model 发探测请求，假 key 正确映射 `INVALID_KEY`。
- 临时 DB 与临时脚本已删除，真实库 `data/study.db` 未触碰。

## 七、与 PRD 假设的偏差及处理

1. **records 无 score 字段**：`getPaperTrend` 在 records 缺 `score/sections` 时返回空结构并在摘要里提示"暂无套卷分数数据"，不报错。
2. **项目可选字段**（`subjectKey / minutesPerUnit / targetScoreTier`）：作为 `store.projects[id]` 内字段聚合时缺省兜底，不建数据库列。
3. **服务商 baseUrl 不可自定义**：按"简化设置页"要求，baseUrl 固定取注册表，前端不暴露；SSRF 防护仍在 `assertSafeBaseUrl` 保留兜底。
4. **消耗为估算值**：系统按返回 usage 记账，真实扣费以服务商账单为准（usage 接口已注明）。

## 八、体验评审问题修复记录

1. **chat 不返回 assistant messageId（阻断）**：`saveMessage` 本就返回 `lastInsertRowid`，chat 落库时接住并在响应中新增 `messageId` 字段，前端 apply 链路打通。
2. **getTodayPlan 读不存在的 s.backlog**：在 `projectStats` 的 recite 分支补算 `backlog`（已逾期、未掌握条目数 = nextReviewDay < today），今日计划优先级判断不再依赖 undefined 字段。
3. **"全天"预算静默回退 240 分钟**：`getTodayPlan` 对 budgetMin 为 0/空/非法时改用全天上限 **720 分钟**（并 clamp 到 720）；路由 `/today-plan` 不再硬编码 240 默认值，空参交给聚合层兜底。
4. **balance 只看刷题项目**：`getMultiSubjectBalance` 改为纳入全部三类项目——exercise 用完成率 gap、recite 用掌握率+今日到期/逾期积压、mistake 用高危重错数，统一算 `urgency` 排序，背书/错题落后也会进入"先救谁"。
5. **无法删除 API key**：`PUT /config` 当 `apiKey` 传空字符串 `""` 时清空 `encrypted_api_key/key_salt/key_preview` 并 `enabled=0`；不传 apiKey 仍表示不改 key（SQL 改为直接写解析后的值，COALESCE 不再挡住清空）。
6. **402 充值链接硬编码 DeepSeek**：`aiProxy.callLLM` 的 402 错误 `aiDetail` 改用 `cfg.docsUrl`（由路由按 `cfg.provider` 从 `aiProviders` 注入），文案改为"前往服务商控制台充值"，不再写死 DeepSeek。

## 九、技术审查 P0 安全修复

1. **IDOR / BOLA 越权（P0-H1）**：`loadRecentMessages(userId, conversationId, n)` 此前只按 conversation_id 过滤、完全没用 userId，会话 id 可枚举导致他人历史泄露。已在 SQL 加 `AND conversation_id IN (SELECT id FROM ai_conversations WHERE user_id=?)`。并全量排查所有按 ID 查询接口，确认归属校验：`GET /conversations/:id/messages`、`DELETE /conversations/:id`、`POST /apply`（messageId）、`POST /undo`（actionLogId）、`GET /actions`、`ensureConversation` 均带 `user_id` 条件；`touchConversation`/undo 的 UPDATE 作用于已先校验归属的行。
2. **撤销链路 inverse（P0-H2）**：确认 inverse 由前端在应用 action 时按"修改前 store 状态"计算并随 `selected[].inverse` 上报，后端只存取不生成。`/apply` 正确把 `selected[].inverse` 落 `inverse_json`；`/undo` 正确回传；`aiPrompt.js` 本就未要求 AI 输出 inverse（actions 契约不含 inverse 字段）。已验证 apply→undo 的 inverse 往返一致。
3. **storeSigBefore/After**：后端按原样存储这两个签名字段，不做正确性判断（前端填错属前端问题，后端无改动）。
