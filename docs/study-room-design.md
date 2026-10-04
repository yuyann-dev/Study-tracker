# 自习室（Study Room）功能产品设计文档

> 版本：v1.0
> 日期：2026-10-04
> 状态：待开发
> 关联项目：Study Tracker (yystudy.top)



***

## 一、功能概述

### 1.1 目标

在现有个人记忆追踪工具基础上，增加轻量社交功能「自习室」，让用户可以创建 / 加入一个学习小组，看到彼此的打卡状态，形成同伴监督效应，提升日常复习坚持率。

### 1.2 核心原则



* **轻量**：自习室不是群聊，没有消息流，只有 "谁在学、谁今天学了多少"。

* **隐私优先**：默认不公开任何数据，用户主动开关后才暴露。

* **MVP 收敛**：不做聊天、不做排行、不做邀请链接，只做房间号 + 成员列表 + 数据可见性。



***

## 二、产品决策点结论

### 决策 1：一个用户同时只能加入 1 个自习室

**结论：同时只能加入 1 个。**

理由：



* 自习室的核心价值是 "固定的同伴圈带来持续的监督感"。加入多个会稀释归属感，也会导致同一个人在多个房间重复展示，管理复杂化。

* 这是个人学习工具的轻量社交扩展，不是 IM / 群聊系统，不需要多房间身份。

* 数据模型简单：`user_data` 或 `users` 表加一个 `study_room_id` 字段即可，不需要中间关联表。

UI 方案：



* 导航栏只有一个「自习室」入口按钮。

* 进入后根据用户状态展示：


  * **未加入任何房间**：创建 / 加入二选一引导页。

  * **已加入房间**：房间成员列表页。

* 用户想换房间时，必须先退出当前房间，再创建 / 加入新房间。退出流程有二次确认。



***

### 决策 2：未公开数据的用户，其他成员能看到什么

**结论：头像 + 用户名可见；今日打卡状态和具体数字全部隐藏；点击头像提示 "该用户未公开学习数据"。**

具体可见性矩阵：



| 信息       | 公开数据的成员      | 未公开数据的成员           |
| -------- | ------------ | ------------------ |
| 头像       | 可见           | 可见（👤 默认头像）        |
| 用户名      | 可见           | 可见                 |
| 今日是否打卡   | 可见（绿点 / 红点）  | 不可见（显示灰点 "已隐藏"）    |
| 今日打卡次数   | 可见（数字）       | 不可见（显示 "—"）        |
| 点击头像查看详情 | 弹窗展示热力图 + 统计 | 弹窗仅显示 "该用户未公开学习数据" |
| 加入房间时间   | 不可见（不展示）     | 不可见                |

理由：



* 头像 + 用户名是 "成员身份" 的最小必要信息，否则房间里一堆匿名头像就失去了同伴感。

* 今日打卡状态属于 "学习数据" 范畴，纳入隐私开关。不公开的人连 "今天学没学" 都不让别人知道。

* 这样隐私边界清晰：你公开的是 "我学了多少"，不公开时连 "我学没学" 都属于隐私。



***

### 决策 3：房间号格式

**结论：6 位大写字母 + 数字，去除易混淆字符（0/O, 1/I, L）。**

字符集：



* 字母：A-Z 去掉 I、L、O → 23 个

* 数字：2-9 去掉 0、1 → 8 个

* 总字符集：31 个字符

* 组合数：31⁶ ≈ 8.87 亿，足够长期使用

生成规则：



* 创建房间时随机生成，**不带人工输入**（用户不能自定义房间号）。

* 生成后展示给创建者，创建者可以复制分享给朋友。

* 加入时用户手动输入房间号，前端自动 `toUpperCase()` + `trim()`。

* 后端校验房间号格式：`/^[A-Z2-9]{6}$/`（注意 I/L/O/0/1 已排除）。

为什么去除易混淆字符：



* 自习室场景下，房间号通常靠口头 / 微信分享，0/O、1/I、l/L 极易混淆，导致加错房间。

* 31 字符集虽然组合数略减，但 8.87 亿对一个小工具来说绰绰有余。



***

### 决策 4：自习室解散逻辑

**结论：创建者退出时 —— 若房间还有其他成员，自动转让给最早加入的成员（按 joined\_at 排序，排除创建者后的第一人）；若房间只剩创建者 1 人，退出即解散房间。不做手动转让管理员功能（MVP 阶段）。**

流程：



1. 创建者点击「退出房间」。

2. 前端弹窗确认：

* 如果房间有其他成员：提示 "退出后，房间将自动转让给最早加入的成员 XXX，确定退出吗？"

* 如果只有自己：提示 "退出后房间将解散，确定退出吗？"

1. 确认后调用退出 API。

2. 后端事务：

* 查询房间成员列表（排除自己）。

* 如果有成员：将 `owner_id` 更新为最早加入者的 user\_id，删除自己的成员记录。

* 如果无成员：删除房间记录 + 删除所有成员记录。

理由：



* 自动转让比 "必须手动指定继承人" 简单，MVP 不需要管理员交接的复杂流程。

* 最早加入者通常是房间的稳定成员，继承管理员角色合理。

