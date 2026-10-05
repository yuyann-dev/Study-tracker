# Study Tracker AI 助手 · 前端界面设计方案

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 撰写日期 | 2026-10-05 |
| 依据 | `AI助手产品需求文档-v2.md` §14（前端界面与导航约束）、§3（功能交互流程） |
| 视觉基调 | 完全复用现有「纸感学院派」，不引入新视觉语言 |
| 适用范围 | M1（入口+三Tab+配置+对话主链路）→ M2（建议卡片+全局时间调度）全程通用 |

> 本方案所有颜色值、圆角、间距均从现有 `frontend/css/style.css` 实提取，新增样式**只引用现有 CSS 变量**，不新增调色板，深浅色自动跟随 `html[data-theme="dark"]`。

---

## 0. 现状走查结论（设计的地基）

在动手前先明确三个会决定方案走向的事实：

1. **系统没有左侧边栏。** 主导航是 `<header class="head">` 里的一条横向 `nav.head-actions`，由若干 `button.ghost-btn`（`🏠 今日总览` `📊 完成情况` `🎯 薄弱点` `📚 切换` `⚙️ 设置`）+ 最右头像组成。因此 PRD 里「侧边栏底部小图标按钮」在本系统**没有侧边栏可挂**——本方案据此把**右下角浮动圆钮（FAB）定为主入口**，把「导航栏内一个小 ghost-btn」作为备选。二者都满足「低调、不弹窗、不横幅」。
2. **已有成熟的抽屉范式可复用。** `style.css:1722` 已有 `.drawer-mask`（fixed / flex-end / z-index 110）+ `.drawer`（`var(--card)` / `max-width:420px` / `height:100%` / `animation:drawIn .2s`）。AI 面板直接继承这套，只把 `.drawer` 的「整块纵向滚动」改成「头部固定 + 消息流滚动 + 底部输入框固定」的三段式 flex 结构。
3. **弹层开关约定。** app.js 全程用 `el.hidden = true/false` 切换面板，配合 `lockBodyScroll()/unlockBodyScroll()`；按钮无圆角胶囊堆砌，统一 `radius:10px` 的方角；输入框聚焦用 `0 0 0 3px rgba(46,107,79,.16)` 柔光环。AI 模块照此约定写，不发明新交互范式。

---

## 1. 设计规范

### 1.1 配色方案（从现有 style.css 实提取）

#### 浅色（默认 `:root`，`html[data-theme=""]`）
| 角色 | 变量 | 实色值 | AI 模块用途 |
|---|---|---|---|
| 纸面底色 | `--bg` | `#f3ecdf`（暖米色） | 面板外、消息流底层 |
| 卡片底 | `--card` | `#fffaf1`（奶油白） | 抽屉/面板容器底 |
| 抬升层 | `--elevated` | `#fff8ea` | 输入框聚焦态、悬浮建议卡 |
| 正文 | `--text` | `#29241d` | 气泡主文字 |
| 次要文字 | `--muted` | `#6d6457` | 理由小字、时间戳、标签说明 |
| 品牌主色 | `--brand` | `#2e6b4f`（墨绿） | 用户气泡、主按钮、选中态、发送钮 |
| 品牌辅色 | `--brand2` | `#b07a4b`（赭棕） | 主动触达卡片描边/标签、ROI P1 |
| 成功 | `--ok` | `#1f8a66` | 应用成功勾选、连通测试通过 |
| 警告 | `--warn` | `#b07a4b` | 超 token 提示、ROI P2 |
| 危险 | `--bad` | `#c0392b` | 红点、删除按钮、撤销确认 |
| 描边/分隔线 | `--line` / `--border` | `#e4d9c4` | 气泡边、卡片边、Tab 分隔 |
| 输入底 | `--inputBg` | `#f5eedd` | AI 消息气泡底、输入框底 |
| 圆角 | `--radius` | `14px` | 卡片/面板 |
| 阴影 | `--shadow` | `0 1px 2px rgba(60,45,20,.05), 0 6px 16px -10px rgba(60,45,20,.18)` | 卡片 |
| 阴影(hover) | `--shadow-hover` | `0 2px 4px rgba(60,45,20,.06), 0 10px 22px -10px rgba(60,45,20,.24)` | FAB hover |

#### 深色（`html[data-theme="dark"]`，`style.css:1273`）
| 角色 | 变量 | 实色值 |
|---|---|---|
| 纸面底色 | `--bg` | `#273859`（深蓝墨） |
| 卡片底 | `--card` | `#3a5079` |
| 抬升层 | `--elevated` | `#4a628e` |
| 正文 | `--text` | `#e7edf6` |
| 次要文字 | `--muted` | `#b6c3d8` |
| 品牌主色 | `--brand` | `#83bca9`（青绿） |
| 品牌辅色 | `--brand2` | `#cdae70`（暖金） |
| 成功 | `--ok` | `#78baa0` |
| 警告 | `--warn` | `#cdae70` |
| 危险 | `--bad` | `#dd948b` |
| 描边 | `--line`/`--border` | `#556c94` |
| 输入底 | `--input` | `#2c3f63`（注意：深色用 `--input`，浅色用 `--inputBg`） |
| 遮罩 | `.drawer-mask` | `rgba(0,0,0,.6)`（浅色为 `rgba(44,38,32,.45)`） |

> **唯一需要 AI 模块自己补的语义色**：品牌色的「浅底淡染」用于气泡/选中 chip。浅色用 `#e9ebdb`（现有 `.pct-chip.active` 的底色，`style.css:225` 现成），深色用 `#4a628e`（现有 `html[data-theme="dark"] .primary` 系，`style.css:1366` 现成）。AI 模块通过变量 `--ai-tint` 统一引用，见 §1.4。

### 1.2 字体规范（复用现有字体栈，不引入新字体）

