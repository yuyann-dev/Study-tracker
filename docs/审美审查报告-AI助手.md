# Study Tracker AI 助手 · 前端审美与交互审查报告

| 项目 | 内容 |
|---|---|
| 审查日期 | 2026-10-05 |
| 审查对象 | `frontend/index.html`（L2176–2301）、`frontend/css/style.css`（L2069–2335 AI 节）、`frontend/js/app.js`（L15592–16520 AIModule） |
| 对照基线 | 现有「纸感学院派」样式（style.css 变量/抽屉/按钮/表单）、`docs/AI助手界面设计方案.md` v1.0 |
| 审查方式 | 逐行走读 HTML / CSS / JS，与设计方案与现有系统变量逐条比对 |

---

## 一、总分概览

| 维度 | 评分 | 一句话结论 |
|---|---|---|
| 视觉一致性 | **8.5 / 10** | 90% 复用现有变量与现成类，气泡/分段 Tab 为合理新增语言，无野色 |
| 深浅色适配 | **8.5 / 10** | 颜色全部走变量（仅 4 个 `--ai-*` 别名，浅深双值齐全）；仅 disabled 态对比度偏低 |
| 交互体验 | **7.5 / 10** | 主链路闭环完整、文案友好；存在 1 个 P1 空态矛盾 + 移动端触控目标不达标 |
| 布局与空间 | **8.5 / 10** | 三段式 flex 结构合理，小屏不溢出；外层 drawer 的 overflow 未重置是小隐患 |
| 动效克制 | **9 / 10** | 全部过渡 ≤200ms，无粒子/视差/弹跳，打字三点呼吸克制 |

---

## 二、视觉一致性（8.5）

### 做得好的
- **抽屉完整复用**：`.ai-mask` 直接挂在现有 `.drawer-mask`（L1722）之上，仅追加 `z-index:130`；`.ai-drawer` 继承 `.drawer` 的 `drawIn .2s` 动画与 `-10px 0 40px` 阴影，只做了 `padding:0` + flex 列改造，没有自造抽屉范式。
- **按钮家族复用**：主操作 `.primary`、次按钮 `.soft-btn`、危险按钮 `.danger-btn`、文字按钮 `.ghost-btn`、关闭钮 `.x-btn`（L2187）全部是现成类，未新造按钮。
- **表单控件**：`.ai-field select/input` 视觉上与全局 input（L143–147）一致——浅色底 `--ai-bubble-ai` 正好 = `--inputBg`（#f5eedd），深色 = #2c3f63 正好 = 全局深色 input 底（L1304），换名不换色。
- **用量进度条**：HTML 同时挂了 `storage-bar ai-usage-bar`（L2272），轨道/圆角复用 L1756 现成样式。
- **时间 chips**：直接复用 `.pct-chip` / `.pct-chip.active`（L224–225），选中态手感与现有题量 chips 完全一致。
- **锚定 chip**：复用 `.type-badge`（L41）。

### 引入的新视觉语言（合理但需知悉）
1. **圆形 FAB（36px）**：现有系统按钮全是 10px 圆角方角语言（`.ghost-btn`/`.primary`），没有圆形钮。设计方案 §2.1 已论证（无侧边栏、顶部导航已满），颜色/阴影仍取自 `--brand`/`--shadow-hover`，属可接受的范式外新增。
2. **消息气泡非对称圆角**（`12px 4px 12px 12px`）：系统原本没有 IM 气泡，卡片是 14px 方角。气泡的「纸感卡片」取向自洽，不突兀。
3. **分段式 Tab 控件**（`.ai-tabs` 灰底容器 + 选中色块）：现有导航是一行 ghost-btn，没有分段控件。但其选中态复刻了 `.pct-chip.active` 的绿染底，语言上能接上。

### 野色/野字体排查结论
- **无野字体**：未引入新 font-family，全部继承 `var(--font)`。
- **无野调色板**：新增颜色仅 4 个别名（见下节），且每个都能在现有 CSS 找到出处（#e9ebdb = L41/L225 现有硬编码；#2c3f63 = 深色 `--input`；#4a628e = `--elevated`；`rgba(46,107,79,.16)` = L152 现有聚焦环）。

---

## 三、深浅色适配（8.5）

### 逐元素检查结果