* 不保留空房间：房间没人了就物理删除，不占数据库。



***

### 决策 5：成员详情弹窗显示哪些图表 / 数据

**结论：展示以下 5 项，全部来自该用户的&#x20;**`user_data.store_json`**：**



| 数据项      | 说明                 | 计算方式                                                                |
| -------- | ------------------ | ------------------------------------------------------------------- |
| 🔥 热力图   | 最近一年每日复习活跃度        | 复用现有 `renderHeatmap()` 逻辑，遍历 `projects[].items[].reviews[].date` 统计 |
| 📊 本周复习数 | 周一至周日每天的 review 次数 | 按本地周历统计 reviews.date                                                |
| ⚡ 当前连续打卡 | 连续有复习记录的天数 streak  | 从今天往前数，连续每天至少 1 条 review                                            |
| 📚 总复习数  | 累计所有 review 次数     | count (reviews \[].date) 全量                                         |
| 📁 项目数   | 当前进行中的项目数量         | `user_data.project_count`                                           |

**不展示的内容：**



* 具体项目名称、项目类型、每个项目的进度 —— 保护学习内容隐私。

* 记忆卡片具体内容 —— 绝对不暴露。

* 复习质量分布（quality 分布）——MVP 不做，后续可加。

设计原则：公开的是 "学习活跃度"，不是 "学习内容"。别人能看到你学得多努力，但看不到你在学什么。



***

### 决策 6：今日打卡数统计口径

**结论：当天（UTC+8 时区）所有 project 的所有 item 的 reviews 中，date 等于今天的 review 记录数量。**

统计逻辑：



```
today_review_count = count(
  review in store.projects[*].items[*].reviews[]
  where review.date == today_str  // today_str = 'YYYY-MM-DD'，UTC+8 日期
)
```

时区处理：



* 服务器在阿里云国内（UTC+8），直接用 SQLite `date('now', '+8 hours')` 取今天日期。

* 前端展示时也用本地日期，与后端对齐（目标用户都在国内）。

* 不做用户时区自定义，MVP 阶段假设所有用户都在 UTC+8。

"今日打卡" 的定义：



* 不是 "今天打开了 App"，而是 "今天至少做了一次复习打卡（review）"。

* 今日打卡数 = 今天所有 review 的总条数。如果一个 item 今天复习了 3 次，就算 3。

* 今日是否打卡（是 / 否）= today\_review\_count > 0。



***

## 三、功能清单与用户旅程

### 3.1 功能清单



| 模块     | 功能                              | 优先级 |
| ------ | ------------------------------- | --- |
| 创建房间   | 输入房间名 → 自动生成 6 位房间号 → 成为房主      | P0  |
| 加入房间   | 输入 6 位房间号 → 校验存在 → 加入成功         | P0  |
| 房间主页   | 展示房间名、房间号、成员列表（头像 + 用户名 + 今日状态） | P0  |
| 退出房间   | 退出当前房间（房主退出触发转让 / 解散逻辑）         | P0  |
| 隐私开关   | 设置页中 "公开学习数据到自习室" 开关，默认关闭       | P0  |
| 成员详情弹窗 | 公开数据的用户：展示热力图 + 统计卡片            | P0  |
| 今日状态轮询 | 每 30 秒自动刷新成员今日打卡状态              | P1  |
| 复制房间号  | 一键复制房间号方便分享                     | P1  |
| 离开确认弹窗 | 退出房间时二次确认                       | P0  |

### 3.2 用户旅程

#### 旅程 A：创建自习室



```
用户登录 → 导航栏点击「自习室」
  → 未加入房间页：[创建自习室] [加入自习室]
  → 点击「创建自习室」→ 弹窗输入房间名（必填，最多20字）
  → 确认创建 → 后端生成房间号 → 跳转房间主页
  → 房间主页顶部显示房间号 + [复制] 按钮
  → 底部成员列表只有自己 1 人
```

#### 旅程 B：加入自习室



```
用户登录 → 导航栏点击「自习室」
  → 未加入房间页：[创建自习室] [加入自习室]
  → 点击「加入自习室」→ 弹窗输入 6 位房间号
  → 前端自动转大写、去空格
  → 后端校验房间号存在 + 用户未在其他房间
  → 加入成功 → 跳转房间主页
  → 成员列表显示所有成员
```

#### 旅程 C：查看成员数据



```
房间主页 → 成员列表中点击某个公开数据成员的头像
  → 弹出成员详情弹窗
  → 顶部：头像 + 用户名
  → 中部：热力图（最近一年）
  → 底部：4 个统计卡片（本周复习数 / 连续打卡 / 总复习数 / 项目数）
  → 点击遮罩或关闭按钮关闭弹窗
```

#### 旅程 D：未公开数据的用户点击头像



```
房间主页 → 成员列表中点击某个未公开数据成员的头像
  → 弹出小型提示弹窗
  → 显示：该用户未公开学习数据
  → 只有 [知道了] 按钮
```

#### 旅程 E：修改隐私设置