```css
font-family: var(--font);  /* -apple-system,BlinkMacSystemFont,"Segoe UI",
                              "PingFang SC","Hiragino Sans GB","Microsoft YaHei",
                              "Noto Sans SC","Source Han Sans SC",Roboto,... */
```

字号阶梯（全部对齐现有已用值，不新造）：
| 用途 | font-size | weight | 对照现有类 |
|---|---|---|---|
| 面板标题 | 16px | 600 | `.drawer h3` |
| AI 结论一行加粗 | 14px | 700 | h2 的 600 之上再强调 |
| 正文气泡 | 13.5px | 400 | `.g-content` |
| 理由小字 / 时间戳 | 12px | 400 / muted | `.hint` `.dsub` |
| Tab 标签 / 按钮 | 13px | 500~600 | `.ghost-btn` |
| 输入框 | 14px（触屏 16px） | 400 | 现有 input 规则 |
| 数字（token 用量、分钟） | tabular-nums | 700~800 | `.storage-value` |

### 1.3 间距 / 圆角 / 阴影规范

- **间距**：只用现有 `--sp-1:4px / --sp-2:8px / --sp-3:16px / --sp-4:24px` 四档；气泡内边距 `10px 12px`（对齐现有 input 的 `9px 12px`）。
- **圆角**：面板容器 `14px`（=`--radius`）；气泡 `12px`；小胶囊/chip `999px`（对齐 `.type-badge` `.pct-chip`）；输入框/按钮 `8~10px`。
- **阴影**：卡片复用 `var(--shadow)`；抽屉复用 `.drawer` 现成的 `-10px 0 40px -18px rgba(44,38,32,.5)`；FAB 用 `var(--shadow-hover)` 让它比周围卡片略浮起半档即可，**不做投影发光**。
- **动效**：面板开合 `≤200ms`（复用 `@keyframes drawIn` 的 `transform:translateX(40px)+opacity`，0.2s ease-out）；红点淡入 `opacity .15s`；打字指示器 3 点呼吸。**不做粒子/视差/大过渡**。

### 1.4 CSS 变量映射表（新增样式引用哪些现有变量）

AI 模块**不新定义调色板**，仅在 `:root` 与 `html[data-theme="dark"]` 下各补 3 个语义别名，其余全部指向现有变量：

```css
/* :root 浅色（style.css 变量块后追加，不修改现有变量值） */
:root{
  --ai-bubble-ai: var(--inputBg);     /* #f5eedd  AI 消息气泡底 */
  --ai-bubble-user: #e9ebdb;          /* 复用 .pct-chip.active 绿染底 */
  --ai-tint: #e9ebdb;                 /* 选中态淡染 */
  --ai-ring: rgba(46,107,79,.16);     /* 复用 input:focus 环 */
}
html[data-theme="dark"]{
  --ai-bubble-ai: #2c3f63;            /* 复用 --input */
  --ai-bubble-user: #4a628e;          /* 复用 .elevated */
  --ai-tint: #4a628e;
  --ai-ring: rgba(134,169,218,.25);   /* 复用深色 input:focus 环 */
}
```

| 新增类引用 | 实际取色（浅→深） |
|---|---|
| 面板背景 `background:var(--card)` | `#fffaf1` → `#3a5079` |
| AI 气泡底 `background:var(--ai-bubble-ai)` | `#f5eedd` → `#2c3f63` |
| 用户气泡底 `background:var(--ai-bubble-user)` | `#e9ebdb` → `#4a628e` |
| 主按钮/发送钮 `background:var(--brand);color:#fff` | `#2e6b4f`/白 → `#83bca9`/`#10302a` |
| 描边 `border:1px solid var(--line)` | `#e4d9c4` → `#556c94` |
| 次要文字 `color:var(--muted)` | `#6d6457` → `#b6c3d8` |
| 遮罩 `.drawer-mask`（现成） | `rgba(44,38,32,.45)` → `rgba(0,0,0,.6)` |
| 进度条轨道 `background:var(--line)`（对齐 `.storage-bar`） | `#e4d9c4` → `#556c94` |
| 进度条填充 `background:var(--brand)` | `#2e6b4f` → `#83bca9` |

---

## 2. 入口设计

### 2.1 主入口：右下角浮动圆钮（FAB）——推荐

> 选它做主入口的原因：本系统无侧边栏，顶部导航行已排了 8~9 个 ghost-btn，再加一个会在手机端换行挤压；FAB 固定右下、不重排主界面、最贴合「低调 ≤40px」的硬约束。

| 属性 | 值 |
|---|---|
| 位置 | `position:fixed; right:16px; bottom:calc(24px + env(safe-area-inset-bottom));`（对齐 body 现有 bottom padding） |
| 尺寸 | **36×36px 圆**（≤40px 上限内），`border-radius:50%` |
| 图标 | **✨**（sparkles，表意「AI 给你灵光一现」，比 🤖 更不打扰）；居中、字号 16px、line-height:1 |
| 背景 | `var(--brand)`，图标 `#fff`；深色下 `var(--brand)` 自动变青绿、图标用 `#10302a`（对齐 `.welcome .primary` 的深字处理） |
| 阴影 | `var(--shadow-hover)` |
| z-index | `120`（高于现有 `.drawer-mask` 的 110，保证 AI 抽屉开着时 FAB 仍可被遮罩盖住——实际由 mask 接管，故 FAB 自身 120 仅用于未开抽屉时在最上层） |

**四种状态：**
| 状态 | 视觉 |
|---|---|
| 正常 | 墨绿圆底 + ✨，透明度 1，`box-shadow:var(--shadow-hover)` |
| hover | 轻微 `transform:scale(1.06)` + 阴影加深（用 `--shadow-hover`）；`cursor:pointer` |
| active（按压） | `transform:scale(.94)`（对齐现有 `.ghost-btn:active{transform:scale(.98)}` 的按压手感，略更紧） |
| 有红点（待建议） | 圆钮右上角叠一个 **8×8px 红点**，`background:var(--bad)`，`border:2px solid var(--card)`（描边让它浮在 FAB 上不粘连），`border-radius:50%`，`opacity` 淡入 .15s |