| 元素 | 浅色 | 深色 | 取法 | 判定 |
|---|---|---|---|---|
| 抽屉容器底 | #fffaf1 | #3a5079 | `var(--card)` | ✅ |
| 抽屉遮罩 | rgba(44,38,32,.45) | rgba(0,0,0,.6) | `.drawer-mask` 现成 | ✅ |
| AI 气泡底 | #f5eedd | #2c3f63 | `--ai-bubble-ai` 双值 | ✅ |
| 用户气泡底 | #e9ebdb | #4a628e | `--ai-bubble-user` 双值 | ✅ |
| 正文 / 次要文字 | #29241d / #6d6457 | #e7edf6 / #b6c3d8 | `--text` / `--muted` | ✅ |
| 描边/分隔线 | #e4d9c4 | #556c94 | `--line` | ✅ |
| FAB 底 + 图标 | #2e6b4f + 白 | #83bca9 + #10302a | `--brand` + 深色字覆盖 | ✅ 对比度达标 |
| 发送钮 | 同上 | 同上 | 同上 | ✅ |
| Tab 选中 | 绿染底 #e9ebdb + 绿字 | #4a628e + #83bca9 | `--ai-tint`/`--brand` | ✅（与 pct-chip.active 同源） |
| 红点 | #c0392b | #dd948b | `var(--bad)` | ✅ |
| 输入框底/聚焦环 | #f5eedd / rgba(46,107,79,.16) | #2c3f63 / rgba(134,169,218,.25) | `--ai-bubble-ai` / `--ai-ring` | ✅ |
| 进度条轨道/填充 | #e4d9c4 / 绿 | #556c94 / 青绿 | `--line`/`--brand` | ✅ |
| 错误气泡左条 | #c0392b | #dd948b | `--bad` | ✅ |
| 主动触达竖条 | #b07a4b | #cdae70 | `--brand2` | ✅ |
| 行内 code / pre 底 | rgba(0,0,0,.06) | rgba(255,255,255,.12) | 自带深色覆盖（L2151/2156） | ✅ |
| 成功/失败测试字 | #1f8a66 / #c0392b | #78baa0 / #dd948b | `--ok`/`--bad` | ✅ |

### 发现的问题
- **⚠️ `.ai-send:disabled` 对比度偏低（P2）**：L2335 只把背景改成 `var(--line)`（浅色 #e4d9c4），但按钮内 `color:#fff` 没变。浅色模式下「白 ➤」落在浅米底上，对比度约 1.3:1，几乎看不见。系统 `.primary:disabled`（L170）是同一套「灰底白字」做法，但 `.primary:disabled` 用的是 #d8cfc0（更深一档），而 AI 发送钮用 #e4d9c4（更浅），观感更接近「按钮消失」而非「按钮禁用」。建议浅色禁用态改用 `var(--line)` 加深或补 `color:#fff` 的降透明度处理。
- **无「浅色块漂浮在深色模式」的刺眼问题**：气泡/卡片底都随主题切换，不存在硬编码白底。
- **`.pct-chip.active` 深色下是浅绿底 #e9ebdb**：这是系统既有行为（L225 在深色块 L1341 未覆盖 active 态），AI 时间 chips 只是继承，非本次引入，不扣分但记录在案。

---

## 四、交互体验（7.5）

### 闭环正确的部分
- **开合**：点 FAB 开、点 × 关、点遮罩关闭（`e.target===mask`，L16453）、Esc 关闭（L16454）、`lockBodyScroll` 锁定背景滚动——与现有抽屉范式一致。
- **对话流**：发送后立即插入用户气泡 → 插入三点 typing 指示器 → 回复后 removeTyping → 每次增删都 `scrollBottom()`，自动滚到底。空输入走 `EMPTY_INPUT` 友好报错。
- **错误处理**：`codeMessage` 给了 9 种错误码的人话文案（余额不足/超时/限流/网络…），并按错误类型给「重试」或「去设置」次级按钮，不会让用户面对裸报错。
- **建议卡**：勾选实时联动「应用选中 N 条」计数、N=0 时禁用主按钮；应用中按钮变「应用中…」+ 整卡 opacity .6；成功后整卡置灰、底栏换成「↩ 已应用·撤销」；撤销后再淡化为「已撤销·改动已回滚」。状态机完整。
- **设置页**：服务商切换 → `fillModels` 联动模型列表（L16263）；Key 输入框 👁 显示/隐藏切换正常；教程折叠正常；用量条按百分比切换 `.over` 红色。
- **历史页**：列表项可点开、删除有二次确认、「＋ 新会话」按钮显眼。