```
导航栏点击设置（齿轮图标）
  → 设置弹窗 → 找到「自习室隐私」区块
  → 开关：公开我的学习数据到自习室（默认关闭）
  → 开启后，房间内其他成员可看到我的今日打卡状态和点击头像查看详情
  → 关闭后，其他成员看到我的状态为"已隐藏"
```



***

## 四、数据库表设计

### 4.1 新增表：study\_rooms



```
CREATE TABLE IF NOT EXISTS study_rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code   TEXT NOT NULL UNIQUE,          -- 6位房间号（大写，去除易混淆字符）
  name        TEXT NOT NULL,                 -- 房间名（最多20字）
  owner_id    INTEGER NOT NULL REFERENCES users(id),  -- 房主 user_id
  created_at   TEXT DEFAULT (datetime('now')),
  -- 不设 deleted_at：房间没人了直接物理删除
);
```

索引：



```
CREATE INDEX IF NOT EXISTS idx_study_rooms_code ON study_rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_study_rooms_owner ON study_rooms(owner_id);
```

### 4.2 新增表：study\_room\_members



```
CREATE TABLE IF NOT EXISTS study_room_members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL REFERENCES study_rooms(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at   TEXT DEFAULT (datetime('now')),  -- 加入时间，用于自动转让房主时选最早加入者
  UNIQUE(room_id, user_id),                   -- 一个用户在一个房间只能有一条记录
  UNIQUE(user_id)                             -- 一个用户只能在一个房间（全表唯一）
);
```

> **关键约束**
>
> ：
>
> `UNIQUE(user_id)`
>
>  保证一个用户只能加入一个自习室。如果用户已在房间 A，想加入房间 B，必须先退出房间 A。

索引：



```
CREATE INDEX IF NOT EXISTS idx_members_room ON study_room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON study_room_members(user_id);
```

### 4.3 修改 users 表：新增隐私开关列



```
-- 幂等补列
ensureColumn(db, 'users', 'study_room_public', 'INTEGER NOT NULL DEFAULT 0');
```



* `study_room_public`：0 = 未公开（默认），1 = 已公开

* 公开后，自习室内其他成员可见今日打卡状态 + 头像详情弹窗

### 4.4 迁移代码位置

在 `backend/database.js` 的 `runMigrations()` 函数中：



1. 在 `db.exec(...)` 的 SQL 块中加入 `study_rooms` 和 `study_room_members` 的 `CREATE TABLE IF NOT EXISTS`。

2. 在补列区域加入 `ensureColumn(db, 'users', 'study_room_public', 'INTEGER NOT NULL DEFAULT 0')`。

3. 在索引区域加入上述 3 个索引。



***

## 五、API 接口清单

所有接口前缀：`/api/study-room`

全部需要登录（`authRequired` 中间件）。

统一响应格式：`{ ok: true, ... }` / `{ ok: false, error: "..." }`

### 5.1 GET /api/study-room/me

获取当前用户所在的自习室信息（含成员列表和今日状态）。

**用途**：页面加载时判断用户在不在房间，不在房间则显示引导页。

**响应（已在房间）：**



```
{
  "ok": true,
  "room": {
    "id": 1,
    "roomCode": "K7M2PQ",
    "name": "考研自习小分队",
    "isOwner": true
  },
  "members": [
    {
      "userId": 1,
      "username": "张三",
      "avatar": "/uploads/abc.png",
      "isOwner": true,
      "isSelf": true,
      "publicData": true,
      "todayReviewCount": 12,
      "checkedInToday": true
    },
    {
      "userId": 5,
      "username": "李四",
      "avatar": null,
      "isOwner": false,
      "isSelf": false,
      "publicData": false,
      "todayReviewCount": null,
      "checkedInToday": null
    }
  ]
}
```

**响应（未在房间）：**



```
{
  "ok": true,
  "room": null,
  "members": []
}
```

**今日打卡数计算逻辑（后端）：**



```
-- 对每个成员，从 user_data.store_json 中解析 reviews，统计今天的数量
-- 伪代码：
for each member in members:
  if member.publicData == 0:
    todayReviewCount = null  // 不公开，返回 null
    continue
  row = SELECT store_json FROM user_data WHERE user_id = member.userId
  if !row:
    todayReviewCount = 0
    continue
  store = JSON.parse(row.store_json)
  todayStr = date('now', '+8 hours')  -- 'YYYY-MM-DD'
  count = 0
  for project in Object.values(store.projects || {}):
    for item in (project.items || []):
      for review in (item.reviews || []):
        if review.date == todayStr:
          count++
  todayReviewCount = count
  checkedInToday = count > 0
```

**性能考虑**：



* 一个房间最多 10 人（建议限制），每次请求解析 10 个 store\_json，可接受。

* 后续可加缓存：今日打卡数按用户 + 日期缓存，TTL 到当天结束。

### 5.2 POST /api/study-room/create

创建自习室。

**请求体：**



```
{
  "name": "考研自习小分队"
}
```



* `name`：必填，1-20 字符，去除前后空格。

**响应：**



```
{
  "ok": true,
  "room": {
    "id": 1,
    "roomCode": "K7M2PQ",
    "name": "考研自习小分队"
  }
}
```

**错误情况：**



* 400：用户已在某个自习室中，需先退出才能创建。

