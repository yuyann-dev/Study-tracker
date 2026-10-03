# Study Tracker 后端

Node.js 18+ / Express / better-sqlite3 轻量同步服务，10 人以内自用。

## 目录结构

```
backend/
├── server.js            入口：装配 Express、挂载路由、限流、静态文件
├── config.js           【集中配置】端口、JWT、bcrypt、限流、上传大小、正则
├── database.js          SQLite 初始化 + 幂等建表/补列
├── utils/
│   └── respond.js      统一响应 ok() / fail()
├── middleware/
│   └── auth.js          authRequired（JWT→req.user）+ requireAdmin
├── routes/
│   ├── auth.js          /api/auth/* 注册/登录/me/登出/忘记密码
│   ├── data.js          /api/data  云端 store 全量同步
│   ├── user.js          /api/user/* 资料/密码/头像
│   └── admin.js         /api/admin/* 统计/用户/邀请码
├── data/study.db        SQLite 数据文件（启动自动生成）
├── uploads/             头像文件
├── .env                 环境变量（首次启动自动生成）
└── .env.example
```

## 快速开始

```bash
cd backend
npm install
npm start
# 监听 http://127.0.0.1:3001
```

首次启动会自动生成 `.env` 并写入随机 `JWT_SECRET`。

## 架构说明

- **认证**：JWT（Bearer Token），有效期 30 天；payload 只存 `{id, username}`，每次请求在 `authRequired` 里查库拿到最新 `status / is_admin / email`，禁用账号立即失效。
- **账号体系**：QQ 邮箱是唯一登录账号（存小写，UNIQUE）；昵称 `username` 可重名；注册必须凭有效邀请码；第一个注册的用户自动成为管理员。
- **数据**：每个用户一行 `user_data`，存完整前端 store 的 JSON；全量覆盖读写，简单可靠。
- **安全**：bcrypt cost=10；密码绝不明文返回；`/api/auth/register|login` 每 IP 10 次/分钟；`/api/auth/forgot-password` 5 次/小时；只监听 127.0.0.1，公网由 Nginx 反代。

## API 一览

统一响应：成功 `{ ok: true, ... }`，失败 `{ ok: false, error: "消息" }`。
除 `register / login / forgot-password` 外都需要 `Authorization: Bearer <token>`。

### 认证 `/api/auth`
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /register | `{username, password, email, inviteCode}` → `{token, user}` |
| POST | /login | `{email, password}` → `{token, user}` |
| POST | /logout | 无状态 |
| GET  | /me | → `{user:{id,username,email,avatar,isAdmin,createdAt}}` |
| POST | /forgot-password | `{email}` → 占位提示 |

### 数据 `/api/data`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | / | `{store, updatedAt}`，无数据时 `store:null` |
| PUT | / | `{store:{...}}` 全量覆盖 |

### 用户 `/api/user`
| 方法 | 路径 | 说明 |
|------|------|------|
| PUT | /profile | `{username?, email?}` |
| PUT | /password | `{oldPassword, newPassword}` |
| POST | /avatar | multipart 字段 `avatar`，≤2MB |

### 管理员 `/api/admin`（需 `isAdmin=true`）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /stats | 用户/邀请码/数据量统计 |
| GET | /users | 用户列表（含每人 dataSizeMB） |
| POST | /invite/generate | `{count?, expiresInDays?}` → `{codes:[...]}` |
| GET | /invite/list | 邀请码列表 |
| PUT | /users/:id/status | `{status:'active'|'disabled'}` |

## 部署到 OpenCloudOS

```bash
# 服务器上
sudo npm install -g pm2   # 或用 systemd（见 deploy/study-tracker.service）
cd /opt/study-tracker/backend
npm install --omit=dev
cp .env.example .env && nano .env   # 填 JWT_SECRET（或首次启动自动生成）
node server.js
```

Nginx 反代见 `deploy/nginx-api.conf`：
- `/api/` → `http://127.0.0.1:3001`，`client_max_body_size 10m`
- `/uploads/` 别名到 `backend/uploads/`

systemd 见 `deploy/study-tracker.service`：`Restart=always`、开机自启。

## 如何扩展

- **改配置**：所有阈值（端口、JWT 过期、bcrypt 轮数、限流、上传大小、正则）都在 `config.js`，不要散落在路由里。
- **加新表/新列**：在 `database.js` 的 `CREATE TABLE` 里加列，再调 `ensureColumn()` 给老库补列；文件头注释里追加版本号。
- **加新路由资源**：新建 `routes/xxx.js`，在 `server.js` 里 `app.use('/api/xxx', xxxRoutes)`。
- **加新角色分级**（如 moderator）：在 `middleware/auth.js` 仿照 `requireAdmin` 写 `requireRole(role)`，按路由挂载。
- **加手机号登录**：在 `config.js` 的 `RULES` 里加 `phone` 正则；在 `users` 表加 `phone` 列；`auth.js` 加 `/login-by-phone`。
- **改响应格式**：只改 `utils/respond.js` 一处。