```
        ┌────┐
        │ ✨ ·│  ← · = 8px 红点(var(--bad))，右上 -2px/-2px
        └────┘
```

### 2.2 备选入口：导航栏内小 ghost-btn（不推荐为主，但需给）

若产品更希望「入口可见但不悬浮」，在 `nav.head-actions` 里 `⚙️ 设置` **之前**插一个：

```html
<button class="ghost-btn" id="btnAi" title="AI 学习助手">✨ AI</button>
```

直接复用 `.ghost-btn`（`padding:8px 12px; border-radius:10px; font-size:13px`），尺寸与 `🏠 今日总览` 等现有导航项**完全一致**——这就是「与现有导航图标一致」的落地。红点用一个 `ai-nav-dot` 小元素叠在按钮文字右上角。
> 二者**只启用其一**，默认 FAB；导航钮作为开关型备选，不要同时出现两个入口。

### 2.3 红点提醒规则（什么时候亮 / 什么时候消）

| 事件 | 红点 |
|---|---|
| 本地巡检命中主动触达规则（§11.5：断签/落后/积压/错题 7 天未 review/稳定低产出/双刷题并行） | **亮**，仅 FAB 右上角小红点 |
| AI 后台异步跑完「今日时间调度」并产出新建议 | **亮** |
| 用户点开 AI 抽屉看过该建议 / 主动触达卡片被阅读 | **消** |
| 超 token、API 未配置等错误态 | **不亮红点**（避免与「有好建议」混淆），改为面板内空状态提示 |
| 面板已打开时 | FAB 红点熄灭（已被看见），由 mask 接管视觉 |

**硬约束**：红点出现 = 只亮一个点，**绝不弹窗、不横幅、不声音、不震动**；用户不点就一直安静地在那。

---

## 3. AI 面板结构（右侧抽屉，宽 400px ≤ 420px）

整体复用 `.drawer-mask`（fixed 遮罩，点遮罩关闭），内部容器从通用 `.drawer` 派生一个 `.ai-drawer`，改为**三段式 flex 列**：头部固定 / Tab+消息流滚动 / 底部输入框固定。

```
┌─ ai-drawer (400px, height:100%) ──────────────┐
│ ① 头部：✨ AI 学习助手    [锚定chip] [×]        │  ← 固定高 56px
│ ② Tab：对话 | 历史 | 设置                        │  ← 固定高 44px
├───────────────────────────────────────────┤
│ ③ 内容区（flex:1, overflow-y:auto）            │
│    · 对话Tab：消息流 + 建议卡片                 │
│    · 历史Tab：会话列表                          │
│    · 设置Tab：表单                             │
├───────────────────────────────────────────┤
│ ④ 输入区（仅对话Tab可见）：                     │
│   [⏱今天可学 1h|2h|4h|全天]                    │
│   [输入框 ..................] [发送➤]          │  ← 固定
└───────────────────────────────────────────┘
```

### 3.1 面板头部（高 56px，flex 两端对齐）
- 左：`✨ AI 学习助手`（16px/600，对齐 `.drawer h3`）。
- 中右：**当前锚定项目 chip**（`context.projectId`）——一个 `type-badge` 风格小胶囊，如「📚 数学·1000题」，无锚定时隐藏；点击可切换/清除锚定。
- 最右：关闭按钮，**直接复用现有 `.x-btn`**（`color:var(--muted); font-size:24px; padding:2px 8px; border-radius:7px`）。

### 3.2 三 Tab 导航（高 44px，分段控件）
- 样式：容器 `display:flex; background:var(--inputBg); border-radius:10px; padding:3px; margin:0 18px 12px;`
- 三个等分按钮 `.ai-tab`，未选中透明底/`var(--muted)`；**选中 `.ai-tab.active` = `background:var(--ai-tint); color:var(--brand); font-weight:600; border-radius:8px`**（完全复刻 `.pct-chip.active` 的选中手感，`style.css:225`）。
- 切换交互：点 Tab 仅 `.hidden` 切换三个 `.ai-pane`，**无滑动过渡**（≤200ms 内的 opacity 即可，默认直接切换也行）。

### 3.3 对话 Tab（核心）

**消息流布局**——不做左右严格镜像的 IM 风，而是「AI 消息=全宽卡片、用户消息=右对齐小气泡」，理由：AI 消息常带结论+理由+建议卡，需要全宽纵向空间；用户只是一句人话提问，右对齐小气泡即可，视觉上一眼分边。

| | AI 消息 | 用户消息 |
|---|---|---|
| 对齐 | 左，`margin-right:12%`（不顶满右缘） | 右，`margin-left:auto; max-width:78%` |
| 底 | `var(--ai-bubble-ai)`（浅 `#f5eedd`/深 `#2c3f63`） | `var(--ai-bubble-user)`（浅 `#e9ebdb`/深 `#4a628e`） |
| 圆角 | `12px`，左上角略小 `4px`（纸感卡片，非 IM） | `12px`，右上角 `4px` |
| 文字 | 结论 **一行加粗 14px/700** + 理由小字 12px/`--muted` | 13.5px/`--text` |
| 间距 | 气泡间 `margin-bottom:12px` | |