* 400：房间名为空或超长。

**后端逻辑：**



1. 检查当前用户是否已在 `study_room_members` 中有记录。有则报错 "你已在某个自习室中，请先退出"。

2. 生成唯一房间号（循环生成直到不重复，6 位字符集 `A-Z` 去掉 ILO + `2-9`）。

3. 事务：插入 `study_rooms`（owner\_id = 当前用户）→ 插入 `study_room_members`（room\_id, user\_id）。

### 5.3 POST /api/study-room/join

通过房间号加入自习室。

**请求体：**



```
{
  "roomCode": "K7M2PQ"
}
```



* `roomCode`：必填，6 位。后端自动 `toUpperCase().trim()`。

**响应：**



```
{
  "ok": true,
  "room": {
    "id": 1,
    "roomCode": "K7M2PQ",
    "name": "考研自习小分队"
  }
}
```

**错误情况：**



* 400：房间号格式不对（不是 6 位大写字母数字）。

* 404：房间号不存在。

* 400：用户已在某个自习室中。

* 400：房间人数已满（限制 10 人）。

### 5.4 POST /api/study-room/leave

退出当前所在的自习室。

**请求体：** 无。

**响应：**



```
{
  "ok": true,
  "leftRoom": true,
  "roomDisbanded": false,
  "transferredTo": "王五"  // 仅当是房主且转让了才返回
}
```

**后端逻辑（事务）：**



1. 查询当前用户所在的房间。不在房间则报错 "你不在任何自习室中"。

2. 查询房间成员列表（排除自己，按 joined\_at 升序）。

3. 如果自己是房主（owner\_id == 当前用户）：

* 如果有其他成员：取最早加入者作为新房主，UPDATE study\_rooms SET owner\_id = newOwner。

* 如果没有其他成员：DELETE FROM study\_rooms WHERE id = roomId（级联删除成员记录）。

1. 删除自己的成员记录：DELETE FROM study\_room\_members WHERE room\_id = ? AND user\_id = ?。

### 5.5 GET /api/study-room/member/:userId

获取某个成员的公开学习数据（用于点击头像弹窗）。

**路径参数：**



* `userId`：要查看的用户 ID。

**响应（该用户公开数据）：**



```
{
  "ok": true,
  "profile": {
    "userId": 5,
    "username": "李四",
    "avatar": "/uploads/xyz.png",
    "heatmap": {
      // 最近一年的每日复习数，格式与前端 renderHeatmap 兼容
      // key 是 'YYYY-MM-DD'，value 是当天 review 次数
      "2025-10-01": 3,
      "2025-10-02": 5,
      "...": "..."
    },
    "weekReviewCount": [2, 4, 1, 0, 3, 5, 2],  // 周一到周日
    "currentStreak": 7,       // 连续打卡天数
    "totalReviews": 1245,     // 总复习数
    "projectCount": 8          // 项目数
  }
}
```

**响应（该用户未公开数据）：**



```
{
  "ok": true,
  "profile": null
}
```

**权限校验：**



* 请求者和被查看者必须在同一个自习室。否则返回 403。

* 被查看者的 `study_room_public` 必须为 1。否则返回 `{ ok: true, profile: null }`（不报错，前端弹 "未公开" 提示）。

**后端计算逻辑：**



```
1. 校验请求者和目标用户是否在同一房间。不在 → 403。
2. 查目标用户 users.study_room_public。为 0 → 返回 profile: null。
3. 查目标用户 user_data.store_json。
4. 遍历 projects[].items[].reviews[]：
   - 统计所有 review.date → heatmap（最近一年）
   - 统计本周（周一到周日）每天的数量 → weekReviewCount
   - 计算 currentStreak（从今天往前连续有review的天数）
   - 统计 totalReviews（所有 review 总数）
5. 取 user_data.project_count。
6. 返回结果。
```

### 5.6 PATCH /api/study-room/privacy

更新自己的隐私开关。

**请求体：**



```
{
  "public": true
}
```



* `public`：布尔值，true = 公开，false = 不公开。

**响应：**



```
{
  "ok": true,
  "public": true
}
```

**后端逻辑：**



```
UPDATE users SET study_room_public = ? WHERE id = ?
```



***

## 六、前端页面与弹窗布局

### 6.1 导航栏入口

在 `<nav class="head-actions">` 中添加一个按钮：



```
<button class="ghost-btn" id="studyRoomNavBtn" title="自习室">
  🏫 自习室
</button>
```

点击后调用 `openStudyRoomPage()`。

### 6.2 自习室主页面（全屏覆盖层）

用 `<div class="mask" hidden id="studyRoomMask">` 实现全屏模态。



