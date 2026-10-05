# Study Tracker 全局总审报告（只审不改）

复审日期：2026-10-04
复审范围：6 个专项代理全部问题清单 + 组织者已应用修复逐条验证
约束遵守：不做 store 增量缓存 / 术语按类型感知 / 自习室不加审核 / 不做浏览器 E2E / 纸感学院派视觉

---

## 一、确认要修的问题

### P0（必须本轮修）

#### P0-1 删除单条 item / 打卡记录不写墓碑，同步后被复活 ⚠️ 最严重

**问题确认**：已读代码确认真实存在。

- 项目级删除写了墓碑（app.js:11033、11076 `store.tombstones[p.id]=Date.now()`），后端 `mergeProjects`（syncMerge.js:131-135）和前端 `applyTombstones`（auth.js:559）都检查项目级墓碑。
- **但单条 item 删除**（app.js:12095 `p.items.splice(idx,1)`）和**单条记录删除**（app.js:12039/12058/12076）都**不写墓碑**。
- 后端 `mergeItems`（syncMerge.js:84-120）和 records union（syncMerge.js:149-160）**完全不检查 item/record 级墓碑**。
- 复活场景：A 设备删 item X（items 去掉 X，p.updatedAt=T1）；B 设备离线仍有 X，T2>T1 时复习 X（X.updatedAt=T2）；B 同步后，base=B（T2 更新），mergeItems 把 X' 保留 → **X 复活**。records 同理。

**修改方案（4 个文件，代码级）**：

1. **frontend/js/app.js — 删除 item 时写墓碑（~12095 行）**
```js
// 在 const [removed] = p.items.splice(idx, 1); 之后
store.tombstones[id] = Date.now();          // 新增
p.updatedAt = Date.now();
// undo 回调内（~12101）：
p.items.splice(Math.min(idx, p.items.length), 0, removed);
delete store.tombstones[id];                // 新增：撤销时清墓碑
```

2. **frontend/js/app.js — 删除 record 时写墓碑（~12039/12058/12076 行）**
```js
// 单条 rid 删除（套卷/习题册）：
const [removed] = p.records.splice(idx, 1);
if (removed.rid) store.tombstones[removed.rid] = Date.now();   // 新增
// undo 内：
p.records.splice(...);
if (removed.rid) delete store.tombstones[removed.rid];          // 新增
// 按日期批量删除（~12076）：对 removed 数组每条写墓碑，undo 时逐条删除
```

3. **frontend/js/auth.js — mergeItems 增加墓碑过滤 + records union 过滤**
```js
// mergeStores 内（~621 行），mergeItems 调用改为传入 tombstones：
//   mergedP.items = mergeItems(base.items, other.items, out.tombstones);
// records union（~640）：
var extra = other.records.filter(function(r){
  return r.rid && !have.has(r.rid) && !(out.tombstones[r.rid]);   // 新增墓碑过滤
});
// mergeItems 函数签名加 tombstones 参数，consider() 内：
function consider(it){
  if (!it || !it.id) return;
  if (tombstones && tombstones[it.id] &&
      (Number(it.updatedAt)||0) <= Number(tombstones[it.id])) return;  // 墓碑后修改才活
  ...
}
```

4. **backend/utils/syncMerge.js — mergeItems 加墓碑参数 + records union 过滤**
```js
// mergeProjects 内 records union（~151）：
var extra = other.records.filter(function(r){
  return r.rid && !have.has(r.rid) && !(tombstones[r.rid]);       // 新增
});
// mergeItems 调用改为 mergeItems(base.items, other.items, tombstones)
// mergeItems 签名加 tombstones，consider() 内同前端逻辑
```