- **markdown 渲染**：AI 消息内支持轻量 markdown——`**加粗**` 用于结论行、`-` 列表用于 P0/P1/P2 时间块、`` ` `` 用于「约 X 分钟」。用极简渲染（前端已有 `esc()` 转义函数防注入，先 esc 再做行级 markdown），不引入完整 md 库。
- **建议卡片**：紧跟在产生 action 的 AI 消息下方（见 §4），不是独立气泡。
- **输入框区**（固定在面板底部）：
  - 第一行：**今日时间 chips**「⏱ 今天可学」+ `1h / 2h / 4h / 全天`，复用 `.pct-chip`/`.pct-chip.active` 样式；选中即把 `budgetMin`（60/120/240/全天=画像值）随下一条消息发给后端（对应 F1.7）。
  - 第二行：`<textarea>`（多行自适应 1~3 行，复用现有 input 样式：`background:var(--inputBg); border:1px solid var(--line); border-radius:8px; padding:9px 12px`，聚焦自动套 `0 0 0 3px var(--ai-ring)`）+ 右侧圆形发送钮（`var(--brand)` 底 + ➤，36×36，对齐 FAB 圆钮）。
  - 输入框上方常驻一条**锚定提示**（muted 12px）：「正在为：数学·1000题」，无锚定则「未锚定项目 · 全局规划」。

### 3.4 历史 Tab
- 顶部一个「＋ 新会话」全宽 ghost-btn（`width:100%`）。
- 会话列表项 `.ai-hist-item`：`display:flex; align-items:center; padding:12px; border-bottom:1px solid var(--line)`；
  - 左：标题（13.5px/600，取首条用户问题截 18 字）；
  - 下：最后消息预览（12px/`--muted`，单行省略）+ 相对时间（`· 2小时前`）；
  - 右：删除小钮 `.x-btn` 风格的 🗑（12.5px，hover 显 `--bad`）。
- 空态：居中「还没有历史会话，去对话里问第一个问题吧」+ 跳对话 Tab 的按钮。

### 3.5 设置 Tab
分区用现成 `.sec-title`（`style.css:796`：大写字距 + 上分隔线）做小标题。

**A. API 配置区**
- `Base URL`：text input，占位 `https://api.openai.com/v1`。
- `模型 Model`：`<select>`，复用现有 select 箭头下拉样式。
- `API Key`：password input + 右侧「👁/🙈」显示切换小钮（绝对定位在 input 内右侧 12px）。
- 「测试连通」按钮：`.soft-btn`；点击后在按钮下方出一行结果——成功 `var(--ok)` 绿字「✓ 连接成功，模型可用」，失败 `var(--bad)` 红字 + 原因（复用现有 `.field-error` 样式，`style.css:68`）。

**B. Token 预算区**
- 一行说明：「今日已用 N / 100k tokens」（数字 `tabular-nums`）。
- **进度条**：直接复用 `.storage-bar`（`style.css:1756`：`height:8px; border-radius:99px; background:var(--line); overflow:hidden`），填充 `width%` 用 `var(--brand)`；>80% 时填充换 `var(--warn)`、>100% 换 `var(--bad)`。
- **预算滑块**：`<input type=range>`，配套左右 min/max 标签；冲刺模式下显示「已开启冲刺双倍预算」小提示（`honest-hint` 样式，`style.css:78`）。

**C. 画像区（可见可编辑）**
- 只读展示 + 关键项可改：每日可用时长（数字 input）、高峰时段（select）、目标分数档位（`high/stable/pass` 三选一 chip）、各科 `minutesPerUnit`（列表，每项一个小数字 input，对齐 `.ps-row` 权重行样式 `style.css:208`）。
- 底部一行 muted 说明：「画像由你的学习记录自动推断，可手动修正，只用于让建议更准。」

> **硬约束落地**：以上全部 AI 配置只在本 Tab；现有「⚙️ 设置」全局页**不出现任何 AI/Key/模型选项**。

---

## 4. 建议卡片详细设计

建议卡片是 AI 消息流里的「可操作结论块」，紧跟在给出建议的那条 AI 气泡下方，是整张面板信息密度最高、交互最重的组件。

### 4.1 结构
```
┌─────────────────────────────────────┐
│ 💡 AI 建议                            │  ← 标题条，13px/700
├─────────────────────────────────────┤
│ ☑ 二刷中值定理 4 道        约 50min   │  ← 每条 action 一行
│ ☑ 政治马原复习 8 条        约 25min   │
│ ☐ 英语阅读 2 篇            约 40min   │
│ ☐ 数学 1000题新章          今天先不推进 │
├─────────────────────────────────────┤
│ 全选        应用选中 2 条 →           │  ← 底部操作栏
└─────────────────────────────────────┘
```

- 容器 `.ai-suggest`：`background:var(--card); border:1px solid var(--line); border-radius:12px; margin:8px 0 16px; overflow:hidden`（不另加阴影，靠描边分层，贴合「不装饰」）。
- 标题条：`padding:10px 12px; font-weight:700; font-size:13px; border-bottom:1px solid var(--line); color:var(--text)`。
- **每条 action 行 `.ai-act-row`**：`display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid var(--line)`（末行无分隔）。
  - 勾选框：原生 `<input type=checkbox>`，尺寸 16px，accent 色用 `var(--brand)`。
  - **一句人话标签**：`flex:1; font-size:13.5px`——直接是要做的事，不带技术 op 名（「二刷中值定理 4 道」而非 `adjust_daily_capacity`）。
  - **右侧标签**：「约 50min」muted 12px；砍范围/减法类（`mark_units_optional`/`lower_mastered_freq`）显示赭棕 `--brand2` 的「可缓」标签，与 P0/P1 排序呼应。
- **底部操作栏 `.ai-suggest-bar`**：`display:flex; align-items:center; gap:8px; padding:10px 12px; background:var(--inputBg)`。
  - 左：「全选/清空」`.mode-mini` 文字钮（对齐现有 `style.css:191` 的小字号文字钮）。
  - 右：主操作 `应用选中 N 条 →` = `.primary` 小一号（`padding:7px 14px; font-size:12.5px`），`N=0` 时 `:disabled`（灰底，对齐 `.primary:disabled`）。