```
┌─────────────────────────────────┐
│  ← 返回        自习室             │  ← 顶部导航栏
├─────────────────────────────────┤
│                                 │
│   ┌─────────────────────────┐   │
│   │  房间名：考研自习小分队  │   │
│   │  房间号：K7M2PQ  [复制] │   │
│   │  成员数：3/10           │   │
│   └─────────────────────────┘   │
│                                 │
│   成员列表：                     │
│                                 │
│  ┌─────────────────────────┐   │
│  │  👤 张三(房主)   ✅ 今日 12 │   │  ← 公开数据成员
│  │     点击头像查看详情 →    │   │
│  ├─────────────────────────┤   │
│  │  👤 李四         🔒 已隐藏 │   │  ← 未公开数据成员
│  │     点击头像查看详情 →    │   │
│  ├─────────────────────────┤   │
│  │  👤 王五         ✅ 今日 5  │   │
│  └─────────────────────────┘   │
│                                 │
│  [退出自习室]                   │
│                                 │
└─────────────────────────────────┘
```

**元素 ID 标注：**



| 元素     | ID              | 说明        |
| ------ | --------------- | --------- |
| 全屏遮罩   | `studyRoomMask` | 最外层 mask  |
| 房间名标题  | `srRoomName`    | 显示房间名     |
| 房间号    | `srRoomCode`    | 显示 6 位房间号 |
| 复制按钮   | `srCopyCodeBtn` | 点击复制房间号   |
| 成员数    | `srMemberCount` | "3/10"    |
| 成员列表容器 | `srMemberList`  | 动态渲染成员卡片  |
| 退出按钮   | `srLeaveBtn`    | 底部红色按钮    |

**成员卡片动态生成结构：**



```
<div class="sr-member-card" data-user-id="5">
  <div class="sr-member-avatar" data-user-id="5">
    <!-- 有头像则 <img src="/uploads/xxx.png">，否则显示 👤 -->
  </div>
  <div class="sr-member-info">
    <div class="sr-member-name">李四 <span class="sr-owner-badge">房主</span></div>
    <div class="sr-member-status">
      <!-- 公开数据：✅ 今日复习 12 次 -->
      <!-- 未公开：🔒 数据已隐藏 -->
    </div>
  </div>
</div>
```

### 6.3 未加入房间引导页

当用户不在任何房间时，`studyRoomMask` 内显示：



```
┌─────────────────────────────────┐
│  ← 返回        自习室             │
├─────────────────────────────────┤
│                                 │
│        📚 加入自习室，            │
│      和小伙伴一起坚持复习         │
│                                 │
│   ┌─────────────────────────┐   │
│   │   🏠 创建自习室          │   │
│   │   创建房间，邀请朋友加入   │   │
│   └─────────────────────────┘   │
│                                 │
│   ┌─────────────────────────┐   │
│   │   🔑 加入自习室          │   │
│   │   输入房间号加入房间      │   │
│   └─────────────────────────┘   │
│                                 │
└─────────────────────────────────┘
```

**元素 ID：**



| 元素   | ID            |
| ---- | ------------- |
| 创建按钮 | `srCreateBtn` |
| 加入按钮 | `srJoinBtn`   |

### 6.4 创建房间弹窗



```
┌──────────────────────┐
│  创建自习室           │
├──────────────────────┤
│                      │
│  房间名：             │
│  ┌────────────────┐  │
│  │ 考研自习小分队  │  │  ← input#srCreateNameInput
│  └────────────────┘  │
│  最多 20 个字         │
│                      │
│  创建后自动生成房间号  │
│                      │
│  [取消]    [创建]     │
└──────────────────────┘
```

**元素 ID：**



| 元素     | ID                   |
| ------ | -------------------- |
| 遮罩层    | `srCreateMask`       |
| 房间名输入框 | `srCreateNameInput`  |
| 确认按钮   | `srCreateConfirmBtn` |
| 取消按钮   | `srCreateCancelBtn`  |

### 6.5 加入房间弹窗



```
┌──────────────────────┐
│  加入自习室           │
├──────────────────────┤
│                      │
│  输入房间号：         │
│  ┌────────────────┐  │
│  │ K7M2PQ         │  │  ← input#srJoinCodeInput，自动大写
│  └────────────────┘  │
│  6 位字母或数字       │
│                      │
│  [取消]    [加入]     │
└──────────────────────┘
```

**元素 ID：**



| 元素     | ID                 |
| ------ | ------------------ |
| 遮罩层    | `srJoinMask`       |
| 房间号输入框 | `srJoinCodeInput`  |
| 确认按钮   | `srJoinConfirmBtn` |
| 取消按钮   | `srJoinCancelBtn`  |

### 6.6 成员详情弹窗（公开数据）

点击公开数据成员的头像后弹出：



```
┌─────────────────────────────────┐
│              ✕                   │
│                                 │
│         👤 张三                  │
│                                 │
│  ┌─────────────────────────┐    │
│  │                         │    │
│  │    🔥 复习热力图         │    │  ← 复用 renderHeatmap()
│  │    （最近一年）          │    │
│  │                         │    │
│  └─────────────────────────┘    │
│                                 │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌───┐ │
│  │本周  │ │连续  │ │总复习│ │项目│ │
│  │复习数│ │打卡  │ │     │ │数  │ │
│  │ 17  │ │ 7天  │ │1245 │ │ 8 │ │
│  └─────┘ └─────┘ └─────┘ └───┘ │
│                                 │
└─────────────────────────────────┘
```

**元素 ID：**