**风险评估**：
- 安全：id 由 genId()（时间戳+随机）生成，project/item/rid 命名空间不冲突，扁平 tombstones map 无碰撞。
- LWW 语义：item 墓碑规则 `item.updatedAt <= tombstone` → 墓碑后另一台设备真的复习过该条目（updatedAt 更新），条目合法复活，与项目级墓碑语义一致。records 无 updatedAt，墓碑即永久抑制（记录不可编辑，删除即终态）。
- 30 天 GC：与现有项目墓碑一致，超 30 天的旧副本理论上可复活——已知局限，可接受。
- undo：5 秒撤销内 splice 回去的同时 delete 墓碑，不会误抑制。
- **不影响**间隔重复、分散算法、隐私开关、权限校验。

---

### P1（建议本轮修）

#### P1-1 安全：reset-password 对未注册邮箱返回"该邮箱未注册"，可枚举邮箱

- **文件**：backend/routes/auth.js:345
- **现状**：send-code（:115）已做统一文案防枚举；但 reset-password（:345）`if (!row || row.deleted_at != null) return fail(res, '该邮箱未注册')` 直接暴露账号是否存在。
- **方案**：未注册/已注销时不暴露具体原因，改为统一提示"验证码不正确或邮箱未注册"或直接返回成功但不执行重置（与 send-code 口径对齐）。最简单：改为 `return fail(res, '验证码错误或邮箱未注册', 400)`，不区分"邮箱不存在"和"验证码错"。
- **风险**：低。用户体验略降（真输错验证码时提示不够精确），但安全收益明确。

#### P1-2 后端 GET /member/:userId 不允许自看（前端修了但后端漏了）

- **文件**：backend/routes/studyRoom.js:378
- **现状**：前端 onMemberAvatarClick（app.js:12748）已加 `!m.publicData && !m.isSelf` 放行自看；但后端 :378 `if (target.publicFlag !== 1) return ok(res, { profile: null })` 不区分 target 是否为自己。隐私关闭时（publicFlag=0），点自己头像 → 后端返回 null → 前端弹"未公开"遮罩，**自己看不到自己详情**。
- **方案**：:378 改为 `if (target.publicFlag !== 1 && targetUserId !== me) return ok(res, { profile: null });`
- **风险**：零。自己看自己数据天经地义，不泄露给他人。

#### P1-3 未来日期计划圆点几乎看不见（有效透明度 17.5%）

- **文件**：frontend/css/style.css:996, 1004
- **现状**：`.wb-cal-future{opacity:.35}` 整体压暗未来格；`.wb-cal-cell.wb-cal-future .wb-cal-plan-dot{opacity:.5}` 再压圆点。有效 .35×.5=17.5%，几乎不可见。
- **方案**：
  - :996 改为 `.wb-cal-future .wb-cal-num{opacity:.5}`（只弱化数字，不弱化格子底色和圆点），删除 `.wb-cal-future{opacity:.35}`。
  - :1004 删除或改为 `.wb-cal-cell.wb-cal-future .wb-cal-plan-dot{opacity:.9}`。
  - 未来格底色仍为 hm-0（浅色），与今天格的 brand 色轮廓自然区分，不需要整体压暗。
- **风险**：低。只影响视觉，不改数据。

#### P1-4 深色 hm-0 (#324465) 与热力图 wrap 背景 (--input #2c3f63) 太接近

- **文件**：frontend/css/style.css:943
- **现状**：深色 `--hm-0:#324465`，wrap 背景 `var(--input)`=#2c3f63，两色亮度差极小，空格子几乎融进背景。
- **方案**：:943 `--hm-0:#324465` → `--hm-0:#3c5078`（提亮一档，与 #2c3f63 拉开 8-10 个亮度阶）。
- **风险**：零。只改深色一个变量。

#### P1-5 遗漏文案："这个错因已经存在啦～"（app.js:11629）

- **文件**：frontend/js/app.js:11629
- **现状**：组织者已修 :245 为"这个错因已经存在"，但 :11629 仍为 `alert('这个错因已经存在啦～')`。
- **方案**：改为 `alert('这个错因已经存在');`
- **风险**：零。

#### P1-6 遗漏内联警示色：index.html:840 仍为 #96600c