### 4.2 状态视觉变化
| 状态 | 视觉 |
|---|---|
| **待应用（默认）** | 白卡描边，checkbox 可勾，主按钮 `应用选中 N 条` |
| **应用中（loading）** | 主按钮文字变「应用中…」并 `disabled`，整卡 `opacity:.6`；行内 checkbox 不再可改 |
| **应用成功** | 容器左上角出现 ✓ 绿标（`--ok`），已应用行打勾置灰、右侧标签变「✓ 已写入」；底部操作栏替换为一个 `.ghost-btn`「↩ 撤销这组改动」 |
| **已撤销** | 整卡淡化为 `opacity:.55`，操作栏变一行 muted「已撤销 · 改动已回滚」，不可再点 |
| **compare_plans（先比后选）** | 不显示 checkbox，改为 2~3 个等宽方案 `.soft-btn` 横排，用户点选其一后才落成对应 op（按钮下小字标各自代价，如「数学↑ 但专业课↓10%」） |

### 4.3 复用的既有交互细节
- 删除/撤销二次确认：复用现有 `.mask`+`.modal` 的 `genericConfirmMask` 范式（`style.css:770`），不新造确认弹层。
- 应用成功/撤销成功的轻提示：复用全局 `.toast`（`style.css:901`，顶部居中，`.show` 触发），文案「已写入系统 · 可随时撤销」。
- 部分应用：每行独立 checkbox 即天然支持；「全选」只勾当前卡内 action。

---

## 5. 特殊场景 UI

### 5.1 未配置 API Key（空状态引导）
对话 Tab 在 `ai_config.apiKey` 为空时，不显示输入框，改为面板中部空态：
- 大 emoji 占位「🔑」（32px，`opacity:.5`，对齐 `.wb-heatmap-empty .empty-icon`）；
- 标题 14px/600「先配一个 API Key 才能开始」；
- 说明 12.5px/`--muted`「Key 只存在你自己的浏览器/账号，AES 加密存储，不会上传他处。」；
- 一个 `.primary` 按钮「去设置 →」，点击切到「设置」Tab 并自动聚焦 Base URL 输入框。
- 此时 FAB 红点**不亮**。

### 5.2 AI 调用中（加载 / 打字指示器）
- 用户消息发出后，AI 侧先插入一个「正在思考」气泡：三个 6px 圆点上下呼吸动画（`@keyframes` 仅 `opacity/transform:translateY`，周期 1.2s，与现有 `shimmerFade` 同款克制）。
- 流式输出（F1.5 SSE）开启后，文字逐段填入同一气泡，底部始终留一个小光标 `▍`（`var(--brand)`）。
- 规划类请求 >3s 未回时，气泡下补一行小字：「正在你的时间预算里排今天的顺序…」（不转圈大图）。

### 5.3 超 Token 预算（降级提示）
当今日 token 用量 > 预算时：
- 对话流顶部插一条**窄横幅**（复用 `.honest-hint` 样式 `style.css:78`：浅黄底 `#fdf6e3`/深色 `#2c2718`，12px）：「今日 token 预算用完了，已切到本地分析（只看你已有的数据，不调 AI）。明天恢复，或在「设置」里调高预算。」
- 输入框保留，但发送走 L0 本地聚合接口（§6.2），按钮旁标一个小「本地」chip。
- **不报错弹窗、不阻断对话**。

### 5.4 主动触达卡片（心态干预 / 落后提醒）
作为一条**特殊 AI 消息**插进对话流顶部，与普通 AI 气泡同款底，但：
- 左边加一条 **3px 赭棕 `--brand2` 竖条**（`border-left:3px solid var(--brand2)`）做区分；
- 话术给「数字不给鸡汤」：`结论一行加粗`（「你错题本已经 7 天没复习了」）+ 理由小字（「只刷新题不总结，之前错的会再错」）+ 一个「最小第一步」主操作（`.primary` 小钮「📋 生成今天的错题复习清单 · 约 30min」）。
- 它就是触发 FAB 红点的那条；用户点开抽屉后，这条默认展开在最上方。

### 5.5 全局时间调度面板（今日时间块 / ROI）
这是 M2 核心结果，渲染在对话流里的一张「结果卡」，不是独立页面：

```
今天 300min，按此消彼长分配（总量守恒）
┌──────────────────────────────────┐
│ ▉▉▉▉▉▉▉▉ 数学 50min  P0  ROI 9   │  ← 横向条形图
│ ▉▉▉ 政治 25min       P0  ROI 8   │
│ ▉▉▉▉ 英语 40min      P1  ROI 6   │
│ ▉▉▉▉▉▉ 专业课 60min   P1  ROI 7   │
│ ▯ 数学新章 0min       P2  今天先不推 │
└──────────────────────────────────┘
英语已超前，从 2h 降到 40min，省给数学和政治。
[ 应用这组时间块 → ]
```
- **各科分配条形图**：每行一个水平条，宽度 ∝ 分钟数，填充色按优先级——P0 `var(--brand)`、P1 `var(--brand2)`、P2 `var(--line)`（已完成轨道用 `.storage-bar` 同款 8px 高、`border-radius:99px`）。
- **ROI 优先级标签**：`P0/P1/P2` 三个小胶囊，分别绿/赭/灰（复用 `.mode-badge` 圆角胶囊 `style.css:199`）。
- 底部一行理由小字（`--muted`）解释「此消彼长」，再接 §4 的建议卡片（`adjust_daily_capacity` 有升有降）。

---

## 6. 深浅色适配对照表

每个新增元素在浅色 / 深色下的**具体颜色值**（全部走变量，此处仅为核对）：