### 发现的问题

**P1-1：未配置 API Key 时，输入框没有跟着隐藏（与设计 §5.1 矛盾）**
- 设计方案 §5.1 明确：未配置 Key 时「不显示输入框，改为面板中部空态」。
- 实际 `refreshChatEmptyState()`（L15753–15757）只切了 `els.empty` 和 `els.msgs.style.display`，**没有动 `els.inputArea`**。
- 后果：新用户打开面板，中央看到「先配一个 API Key 才能开始」+「去设置 →」按钮，但下方时间 chips 和输入框 + 发送钮仍然亮着。用户在一个被明确告知「还不能用」的界面里，看到一个可输入、可发送的框——视觉自相矛盾，且发送后只会得到一条「请先在设置中配置 API Key」的错误气泡。
- 修复建议：`refreshChatEmptyState` 里同步 `els.inputArea.hidden = hasKey ? false : true`（或仅隐藏 input-row，保留 chips 与否待定）。

**P1-2：移动端触控目标不达标**
- 系统在 L1261 专门给触屏设备（pointer:coarse）把 `.x-btn / .pct-chip / .r-del …` 统一拉到 `min-height/min-width:44px`。
- AI 模块新增的可点元素**一个都没进这个清单**：
  - `#aiFab` = 36×36px（设计上限 40px，但低于系统 44px 触屏标准）
  - `.ai-send` = 36×36px
  - `.ai-tab` ≈ 31px 高（padding 7px + 13px 字）
  - `.ai-act-row input[type=checkbox]` = 16×16px
  - `.hi-del`（删除会话 🗑）≈ 22px 可点区
  - `.ai-eye`（👁 显隐密钥）≈ 23px
- 后果：手机端这些按钮偏小，误触率会明显高于系统其它按钮。
- 修复建议：在 L1261 那条选择器里追加 `#aiFab, .ai-send, .ai-tab, .ai-hist-item .hi-del, .ai-eye`（checkbox 用 padding 撑大命中区而非放大盒子）。

**P2 级交互细节**
- **测试连接按钮无 loading 锁**：`testConnection()`（L16310）只是把结果文字改成「测试中…」，按钮本身未 disabled，连点会发多个请求。
- **删除会话/清空历史用原生 `confirm()`**（L16190/16352）：设计 §4.3 要求复用系统 `.mask`+`.modal` 的 `genericConfirmMask` 纸感弹窗，原生 confirm 在视觉上会「跳出」整个纸感体系。
- **对话框焦点管理缺失**：打开面板时焦点没有移入面板（停在 FAB 上），也没有 focus trap；Tab 按钮标了 `role="tab"` 但 `aria-selected` / `aria-controls` 未动态维护，键盘可 Tab 导航但读屏体验不完整。
- **Tab 无滑动/渐隐**：直接 display 切换，无闪烁，符合「≤200ms 内 opacity 即可」的设计预期，不算问题。

---

## 五、布局与空间（8.5）

- **面板宽度**：`.ai-drawer{max-width:400px;width:100%}`（L2106），在 360px 窄屏上退化为 100% 宽，不溢出、不横向滚动。✅
- **三段式 flex**：头部固定 / `.ai-body{flex:1;overflow-y:auto;min-height:0}` 滚动 / 输入区固定，结构正确。✅
- **输入框自适应**：`autoGrow()`（L16415）把 textarea 从单行撑到最多 96px（约 3 行），配合 `max-height:96px`，不会把面板顶爆。✅
- **设置页内容**：provider/Key/模型/测试/教程/预算/用量/清空/保存 一屏放不下，在 `.ai-body` 内滚动，流畅。✅
- **⚠️ 小隐患**：基础 `.drawer`（L1724）带 `overflow-y:auto`，`.ai-drawer` 只覆盖了 `padding` 和 display，**没有重置 `overflow-y:auto`**。目前因为 `.ai-body` 已经吃掉了纵向溢出，外层 drawer 不会出第二根滚动条；但在内容临界高度时可能出现「双滚动」抖动。建议 `.ai-drawer` 补一句 `overflow:hidden`，把滚动职责完全交给 `.ai-body`。
- **无元素重叠/遮挡**：FAB 在右下、z-index 120；面板 mask 130；toast 200、busy-mask 300、modal 999999 都在其上，层级正确。

---

## 六、动效克制（9）