| 元素    | ID                   |
| ----- | -------------------- |
| 遮罩层   | `srMemberDetailMask` |
| 头像容器  | `srDetailAvatar`     |
| 用户名   | `srDetailUsername`   |
| 热力图容器 | `srDetailHeatmap`    |
| 本周复习数 | `srDetailWeekCount`  |
| 连续打卡  | `srDetailStreak`     |
| 总复习数  | `srDetailTotal`      |
| 项目数   | `srDetailProjects`   |
| 关闭按钮  | `srDetailCloseBtn`   |

### 6.7 成员详情弹窗（未公开数据）



```
┌──────────────────────┐
│         ✕            │
│                      │
│        🔒            │
│                      │
│   该用户未公开        │
│     学习数据          │
│                      │
│   [知道了]           │
└──────────────────────┘
```

**元素 ID：**



| 元素    | ID               |
| ----- | ---------------- |
| 遮罩层   | `srPrivateMask`  |
| 知道了按钮 | `srPrivateOkBtn` |

### 6.8 退出确认弹窗



```
┌──────────────────────┐
│  退出自习室           │
├──────────────────────┤
│                      │
│  （房主+有成员时）     │
│  退出后，房间将自动    │
│  转让给最早加入的成员  │
│  「王五」。确定退出？  │
│                      │
│  （房主+仅自己时）     │
│  退出后房间将解散。    │
│  确定退出？           │
│                      │
│  （普通成员时）        │
│  确定退出这个自习室？  │
│                      │
│  [取消]    [确认退出] │
└──────────────────────┘
```

**元素 ID：**



| 元素   | ID                   |
| ---- | -------------------- |
| 遮罩层  | `srLeaveConfirmMask` |
| 提示文案 | `srLeaveConfirmText` |
| 确认按钮 | `srLeaveConfirmBtn`  |
| 取消按钮 | `srLeaveCancelBtn`   |

### 6.9 设置页隐私开关

在现有设置弹窗（settingsMask）中新增一个区块：



```
┌─────────────────────────┐
│  自习室隐私              │
├─────────────────────────┤
│  公开我的学习数据到自习室 │
│  ┌───┐                  │
│  │ ◯ │  关闭（默认）     │  ← 开关 switch
│  └───┘                  │
│                          │
│  开启后，自习室成员可看到  │
│  你的今日打卡状态和学习图表│
└─────────────────────────┘
```

**元素 ID：**



| 元素   | ID                       |
| ---- | ------------------------ |
| 隐私开关 | `settingStudyRoomPublic` |



***

## 七、隐私控制完整逻辑

### 7.1 隐私数据流



```
用户设置 study_room_public = true/false
         │
         ├── false（默认）──→ 其他成员看到：
         │                    - 头像 + 用户名 ✓
         │                    - 今日状态：🔒 已隐藏
         │                    - 点击头像："该用户未公开学习数据"
         │
         └── true ──────→ 其他成员看到：
                              - 头像 + 用户名 ✓
                              - 今日状态：✅ 今日复习 N 次
                              - 点击头像：热力图 + 统计数据
```

### 7.2 后端数据返回规则

在 `GET /api/study-room/me` 返回成员列表时：



```
// 对每个成员，根据其 publicData 决定返回字段
if (member.publicData === 0) {
  // 未公开：只返回身份信息，不返回任何学习数据
  member.todayReviewCount = null;
  member.checkedInToday = null;
  // username 和 avatar 照常返回
} else {
  // 公开：计算并返回今日打卡数
  member.todayReviewCount = computeTodayReviewCount(member.userId);
  member.checkedInToday = member.todayReviewCount > 0;
}
```

**关键原则：未公开用户的任何学习相关数字（包括 "今天有没有打卡"）都不返回。前端收到 null 就显示 "已隐藏"。**

### 7.3 跨房间数据隔离



* 用户 A 只能看到同房间内其他成员的数据。

* `GET /api/study-room/member/:userId` 必须校验请求者和目标用户在同一房间。

* 不在同一房间 → 403，不返回任何数据。

### 7.4 自我可见性



* 自己永远可以看到自己的完整数据（在自己的学习主页）。

* 在自习室成员列表中，自己的卡片也显示自己的真实今日打卡数（不需要对自己隐藏）。

* 自己的隐私开关只影响**别人**看你，不影响你看自己。



***

## 八、边界情况处理

### 8.1 空自习室



* 房间创建后只有创建者 1 人：正常显示，成员数 1/10。

* 没有 "空房间" 状态 —— 因为最后一个人退出时房间自动解散。

### 8.2 成员退出



* 普通成员退出：直接删除成员记录，房间不受影响。

* 房主退出且有其他成员：自动转让给最早加入者。

* 房主退出且无其他成员：房间物理删除。

* 退出后用户回到 "未加入房间" 引导页。

### 8.3 房间解散



* 触发条件：房主退出且房间只剩 1 人。

* 解散后：study\_rooms 记录删除，study\_room\_members 记录级联删除。

* 其他正在房间页面的成员：下次轮询时收到 `room: null`，前端自动切回引导页。

### 8.4 房间号不存在



* 用户输入不存在的房间号 → 后端返回 404 "房间号不存在，请检查后重试"。