- **文件**：frontend/index.html:840
- **现状**：组织者已修 :489、:564 为 var(--warn)，但 :840 `<b style="color:#96600c">此切换不可逆。</b>` 漏改。深色模式下 #96600c 偏暗看不清。
- **方案**：改为 `style="color:var(--warn)"`。
- **风险**：零。

#### P1-7 wrongStreak 退档后不归零，导致每次 forgot 都额外退档

- **文件**：frontend/js/app.js:3440-3443
- **现状**：
  - forgot 1：wrongStreak=1，stage=s0
  - forgot 2：wrongStreak=2 ≥ rollbackAfter(2)，stage=s0-1
  - forgot 3：wrongStreak=3 ≥ 2，stage=max(0, s0-1-1)=s0-2 ← **不应再退**
  - 连续 forgot 会无限退档到 0，且 wrongStreak 只增不减。
- **方案**：退档后清零 wrongStreak：
```js
// :3440-3443 改为：
var wrongStreak = wrongStreak0 + 1;
var stage = s0;
if (wrongStreak >= rollbackAfter) {
  stage = Math.max(0, s0 - 1);
  wrongStreak = 0;   // 退档后重置，需再连续 forgot 2 次才再退
}
return { stage, gap: firstGap, wrongStreak };
```
- **风险**：低。需同步检查 recomputeItemMastery（:3468 回放历史）也走同一 transitionReview，逻辑自动一致。老数据 wrongStreak 值偏大不影响（回放时重新计算）。

---

### P2（可选，时间够再修）

| # | 问题 | 文件:行 | 方案 | 风险 |
|---|------|---------|------|------|
| P2-1 | 首次学习三档 firstGap=1 时 good/fuzzy/forgot 都=1 天 | app.js:3421-3422 | 天粒度最小 1 天，物理上无法区分。可接受现状，或 forgot 排 gap=0（当天再学一次）。建议**不改**，加注释说明天粒度局限。 | — |
| P2-2 | 第 0 轮 fuzzy 与 good 间隔相同（都=intervals[1]=2） | app.js:3437 | curGap=1 时 max(2, round(1*1.3))=2=nextGap，fuzzy 约束不生效。可改为 fuzzy 在 stage 0 时 gap=1。低优先级。 | 低 |
| P2-3 | .primary:disabled 硬编码 #d8cfc0 深色下违和 | style.css:170 | 加 `html[data-theme="dark"] .primary:disabled{background:#4a628e;color:#8aa0c0}` | 零 |
| P2-4 | 完成率分子按事件计数（actual.length）应按题目数（actualGroups.length） | app.js:9412 | 已算 actualGroups（:9446），但 :9412 在它之前执行。把 pct 计算移到 actualGroups 之后，用 actualGroups.length。 | 零 |
| P2-5 | 未来复习计划首行重复列出今天 | app.js:9457 | `d >= todayVal` 改为 `d > todayVal`（今天已在"当天计划复习"展示） | 零 |
| P2-6 | itemHtml 未防御 it.content 为空 | app.js:9435, 9459 | `esc(it.content).slice(0,80)` 前加 `||''`；`it.content.length>80` 改为 `(it.content||'').length>80` | 零 |
| P2-7 | mergeItems 注释"字段级 LWW"实际整对象覆盖 | syncMerge.js:13, 109 | 改注释为"整对象 LWW（选 updatedAt 较新的整条 item）"，不改逻辑。 | 零 |
| P2-8 | 进度曲线图例 #b8b7cc / #ffb020 硬编码 | index.html:404-405 | 图表专用色，深浅色下都可读，**建议不改**。 | — |
| P2-9 | 输入框聚焦底色 #fff 深色下刺眼 | style.css:152-153 | 已有深色覆盖（:1209 textarea），input 的 focus 背景 #fff 在深色下应改为 var(--elevated)。低优先级。 | 低 |
| P2-10 | 空数据时统计卡仍显示 0 | app.js:9335 vs 9349 | totalReviews=0 时隐藏 .wb-heat-stats。纯视觉，低优先级。 | 零 |
| P2-11 | 格子无键盘焦点（可访问性） | style.css:962, 986 | wb-cal-cell 加 tabindex="0" + focus-visible 样式。低优先级。 | 低 |