| 元素 | 浅色值 | 深色值 | 取法 |
|---|---|---|---|
| 抽屉容器底 | `#fffaf1` | `#3a5079` | `var(--card)` |
| 抽屉遮罩 | `rgba(44,38,32,.45)` | `rgba(0,0,0,.6)` | `.drawer-mask` 现成 |
| AI 气泡底 | `#f5eedd` | `#2c3f63` | `--ai-bubble-ai` |
| 用户气泡底 | `#e9ebdb` | `#4a628e` | `--ai-bubble-user` |
| 气泡/卡片描边 | `#e4d9c4` | `#556c94` | `var(--line)` |
| 正文文字 | `#29241d` | `#e7edf6` | `var(--text)` |
| 理由/时间戳 | `#6d6457` | `#b6c3d8` | `var(--muted)` |
| FAB 底 / 图标 | `#2e6b4f` / `#fff` | `#83bca9` / `#10302a` | `var(--brand)` |
| 主按钮(发送/应用) | `#2e6b4f`/`#fff` | `#83bca9`/`#10302a` | `.primary` 现成 |
| Tab 选中底/字 | `#e9ebdb`/`#2e6b4f` | `#4a628e`/`#e7edf6` | `--ai-tint`/`--brand` |
| 红点 | `#c0392b` | `#dd948b` | `var(--bad)` |
| 输入框底 / 聚焦环 | `#f5eedd` / `rgba(46,107,79,.16)` | `#2c3f63` / `rgba(134,169,218,.25)` | input 现成 |
| 进度条轨道 | `#e4d9c4` | `#556c94` | `var(--line)` |
| 进度条填充(<80%) | `#2e6b4f` | `#83bca9` | `var(--brand)` |
| 进度条填充(>80%) | `#b07a4b` | `#cdae70` | `var(--warn)` |
| 主动触达竖条 | `#b07a4b` | `#cdae70` | `var(--brand2)` |
| 超 token 横幅底 | `#fdf6e3`/字 `#6d5a36` | `#2c2718`/字 `#d8c79a` | `.honest-hint` 现成 |
| 连通成功字 | `#1f8a66` | `#78baa0` | `var(--ok)` |

> 结论：除 `--ai-bubble-*` / `--ai-tint` / `--ai-ring` 三个别名外，**其余 100% 直接复用现有变量与现成类**，无需为 AI 单独写深色覆盖规则——这就是「走现有 CSS 变量体系」的具体含义。

---

## 7. HTML 结构草案（可直接给前端）

class 统一 `ai-` 前缀，挂在 `</body>` 前（与其它 `.mask`/`.drawer-mask` 同级）：

```html
<!-- ============ AI 助手入口 FAB ============ -->
<button id="aiFab" class="ai-fab" title="AI 学习助手" aria-label="打开 AI 学习助手">
  ✨
  <span id="aiFabDot" class="ai-fab-dot" hidden></span>
</button>

<!-- ============ AI 助手抽屉 ============ -->
<div class="drawer-mask ai-mask" id="aiMask" hidden>
  <aside class="drawer ai-drawer" role="dialog" aria-label="AI 学习助手">

    <!-- ① 头部 -->
    <div class="ai-head">
      <span class="ai-head-title">✨ AI 学习助手</span>
      <span id="aiAnchorChip" class="type-badge" hidden></span>
      <button class="x-btn" id="aiClose" type="button" aria-label="关闭">×</button>
    </div>

    <!-- ② Tab -->
    <div class="ai-tabs" role="tablist">
      <button class="ai-tab active" data-pane="chat" role="tab">对话</button>
      <button class="ai-tab" data-pane="history" role="tab">历史</button>
      <button class="ai-tab" data-pane="settings" role="tab">设置</button>
    </div>

    <!-- ③ 内容区 -->
    <div class="ai-body">

      <!-- 对话 Tab -->
      <div class="ai-pane" id="aiPane-chat">
        <div class="ai-msgs" id="aiMsgs"><!-- 消息/建议卡动态注入 --></div>

        <!-- 未配置 Key 空态 -->
        <div class="ai-empty" id="aiEmpty" hidden>
          <div class="empty-icon">🔑</div>
          <p class="ai-empty-title">先配一个 API Key 才能开始</p>
          <p class="hint">Key 只存在你自己的浏览器，AES 加密存储。</p>
          <button class="primary" id="aiGoSettings" type="button">去设置 →</button>
        </div>
      </div>

      <!-- 历史 Tab -->
      <div class="ai-pane" id="aiPane-history" hidden>
        <button class="ghost-btn" id="aiNewConv" type="button" style="width:100%">＋ 新会话</button>
        <div id="aiHistList"></div>
      </div>

      <!-- 设置 Tab -->
      <div class="ai-pane" id="aiPane-settings" hidden>
        <div class="sec-title">API 配置</div>
        <label>Base URL
          <input type="text" id="aiBaseUrl" placeholder="https://api.openai.com/v1">
        </label>
        <label>模型
          <select id="aiModel">
            <option>gpt-4o-mini</option><option>gpt-4o</option>
          </select>
        </label>
        <label>API Key
          <span style="position:relative;display:block">
            <input type="password" id="aiKey" placeholder="sk-...">
            <button type="button" id="aiKeyToggle" class="ai-eye">👁</button>
          </span>
        </label>
        <button class="soft-btn" id="aiTest" type="button">测试连通</button>
        <div class="field-error" id="aiTestResult" hidden></div>

        <div class="sec-title">Token 预算</div>
        <div class="ai-usage-row">
          <span>今日已用 <b id="aiTokUsed">0</b> / <span id="aiTokBudget">100k</span></span>
        </div>
        <div class="storage-bar ai-usage-bar"><div id="aiUsageFill" class="ai-usage-fill"></div></div>
        <input type="range" id="aiBudget" min="20" max="200" step="10">

        <div class="sec-title">我的画像</div>
        <!-- 每日可用时长 / 高峰时段 / 目标档位 / 各科 minutesPerUnit ... -->
      </div>
    </div>

    <!-- ④ 输入区（仅对话 Tab） -->
    <div class="ai-input-area" id="aiInputArea">
      <div class="ai-timechips">
        <span class="ai-tc-label">⏱ 今天可学</span>
        <button class="pct-chip" data-min="60">1h</button>
        <button class="pct-chip" data-min="120">2h</button>
        <button class="pct-chip active" data-min="240">4h</button>
        <button class="pct-chip" data-min="0">全天</button>
      </div>
      <div class="ai-input-row">
        <textarea id="aiInput" rows="1" placeholder="问问今天先救哪科、错题怎么排…"></textarea>
        <button class="ai-send" id="aiSend" type="button" aria-label="发送">➤</button>
      </div>
    </div>

  </aside>
</div>
```