| 动画 | 时长/周期 | 判定 |
|---|---|---|
| 面板开合 drawIn | .2s ease-out（复用现成） | ✅ ≤200ms |
| FAB hover scale(1.06) / active scale(.94) | .15s | ✅ |
| FAB 红点淡入 aiFade | .15s | ✅ 克制 |
| Tab 背景/颜色过渡 | .15s | ✅ |
| 用量条宽度变化 | .2s | ✅ |
| 打字三点 aiBlink | 1.2s 无限循环 | ✅ 装饰性，与现有 shimmerFade 同款语言 |
| 粒子 / 视差 / 大过渡 / 弹跳 | 无 | ✅ |

无任何性能隐患动画。

---

## 七、硬约束检查清单

| 硬约束 | 结果 | 依据 |
|---|---|---|
| AI 入口低调不突兀 | ✅ | 36px 圆钮 + 8px 红点，无横幅/无弹窗/无声音；红点仅本地巡检点亮，开面板即消 |
| 全局设置页零 AI 内容 | ✅ | 全 index.html 检索 `aiProvider/aiModel/aiKey/aiBudget/deepseek` 等关键字，全部命中 L2226–2266 抽屉内，全局「⚙️ 设置」页零 AI 字段 |
| 面板为右侧抽屉不挤压主界面 | ✅ | `.drawer-mask` fixed + z-index 130，主布局零重排 |
| 无复杂动效 | ✅ | 全部 ≤200ms，无粒子/视差 |
| 深浅色都适配 | ✅（小瑕疵） | 颜色 100% 走变量；唯一瑕疵是发送钮 disabled 态浅色对比过低 |
| 纸感学院派风格统一 | ✅ | 字体/圆角/阴影/按钮家族/表单/进度条全部复用现有语言 |

---

## 八、必须修复（P0 / P1）与优化建议（P2）

### P0（阻塞上线）
- 无。主链路、深浅色、硬约束全部成立。

### P1（上线前应修）
1. **未配置 Key 时输入区未隐藏**：`refreshChatEmptyState()` 同步切换 `els.inputArea.hidden`，消除「叫你配 Key 却给你一个可输入框」的矛盾。
2. **移动端触控目标**：在 style.css L1261 的触屏选择器中追加 `#aiFab, .ai-send, .ai-tab, .ai-hist-item .hi-del, .ai-eye`，checkbox 用伪元素 padding 扩大命中区。

### P2（可排期优化）
1. 发送钮 disabled 态浅色对比度：补一个更深的禁用底或降低图标透明度。
2. `testConnection()` 期间给「测试连接」按钮加 disabled + 文案 loading，防重复点击。
3. 删除会话 / 清空历史的原生 `confirm()` 替换为系统纸感 modal（`genericConfirmMask`）。
4. 对话框焦点管理：打开时焦点移入面板首个可点元素，补 `aria-selected`/`aria-controls`，考虑 focus trap。
5. `.ai-drawer` 补 `overflow:hidden`，避免外层 drawer 与 `.ai-body` 双滚动。
6. `.ai-usage-bar` 重复定义可删（HTML 已同时挂 `storage-bar`）。
7. （系统既存，非 AI 引入）深色下 `.pct-chip.active` 浅绿底过亮，可顺手在深色块补一条 `html[data-theme="dark"] .pct-chip.active{background:#4a628e;color:#83bca9;border-color:#556c94}`。

---

## 九、总体结论

**可以上线，但建议先修掉两个 P1。**

- 视觉上，AI 模块是一次纪律性很好的接入：没有自造调色板、没有换字体、没有加阴影发光，抽屉/按钮/表单/进度条/时间 chips 全部长在现有纸感学院派的语言上。圆形 FAB 和非对称气泡是两处范式外新增，但都有设计依据且克制。
- 深浅色适配基本完整，唯一会在浅色模式下被用户感知的问题是「发送钮禁用时几乎看不见」，属于细节瑕疵。
- 真正影响第一印象的是 **P1-1 空态矛盾**：新用户第一次打开面板就会看到一个「请先配 Key」的提示和一个亮着的输入框，这会让人怀疑界面没做完。修这一处（一行 JS）成本极低、收益极大。
- 交互主链路（发送→typing→回复→建议卡→应用→撤销→toast）闭环完整，错误文案人话化、状态机清晰，属于可以放心交给用户的成熟度。

**修完 P1-1、P1-2 后即可发布；P2 项随后续迭代排期即可。**