* 前端在输入框下方显示红色错误提示，不关闭弹窗。

### 8.5 重复加入



* 用户已在房间 A，尝试加入房间 B → 后端返回 400 "你已在某个自习室中，请先退出当前房间"。

* 前端弹出提示，引导用户先退出。

### 8.6 未公开数据保护



* 未公开用户的今日打卡数在 API 中返回 null，前端显示 "已隐藏"。

* 未公开用户的头像点击后，API 返回 `profile: null`，前端弹 "未公开" 提示。

* 后端**绝不返回**未公开用户的任何学习统计数字。即使前端被篡改，API 层面也拦截。

### 8.7 用户注销 / 删除



* 用户注销账号（软删除）后：


  * 从 study\_room\_members 中移除该用户记录。

  * 如果该用户是房主：自动转让给最早加入者（同退出逻辑）。

  * 如果房间只剩该用户：解散房间。

* 在用户注销的后端逻辑中调用同样的转让 / 解散函数。

### 8.8 房间人数上限



* 限制每个房间最多 10 人。

* 加入时检查：`SELECT COUNT(*) FROM study_room_members WHERE room_id = ?`，≥10 则报错 "房间人数已满"。

* 选 10 人的理由：自习室是小圈子监督，10 人以内氛围最好；超过 20 人就变成群聊了，不是自习室。

### 8.9 并发加入同一房间



* SQLite 单写，事务处理。

* 加入操作放在事务里：先 SELECT COUNT (\*)，再 INSERT。虽然理论上有竞态，但 SQLite 写锁串行化，且 10 人上限的竞态概率极低，MVP 阶段可接受。

### 8.10 房间号碰撞



* 生成房间号时循环：生成 → 查库是否存在 → 存在则重新生成。

* 8.87 亿组合下碰撞概率极低，但循环生成保证唯一性。



***

## 九、前端技术实现要点

### 9.1 文件位置



* 新增路由文件：`backend/routes/studyRoom.js`

* 在 `server.js` 中挂载：`app.use('/api/study-room', require('./routes/studyRoom'))`

* 前端逻辑：在 `frontend/js/app.js` 中追加自习室相关函数（约 300-500 行）。

* 前端样式：在 `frontend/css/style.css` 中追加 `.sr-*` 前缀的样式类。

### 9.2 调用 API 的方式

统一使用 `apiRequest(path, { method, body })`，与现有代码一致：



```
// 获取我的自习室信息
const data = await apiRequest('/api/study-room/me');

// 创建自习室
await apiRequest('/api/study-room/create', {
  method: 'POST',
  body: { name: roomName }
});
```

### 9.3 轮询刷新



* 进入自习室页面后，每 30 秒调用一次 `GET /api/study-room/me` 刷新成员今日状态。

* 用 `setInterval` 管理，退出页面时 `clearInterval`。

### 9.4 热力图复用



* 现有 `renderHeatmap()` 在 app.js 9252 行。

* 成员详情弹窗中的热力图，可以把后端返回的 heatmap 数据（`{date: count}` 对象）传入一个改造后的渲染函数，渲染到弹窗内的 `#srDetailHeatmap` 容器。

* 不需要从零写热力图组件，复用现有 DOM 结构和 CSS。

### 9.5 头像渲染



* 有 avatar（`/uploads/xxx.png`）：`<img src="...">`

* 无 avatar：显示 👤 emoji，与现有用户头像逻辑一致。



***

## 十、实施路线建议

### Phase 1（MVP，本次开发）



* 数据库迁移（study\_rooms + study\_room\_members + users.study\_room\_public）

* 后端 6 个 API 全部实现

* 前端：导航入口 + 引导页 + 房间主页 + 创建 / 加入弹窗 + 退出确认

* 前端：成员列表展示（公开 / 未公开两种状态）

* 前端：成员详情弹窗（热力图 + 4 个统计卡片）

* 前端：设置页隐私开关

### Phase 2（后续优化）



* 轮询自动刷新（30s）

* 一键复制房间号

* 房主转让功能（手动选择继承人）

* 房间公告 / 备注

* 本周打卡率排行（仅展示，不做竞赛）



***

## 十一、附录：字符集生成房间号的代码示例



```
// 生成 6 位房间号，排除易混淆字符 I, L, O, 0, 1
const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// 共 23 个字母（去掉 I, L, O）+ 8 个数字（去掉 0, 1）= 31 字符

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

// 生成唯一房间号（循环直到不重复）
function generateUniqueRoomCode(db) {
  let code;
  let exists;
  do {
    code = generateRoomCode();
    exists = db.prepare('SELECT id FROM study_rooms WHERE room_code = ?').get(code);
  } while (exists);
  return code;
}
```

***

## 十二、v1.1 变更（2026-10-04）

> 本节为 v1.1 增量，不改动上文 v1.0 既有章节。后端范围；前端 / CSS 由各自代理配套实现。

### 12.1 房间公开属性 is_public

- `study_rooms` 新增列 `is_public INTEGER NOT NULL DEFAULT 0`。
  - `0` = 私有（默认）：只能凭房间号加入，不出现在广场。
  - `1` = 公开：出现在「公开自习室广场」，任何人可浏览并一键加入。