---

## 8. CSS 样式草案（关键片段，全部引用现有变量）

```css
/* ============ AI 助手（追加到 style.css 末尾，独立分节） ============ */
:root{ --ai-bubble-ai:var(--inputBg); --ai-bubble-user:#e9ebdb; --ai-tint:#e9ebdb; --ai-ring:rgba(46,107,79,.16); }
html[data-theme="dark"]{ --ai-bubble-ai:#2c3f63; --ai-bubble-user:#4a628e; --ai-tint:#4a628e; --ai-ring:rgba(134,169,218,.25); }

/* 入口 FAB */
.ai-fab{position:fixed;right:16px;bottom:calc(24px + env(safe-area-inset-bottom));
  width:36px;height:36px;border-radius:50%;border:none;cursor:pointer;z-index:120;
  background:var(--brand);color:#fff;font-size:16px;line-height:1;
  display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-hover);transition:.15s}
html[data-theme="dark"] .ai-fab{color:#10302a}
.ai-fab:hover{transform:scale(1.06)} .ai-fab:active{transform:scale(.94)}
.ai-fab-dot{position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;
  background:var(--bad);border:2px solid var(--card);animation:aiFade .15s ease-out}
@keyframes aiFade{from{opacity:0}to{opacity:1}}

/* 抽屉：复用 .drawer-mask，容器改三段式 flex */
.ai-mask{z-index:130}               /* 高于现有 drawer-mask(110) 与 modal(100) */
.ai-drawer{display:flex;flex-direction:column;padding:0;max-width:400px}
.ai-head{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--line)}
.ai-head-title{font-size:16px;font-weight:600;flex:1;min-width:0}
.ai-head .x-btn{padding:2px 6px}

/* Tab */
.ai-tabs{display:flex;gap:4px;margin:12px 16px 0;background:var(--inputBg);border-radius:10px;padding:3px}
.ai-tab{flex:1;border:none;background:none;padding:7px;font-family:inherit;font-size:13px;
  color:var(--muted);border-radius:8px;cursor:pointer;transition:.15s}
.ai-tab.active{background:var(--ai-tint);color:var(--brand);font-weight:600}

/* 内容区滚动 */
.ai-body{flex:1;overflow-y:auto;padding:12px 16px;min-height:0}

/* 消息气泡 */
.ai-msg{margin-bottom:12px;max-width:88%;font-size:13.5px;line-height:1.6}
.ai-msg.ai{background:var(--ai-bubble-ai);border-radius:12px 4px 12px 12px;padding:10px 12px}
.ai-msg.user{margin-left:auto;background:var(--ai-bubble-user);border-radius:4px 12px 12px 12px;padding:9px 12px;max-width:78%}
.ai-msg .ai-concl{font-weight:700;font-size:14px;display:block;margin-bottom:3px}
.ai-msg .ai-reason{font-size:12px;color:var(--muted)}

/* 主动触达特殊气泡 */
.ai-msg.proactive{border-left:3px solid var(--brand2)}

/* 建议卡片 */
.ai-suggest{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:8px 0 16px;overflow:hidden}
.ai-suggest-title{padding:10px 12px;font-weight:700;font-size:13px;border-bottom:1px solid var(--line)}
.ai-act-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);font-size:13.5px}
.ai-act-row:last-of-type{border-bottom:none}
.ai-act-row .ai-act-label{flex:1;min-width:0}
.ai-act-row .ai-act-time{font-size:12px;color:var(--muted);flex:0 0 auto;font-variant-numeric:tabular-nums}
.ai-act-row.opt{color:var(--brand2)}
.ai-suggest-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--inputBg)}
.ai-suggest-bar .spacer{flex:1}
.ai-suggest.applied{opacity:1} .ai-suggest.undone{opacity:.55}

/* 输入区 */
.ai-input-area{border-top:1px solid var(--line);padding:10px 16px calc(10px + env(safe-area-inset-bottom))}
.ai-timechips{display:flex;align-items:center;gap:5px;margin-bottom:8px;flex-wrap:wrap}
.ai-tc-label{font-size:12px;color:var(--muted)}
.ai-input-row{display:flex;gap:8px;align-items:flex-end}
.ai-input-row textarea{flex:1;resize:none;max-height:96px}
.ai-send{width:36px;height:36px;flex:0 0 auto;border:none;border-radius:50%;background:var(--brand);
  color:#fff;font-size:15px;cursor:pointer}
html[data-theme="dark"] .ai-send{color:#10302a}
.ai-send:disabled{background:#d8cfc0;cursor:not-allowed}

/* 进度条（复用 .storage-bar 轨道） */
.ai-usage-row{font-size:12.5px;color:var(--muted);margin-bottom:6px}
.ai-usage-fill{height:100%;background:var(--brand);transition:width .2s}
.ai-usage-fill.over{background:var(--bad)}

/* 空态 / 打字指示器 */
.ai-empty{text-align:center;padding:48px 16px;color:var(--muted)}
.ai-empty .empty-icon{font-size:32px;opacity:.5;margin-bottom:10px}
.ai-empty-title{font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px}
.ai-typing{display:inline-flex;gap:4px;padding:12px}
.ai-typing i{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:aiBlink 1.2s infinite}
.ai-typing i:nth-child(2){animation-delay:.2s} .ai-typing i:nth-child(3){animation-delay:.4s}
@keyframes aiBlink{0%,100%{opacity:.3;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}

/* 历史列表项 */
.ai-hist-item{display:flex;align-items:center;gap:8px;padding:12px 4px;border-bottom:1px solid var(--line);cursor:pointer}
.ai-hist-item .hi-main{flex:1;min-width:0}
.ai-hist-item .hi-title{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ai-hist-item .hi-preview{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
```