---

## 二、标记为"不实施"的问题

| 问题 | 不实施原因 |
|------|-----------|
| 热力图 store 层增量缓存 | **用户已决策**：保持"每次打开看板重算 + 月份切换复用 _hmCache"。 |
| 自习室申请/审核机制 | **用户已决策**：公开房直接加入、私有房凭房间号加入，不加审核。 |
| 浏览器端到端测试 | **用户已决策**：不做。 |
| /join COUNT+INSERT 不在同一事务 | better-sqlite3 同步执行 + UNIQUE(user_id) 约束，竞态天然安全（studyRoom.js:300 已捕获 UNIQUE 冲突）。 |
| 30 天墓碑 GC + 客户端 wall-clock | 已知架构局限，文档已承认。国内用户时区无偏差（UTC+8 对齐）。 |
| admin /users/:id 全表扫 invite_codes | P0 性能，但需加索引/改查询，本轮范围外。建议下轮加 `CREATE INDEX`。 |
| 打卡记录列表全量渲染无分页 | P0 性能，但数据量通常 <500 条，DOM 可承受。下轮再做虚拟滚动。 |
| app.js 670KB 无 defer/拆分 | P0 性能，但拆包涉及构建工具链，本轮不做。已加 defer 即可（检查 index.html script 标签）。 |
| render() 全量重渲染 | 已知架构局限，重写成本极高。 |
| SW 预缓存 387KB paper-dark.jpg | 壁纸资源，首次加载后命中缓存，影响小。 |
| nginx Docker 缺 gzip_static | 部署层优化，不影响功能。 |
| 自习室被踢后 30 秒才感知 | 轮询间隔设计，实时推送需 WebSocket，本轮不做。 |
| 房主转让后无通知 | MVP 阶段，leave 接口已返回 transferredTo，前端可 toast。低优先级。 |
| 三视图高度跳变 | min-height 已固定（:1855/1904），残留跳动可接受。 |
| 软删除用户未清理自习室成员 | 边缘 case，软删除后用户不可登录，自习室成员记录残留无安全影响。 |
| bcrypt rounds=10 / JWT 30 天 | 安全硬ening 项，非本轮范围。 |

---

## 三、已应用修复的验证结果

### CSS/HTML 类

| 修复项 | 验证结果 |
|--------|----------|
| 热力图格子 height:60px（移动 48px），min-height 240px，空格 hm-0+opacity:.3 | ✅ 正确。style.css:986 height:60px；:1048 移动 48px；:985 min-height:240px；:987 empty 用 hm-0+opacity:.3。 |
| 深色 hm-0 #45587f→#324465 | ✅ 正确。:943 `--hm-0:#324465`。（但与 wrap #2c3f63 太接近，见 P1-4） |
| 深色 hd-future-day 加 background:var(--input) | ✅ 正确。:1035。 |
| 热力图底部 margin 16→24px | ✅ 正确。:945 `margin:0 0 24px`。 |
| 自习室返回按钮 x-btn→ghost-btn | ✅ 正确。index.html:1862 `class="ghost-btn" id="srBackBtn"`。 |
| undoBar 内联色→CSS 变量 | ✅ 正确。index.html:93 用 var(--card)/var(--text)/var(--brand)。 |
| honest-hint fdf6e3→#fdf6e3 | ✅ 正确。style.css:80。 |
| .mask 删除 backdrop-filter | ✅ 正确。:671 无 backdrop-filter。 |
| .sync-indicator 删除 box-shadow 发光 | ✅ 正确。:1482-1484 无 box-shadow。 |
| .skip-btn #8a8175→var(--muted) | ✅ 正确。:1053 `color:var(--muted)`。 |
| .review-done-tag 深色覆盖 | ✅ 正确。:1062。 |
| sr-detail-avatar/sr-owner-badge/sr-status-ok/sr-form-error/sr-fullmask 深色覆盖 | ✅ 全部正确。:1896-1900。 |
| .toast 深色阴影覆盖 | ✅ 正确。:813。 |
| 图例圆点 #2e6b4f→var(--brand) | ✅ 正确。index.html:403。（#b8b7cc/#ffb020 未改，见 P2-8） |
| 内联警示色 #96600c→var(--warn)（2处） | ⚠️ **部分遗漏**。:489、:564 已改；**:840 仍为 #96600c**（见 P1-6）。 |