- 迁移幂等：新库 `CREATE TABLE` 直接带列；老库 `ensureColumn(db, 'study_rooms', 'is_public', 'INTEGER NOT NULL DEFAULT 0')` 兜底补列。
- 新建房间默认私有（`is_public=0`），房主可在房间设置里改为公开。

### 12.2 房间人数上限调整为 20

- 常量 `MAX_ROOM_MEMBERS = 20`（原 10），写在 `backend/routes/studyRoom.js` 顶部并注释依据：
  4 核 / 3.6G 内存；`GET /me` 需解析 N 个成员的 `store_json`（单份 1–3MB），配合 statsCache（TTL 90s + 写入即失效）后，20 人在 30 秒轮询下仍流畅；再大则退化为群聊。
- 注册用户口径 1000 内体验最佳、2000 内可接受（仅写注释 / 交付说明，不加代码限制）。

### 12.3 新增接口

| 方法 | 路径 | 权限 | 主要错误码 |
| --- | --- | --- | --- |
| POST | `/api/study-room/kick` | 仅房主 | 400 不在房间 / 403 非房主 / 400 不能踢自己、目标不在本房间、不能踢房主 |
| PATCH | `/api/study-room/settings` | 仅房主 | 400 不在房间 / 403 非房主 / 400 名字非法、isPublic 非布尔、无任何修改项 |
| GET | `/api/study-room/plaza` | 登录即可 | 无（空列表返回空 rooms） |

- **POST /kick**（body `{ userId }`）：仅房主可调；不能踢自己 / 不能踢房主 / 目标须在本房间；删除成员记录并写审计 `study_room_kick`；返回 `{ ok, kickedUserId, kickedUsername }`。
- **PATCH /settings**（body `{ name?, isPublic? }`）：仅房主；`name` 提供则 trim 后长度 1–20；`isPublic` 提供则必须是布尔；两者都没提供 → 400；动态拼 `UPDATE study_rooms`；写审计 `study_room_settings`（detail 记录 changes）；返回更新后的房间 `{ id, roomCode, name, isPublic }`。
- **GET /plaza**：只列 `is_public=1` 的房间（不含任何私有房）；每项含 `roomId / roomCode / name / ownerName / memberCount / maxMembers(20) / active7 / isFull`。

### 12.4 广场排序与热门口径

- 排序键：**成员数降序优先**；成员数相同时，**近 7 天成员打卡总数 active7 降序**（含今天共 7 天：`today-6 … today`）。
- `active7` = 该房间每个成员 `byDate` 在这 7 天内的 review 条数累加。
- `isFull = memberCount >= 20`；已满房在广场标记「已满」且按钮置灰，不可加入。

### 12.5 streak 口径（/me 成员列表）

- 每个成员对象新增 `streak`，对**所有成员真实返回**（streak 属基础社交信息，与头像 / 用户名 / 房主标记同级可见）。
- `computeStreak(byDate, today)`：今天有 review 从今天起算；今天没有则从昨天起算（**不因今天尚未学而清零**），逐日回退直到遇无记录日；加 3650 天保险上限。
- `todayReviewCount` / `checkedInToday` 仍按隐私口径：`publicData || isSelf` 才真实，否则返回 `null`；自己始终真实。

### 12.6 服务端统计缓存 statsCache

- 新增 `backend/utils/statsCache.js`：进程内 `Map<userId, {ts, today, byDate, total}>`。
- TTL 90 秒（60–120s 区间）；跨天兜底（`entry.today !== expectedToday` 视为失效）；30 秒懒清理过期项；硬上限 3000 条，超出按 ts 从旧到新淘汰约 10%。
- `studyRoom.js` 统一通过 `getUserStats(userId)` 取统计，`/me`、`/member/:userId`、`/plaza` 全部复用，禁止各自再 parse `store_json`。
- `data.js` 的 `PUT /api/data` 成功 upsert 后调用 `statsCache.invalidate(req.user.id)`，让该用户统计立即生效；其余 key 继续走 TTL。

### 12.7 新增边界情况

- **被踢后可立即加入别的房**：不写任何冷却 / 状态限制；被踢者下次轮询 `/me` 得到 `room: null` 即回引导页，可马上凭房间号加入其他房。
- **广场已满房**：`isFull=true` 的房间前端显示「已满」并禁用加入按钮；即便绕过前端，后端 `/join` 仍以 `COUNT(*) >= 20` 兜底拦截。
- **私有房只能凭房间号加入**：`/join` 始终要求提供 `roomCode`；广场只暴露公开房，私有房不会出现在广场列表，外人只能凭已知房间号加入。
- **房主注销 / 退出转让沿用**：注销 / 退出的转让与解散逻辑沿用 v1.0（转让最早加入者、单人退出即物理解散），本次不变。
- **并发加入靠事务**：`/join` 在 SQLite 写事务内 `COUNT(*) → INSERT`，单写串行化，20 人上限竞态概率极低，MVP 可接受。
- **房间号碰撞循环兜底**：`generateUniqueRoomCode` 循环生成直到不重复（31⁶≈8.87 亿组合下概率极低）。