---

## 9. 与现有代码的集成点

### 9.1 `index.html`
1. **入口 FAB + AI 抽屉容器**：放在文件末尾**最后一个 `.mask`（`srKickConfirmMask` 之后、`</body>` 之前）**，即 `line 2149` 之后插入 §7 的整段 HTML。与现有 `.drawer-mask#userDrawerMask`（`line 1494`）同级，统一由脚本控制。
2. **不改动** `.head-actions` 主导航（FAB 为主入口时）；若改用备选导航钮，则在 `line 137` `⚙️ 设置` 之前加一个 `#btnAi` ghost-btn。
3. **CSS**：无需新 link，AI 样式直接追加进 `css/style.css` 末尾（分节注释 `/* ==== AI 助手 ==== */`），随现有 `?v=20261005c` 缓存版本号一起 bump。
4. **JS**：新增 `js/ai-panel.js`，在 `line 1912` `app.js` 之后、`line 1913` inline script 之前加 `<script src="js/ai-panel.js?v=..."></script>`。

### 9.2 `app.js`（或独立 `ai-panel.js`）模块结构建议
沿用现有扁平脚本约定（全局 `$ = s=>document.querySelector(s)`、`esc()`、`lockBodyScroll/unlockBodyScroll` 都已全局可用），AI 模块写成一个自包含 IIFE，**不污染全局**：

```js
/* js/ai-panel.js —— AI 助手模块（自包含 IIFE） */
(function(){
  const mask=$('#aiMask'), drawer=$('.ai-drawer'), fab=$('#aiFab'), dot=$('#aiFabDot');
  let state={ convId:null, anchorProjectId:null, budgetMin:240, sending:false };

  function open(){ mask.hidden=false; lockBodyScroll(); dot.hidden=true; renderMsgs(); }
  function close(){ mask.hidden=true; unlockBodyScroll(); }

  // Tab 切换：.hidden 切 pane
  document.querySelectorAll('.ai-tab').forEach(t=>t.onclick=()=>{
    document.querySelectorAll('.ai-tab').forEach(x=>x.classList.toggle('active',x===t));
    ['chat','history','settings'].forEach(k=>$('#aiPane-'+k).hidden = (k!==t.dataset.pane));
  });

  // FAB / 关闭 / 点遮罩关闭
  fab.onclick=open; $('#aiClose').onclick=close;
  mask.addEventListener('click',e=>{ if(e.target===mask) close(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && !mask.hidden) close(); });

  // 时间 chips（复用 .pct-chip.active 手感）
  document.querySelectorAll('.ai-timechips .pct-chip').forEach(c=>c.onclick=()=>{
    document.querySelectorAll('.ai-timechips .pct-chip').forEach(x=>x.classList.remove('active'));
    c.classList.add('active'); state.budgetMin = +c.dataset.min;
  });

  // 发送：用户气泡 → typing 指示器 → SSE 流式填 AI 气泡 → 建议卡
  async function send(){ /* POST /api/ai/chat, body 带 budgetMin/context.projectId */ }

  // 建议卡：渲染 action 行 → 勾选 → 应用选中 → /api/ai/apply → 撤销 → /api/ai/undo
  // 应用成功/撤销后调现有全局 toast('已写入系统 · 可随时撤销')

  // 红点：每日本地巡检命中主动触达规则时 dot.hidden=false
  window.AI_PANEL={ open, close, setAnchor:pid=>{state.anchorProjectId=pid}, ping:()=>{dot.hidden=false} };
})();
```

**与主界面的耦合点（最小化）**：
- 项目锚定：在现有「切换项目/进入项目」渲染处，调 `window.AI_PANEL.setAnchor(project.id)` 更新头部 chip；**不在主界面重排任何既有布局**。
- 主动触达：App 启动渲染后跑一次本地巡检，命中则 `window.AI_PANEL.ping()` 点亮 FAB 红点——仅此一行钩子。
- 应用 action 成功后，复用现有 `render()` 重绘主界面（建议改的是 store，主界面自然刷新），不直接操作 DOM。

### 9.3 `style.css` 新增样式组织位置
- 在文件**最末尾**（`.storage-bar` 等现有工具类之后）新增 `/* ==== AI 助手 ==== */` 分节，即 §8 全部片段。
- `:root` 与 `html[data-theme="dark"]` 的 `--ai-*` 别名分别追加到现有 `:root`（`line 3`）与深色块（`line 1273`）末尾，**不改任何现有变量值**。

---

## 10. 硬约束自检表

| 硬约束 | 本方案落地 |
|---|---|
| AI 模块独立内聚 | 独立 FAB 入口 + 抽屉内对话/历史/设置三 Tab；全局「⚙️ 设置」页零 AI 选项（§3.5、§9.3 明确） |
| 入口低调 | FAB 36px 圆钮 ≤40px；红点 8px 仅右上，不弹窗不横幅（§2） |
| 简洁卡片式 | 气泡=结论加粗+理由小字；建议卡每 action 一行勾选+人话标签（§4） |
| 纸感学院派统一 | 100% 复用 `--card/--brand/--line` 等变量与 `.card/.primary/.pct-chip/.storage-bar/.honest-hint` 现成类（§1.4、§6） |
| 深浅色适配 | 全部走变量；仅 3 个 `--ai-*` 别名需在深色块补值（§6 对照表） |
| 无复杂动效 | 开合复用 `drawIn .2s`，红点淡入 .15s，打字三点呼吸；无粒子/视差（§1.3、§8） |
| 不挤压主界面 | 抽屉浮层 400px fixed，z-index 130 盖在主界面之上，主布局零重排（§3、§9.2） |