### 文案类

| 修复项 | 验证结果 |
|--------|----------|
| 页脚"加密存储"→"默认保存在本设备…云端同步备份"（2处） | ✅ 正确。index.html:118、:427。 |
| 数据安全弹窗"不会上传服务器"→"未登录…登录后自动同步"（2处） | ✅ 正确。app.js:12337、:12360。鸡汤结尾已删。 |
| 注销弹窗补本地数据清除+导出备份 | ✅ 正确。index.html:1430。 |
| 自习室"和小伙伴一起"→"与同学互相监督、坚持打卡" | ✅ 正确。index.html:1869。 |
| "已经存在啦～"→"已经存在"（2处） | ⚠️ **部分遗漏**。:245 已改；**:11629 仍为"已经存在啦～"**（见 P1-5）。 |
| 房间设置"申请加入"→"直接加入" | ✅ 正确。index.html:2081 描述文案，无"申请加入"按钮。 |

### 术语类

| 修复项 | 验证结果 |
|--------|----------|
| hm-badge-done 按 pRef.type 动态 | ✅ 正确。app.js:9424 `pRef.type==='mistake'?'已攻克':'已掌握'`。 |
| 薄弱点统计卡"已掌握"→"已攻克" | ✅ 正确。:9241 `isMistake?'已攻克':'已掌握'`。 |
| "从已掌握中随机抽查"→按类型 | ✅ 正确。:9220-9221。 |
| 确认掌握弹窗标题动态 | ✅ 正确。:3585 `p.type==='mistake'?'确认攻克了吗？':'确认掌握了吗？'`。 |
| 单元列表"掌握度/已掌握"动态 | ✅ 正确。:6100。 |
| app.js 顶部术语口径注释 | ✅ 正确。:1-8。 |
| 变量名 isMastered/mastered 未动 | ✅ 确认未全局替换。 |

### 自习室功能类

| 修复项 | 验证结果 |
|--------|----------|
| 广场返回键先退引导页/房间主页 | ✅ 正确。app.js:13276-13280。 |
| 自己看自己详情前端放行 | ✅ 前端正确。:12748 `!m.publicData && !m.isSelf`。**但后端漏改**（见 P1-2）。 |
| 房间号前端正则 [A-Z0-9]→[A-HJ-NP-Z2-9] | ⚠️ 基本正确但有小瑕疵。:12906、:13189 已改。但 [A-HJ-NP-Z2-9] 中 J-N 包含 L，而后端 ROOM_CODE_CHARS（studyRoom.js:31）排除了 L。用户输入 L 会通过前端校验但后端查无此房。不影响安全，建议前端正则改为 `[A-HJKMNP-Z2-9]`（把 L 排除）。 |

---

## 附录：本轮发布前必做清单

1. **P0-1**：4 个文件加 item/record 墓碑（见上文代码级方案）。
2. **P1-1**：auth.js:345 reset-password 统一文案。
3. **P1-2**：studyRoom.js:378 加 `targetUserId !== me` 放行自看。
4. **P1-3/4**：CSS 未来格圆点透明度 + 深色 hm-0 提亮。
5. **P1-5/6**：两处遗漏文案/色值。
6. **P1-7**：wrongStreak 退档后归零。
7. **SW 版本**：yystudy-v31→v32；index.html `?v=20261004c`→`?v=20261004d`。
