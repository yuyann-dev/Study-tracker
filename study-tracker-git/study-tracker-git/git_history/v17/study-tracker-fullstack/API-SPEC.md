# Study Tracker 全栈版 - API 契约与技术规范

## 技术栈
- 后端: Node.js 18+ / Express / better-sqlite3 / bcryptjs / jsonwebtoken / multer
- 数据库: SQLite 单文件 (backend/data/study.db)
- 认证: JWT (Authorization: Bearer <token>)，token 存前端 localStorage
- 端口: 3001 (Nginx 反代 /api → 127.0.0.1:3001)

## 数据库表结构

### users
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| username | TEXT UNIQUE NOT NULL | 用户名，3-20字符，字母数字下划线 |
| password_hash | TEXT NOT NULL | bcrypt 哈希 |
| avatar | TEXT | 头像URL或emoji/base64，默认null |
| created_at | TEXT DEFAULT (datetime('now')) | |
| updated_at | TEXT DEFAULT (datetime('now')) | |

### user_data
| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | INTEGER PRIMARY KEY REFERENCES users(id) | |
| store_json | TEXT NOT NULL | 完整 store 对象的 JSON |
| updated_at | TEXT DEFAULT (datetime('now')) | |

## API 端点

### 认证

#### POST /api/auth/register
请求: `{ "username": "testuser", "password": "Abcd1234" }`
成功 200: `{ "ok": true, "token": "jwt...", "user": { "id": 1, "username": "testuser", "avatar": null } }`
失败 400: `{ "ok": false, "error": "用户名已存在" }`
- 密码强度: 至少8位，包含字母和数字
- 用户名: 3-20字符，字母/数字/下划线，不区分大小写查重

#### POST /api/auth/login
请求: `{ "username": "testuser", "password": "Abcd1234" }`
成功 200: `{ "ok": true, "token": "jwt...", "user": { "id": 1, "username": "testuser", "avatar": null } }`
失败 401: `{ "ok": false, "error": "用户名或密码错误" }`

#### POST /api/auth/logout
Header: Authorization
成功 200: `{ "ok": true }`
(服务端无状态，主要供前端清除token；可预留token黑名单)

#### GET /api/auth/me
Header: Authorization
成功 200: `{ "ok": true, "user": { "id": 1, "username": "testuser", "avatar": null, "createdAt": "..." } }`
失败 401: `{ "ok": false, "error": "未登录" }`

### 数据同步

#### GET /api/data
Header: Authorization
成功 200: `{ "ok": true, "store": { ... }, "updatedAt": "2026-09-30T12:00:00Z" }`
无数据 200: `{ "ok": true, "store": null, "updatedAt": null }`

#### PUT /api/data
Header: Authorization
请求: `{ "store": { ... } }`
成功 200: `{ "ok": true, "updatedAt": "2026-09-30T12:00:00Z" }`
- 全量覆盖写入（10人以内场景，全量同步最简单可靠）

### 用户资料

#### PUT /api/user/profile
Header: Authorization
请求: `{ "username": "newname" }` (可选字段)
成功 200: `{ "ok": true, "user": { "id": 1, "username": "newname", "avatar": null } }`

#### PUT /api/user/password
Header: Authorization
请求: `{ "oldPassword": "old", "newPassword": "new1234" }`
成功 200: `{ "ok": true }`
失败 401: `{ "ok": false, "error": "原密码错误" }`

#### POST /api/user/avatar
Header: Authorization
Content-Type: multipart/form-data, field: avatar (图片文件)
成功 200: `{ "ok": true, "avatar": "/uploads/avatar_1_xxx.png" }`
- 限制: 2MB以内，jpg/png/webp
- 保存到 backend/uploads/，Nginx 提供 /uploads/ 静态访问

## JWT 配置
- secret: 从环境变量 JWT_SECRET 读取，默认随机生成写入 .env
- 过期时间: 30天
- payload: { id, username }

## 安全要求
- 所有 /api 路由（除 register/login）需 auth 中间件校验
- bcrypt cost: 10
- 密码绝不明文返回或记录日志
- 请求体大小限制: 10MB (store JSON 可能较大)
- CORS: 允许同源 (Nginx 反代后同源，不需要额外配置)
- 速率限制: register/login 每IP每分钟10次

## 前端集成点 (供前端改造参考)

### 数据结构
前端 store 对象结构 (保持不变):
```js
{
  currentId: null | "project_id",
  projects: { [pid]: { type, name, ..., records, items, units, ... } },
  unitTemplates: [],
  paperTemplates: [],
  uiFlags: {},
  localData: {}
}
```

### 同步策略
1. 未登录: 纯本地 (localStorage + IndexedDB + Cache)，行为不变
2. 登录成功: 
   - 拉取云端数据 GET /api/data
   - 若云端有数据且本地无数据 → 用云端数据覆盖本地
   - 若本地有数据且云端无数据 → 自动上传本地数据
   - 若两边都有 → 以 updatedAt 较新者为准（提示用户）
3. 登录后操作: saveStore() 增加防抖云端同步（5秒），调用 PUT /api/data
4. 手动同步按钮: 立即拉取+推送
5. 登出: 清除 token，保留本地数据

### 前端需要新增的 UI
1. 顶部 header 增加用户头像按钮（未登录显示"登录/注册"，已登录显示头像）
2. 登录/注册模态框（tab切换，美观设计，品牌色渐变）
3. 个人中心模态框（头像上传/选择、修改用户名、修改密码、同步状态、登出）
4. 同步状态指示器（右上角小图标，显示"已同步/同步中/同步失败"）
5. 页脚 ICP 备案号: 皖ICP备2026033517号，链接 https://beian.miit.gov.cn
6. 欢迎页特性标签从"🔒 数据只存本地"改为"☁️ 云端同步备份"

### 前端代码插入位置
- CSS: 在 `</style>` (约1406行) 之前插入新样式
- HTML 模态框: 在其他 mask 模态框附近（约1991行 settingsMask 之后）
- 用户按钮: 在 header .head-actions 内（约1473行）
- JS: 在主 `</script>` (约14781行) 之前插入，或新建 `<script>` 块
- saveStore 函数 (约3857行): 在函数末尾添加云端同步调用
- loadStore 完成后: 检查登录状态并触发云端拉取
