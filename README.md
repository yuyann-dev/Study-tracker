# Study Tracker 考研学习规划应用

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![Platform](https://img.shields.io/badge/platform-web%20%7C%20PWA-lightgrey)

## 项目简介

Study Tracker 是一个面向考研学生的学习规划 Web 应用，围绕刷题、错题整理、背书复习三大核心任务展开。前端为原生 HTML/CSS/JavaScript，不依赖任何框架或构建工具，单文件即可跑；后端基于 Node.js + SQLite，支持 PWA 离线使用与多设备数据同步。

自己是考研人，最初就是为了记自己的刷题进度、攒错题、排背书计划写的，身边同学用着顺手，就一点点打磨成了现在的样子。项目已上线：<https://yystudy.top>。

## 功能模块

### 刷题本

- 习题册、套卷两种录入模式
- 习题册模式按页码范围记录每日完成量
- 套卷模式记录套卷编号、完成情况与用时
- 自动统计完成进度，生成学习趋势图

### 错题本

- 三种出处模式：自由出处、习题册、套卷
- 自定义标签体系
- 薄弱点分析，按标签聚合知识盲区
- 三种复习模式（未掌握 / 已掌握等状态流转）

### 背书

- 经典艾宾浩斯间隔重复（classic）与均匀间隔两种排期
- 记得 / 模糊 / 忘记三态标记
- 根据记忆状态自动推算下次复习时间
- 支持多本书籍，各自独立进度

### 打卡

- 每日打卡记录
- 连续天数统计
- 打卡历史与汇总

### 用户系统

- 邮箱验证码注册 / 登录
- JWT 鉴权，支持多设备
- 登录后云端自动同步，离线时本地优先
- 支持 JSON 手动导入 / 导出备份

### 管理员面板

- 用户管理：搜索、筛选、封禁、重置密码
- 邀请码系统：生成、作废、使用统计
- 审计日志：管理员操作全程留痕
- 系统监控：请求量、错误率、存储与运行状态

## 技术栈

### 前端

- 原生 HTML5 / CSS3 / JavaScript（ES6+），**非模块化单文件架构**，无框架依赖、无构建步骤
- PWA：Web App Manifest + Service Worker（离线缓存、可添加到桌面）
- 数据存储三层：localStorage 主存储 + IndexedDB 快照备份 + Cache API 第三备份
- 响应式布局，手机 / 平板 / PC 全适配，支持深色模式

### 后端

- Node.js + Express 4
- 数据库：better-sqlite3（同步 API，单文件 SQLite）
- 认证：bcrypt 密码哈希 + JWT
- 邮件：Nodemailer（SMTP 发送邮箱验证码）
- 日志：自定义 JSONL，按天轮转

### 部署与运维

- Web 服务器：Nginx（静态资源 + 反向代理 + HTTPS）
- HTTPS：Let's Encrypt 证书，certbot 自动续期
- 进程管理：systemd，非特权用户运行
- 数据库备份：sqlite3 在线热备，每日定时执行
- 容器化：Docker + Docker Compose 一键本地部署
- CI/CD：GitHub Actions（语法检查 + 测试 + 自动部署）

## 目录结构

```
study-tracker-repo/
├── frontend/                     # 前端静态文件
│   ├── index.html               # 主页面（约 98KB，含全部静态结构）
│   ├── css/
│   │   └── style.css            # 全局样式（纸感学院派，含深色模式）
│   ├── js/
│   │   ├── auth.js             # 认证与同步（IIFE，导出 window.STAuth）
│   │   └── app.js              # 主业务逻辑（boot() IIFE 启动，约 615KB）
│   ├── sw.js                    # Service Worker（CACHE = yystudy-v26）
│   ├── manifest.json            # PWA 清单
│   ├── icon-192.png             # 应用图标 192×192
│   ├── icon-512.png             # 应用图标 512×512
│   ├── apple-touch-icon.png     # iOS 添加到桌面图标
│   └── favicon-64.png          # 标签页图标
├── backend/                     # 后端
│   ├── server.js                # 入口，监听 3001 端口
│   ├── config.js                # 配置管理
│   ├── database.js              # SQLite 初始化与连接
│   ├── package.json
│   ├── middleware/
│   │   └── auth.js              # JWT 鉴权中间件
│   ├── routes/
│   │   ├── auth.js              # 注册 / 登录 / 验证码
│   │   ├── user.js              # 用户信息
│   │   ├── data.js             # 数据同步（支持 ETag 增量）
│   │   └── admin.js             # 管理员面板
│   ├── utils/
│   │   ├── syncMerge.js         # 服务端数据合并（LWW + 墓碑）
│   │   ├── verification.js     # 邮箱验证码
│   │   ├── mailer.js           # 邮件发送
│   │   ├── scheduler.js         # 背书复习调度
│   │   ├── respond.js           # 统一响应格式
│   │   ├── logger.js            # JSONL 日志
│   │   ├── audit.js            # 审计日志
│   │   ├── alert.js             # 异常告警
│   │   └── metrics.js          # 性能指标
│   ├── scripts/
│   │   ├── backup.sh            # 数据库备份脚本
│   │   ├── diagnose-mail.js     # 邮件排障脚本
│   │   ├── study-backup.service  # 备份服务单元
│   │   ├── study-backup.timer   # 备份定时器
│   │   └── study-tracker.service.study
│   ├── test_merge.js            # 合并算法单元测试
│   ├── test_scheduler.js        # 调度算法单元测试
│   ├── data/                    # SQLite 文件（不入库）
│   ├── logs/                    # 日志（不入库）
│   └── uploads/                 # 用户上传（不入库）
├── deploy/                       # 部署配置
│   ├── yystudy-https.conf       # Nginx 生产配置（HTTPS + 反代）
│   ├── nginx-api.conf           # Nginx API 反代参考
│   ├── nginx-docker.conf        # Docker 环境 Nginx 配置
│   ├── enable-https.sh          # Let's Encrypt 配置脚本
│   └── study-tracker.service    # systemd 单元参考
├── docs/
│   └── API.md                    # 接口文档
├── .github/workflows/
│   ├── ci.yml                    # 语法检查 + 测试
│   └── deploy.yml                # 自动部署
├── docker-compose.yml
├── Dockerfile
├── .env.example                 # 环境变量示例
├── .gitignore
├── LICENSE
└── README.md
```

> 前端 script 加载顺序有硬依赖：`auth.js` 必须在 `app.js` 之前，两者均为普通 `<script>` 标签（非 `type="module"`），通过全局 `var store` 等变量跨脚本共享状态。

## 核心设计

### 数据同步机制

采用「本地优先 + 云端同步」的最终一致性方案：

1. 用户数据默认落在浏览器 localStorage（键 `study_tracker_v2`），所有操作即时生效，不依赖网络。
2. 登录后自动同步到服务器，多设备之间可合并。
3. 服务端对称合并，按 `updatedAt` 时间戳走「最后写入胜」（LWW）。
4. 墓碑机制（tombstones）记录删除操作，避免已删数据在多端同步时被复活。
5. ETag 增量：客户端带 `If-None-Match` 请求，服务端数据未变直接返回 304，省流量。

### 背书复习算法

- **classic 模式**：按「记得 / 模糊 / 忘记」三态动态拉长或缩短间隔，模拟艾宾浩斯遗忘曲线。
- **均匀间隔**：把待复习内容平摊到每天，避免某天爆量。

### 安全设计

- 密码 bcrypt 加盐哈希存储。
- JWT 鉴权，支持 `token_version` 强制下线。
- CORS 白名单仅放行生产域名。
- `/api/data` 接口限流（按 IP 计）。
- CSP 内容安全策略防 XSS。
- 管理员危险操作需二次验证。
- 服务以非特权用户运行，数据库文件权限收紧。

## 部署说明

### 环境要求

- Node.js 18+
- Nginx
- Linux 服务器

### 前端部署

1. 把 `frontend/` 下所有文件（含 `js/`、`css/`）放到 Nginx 静态目录。
2. 对 `index.html`、`sw.js`、`manifest.json`、`js/*.js`、`css/*.css` 做 gzip 预压缩。
3. Nginx 配置 `gzip_static on` 与合理的缓存策略（`sw.js`、`manifest.json` 禁用强缓存）。

### 后端部署

```bash
cd backend
npm install --production
cp ../.env.example .env   # 填入 JWT_SECRET、SMTP 等
node server.js             # 默认 3001 端口
```

生产环境通过 systemd 托管（参考 `scripts/study-tracker.service.study`），改完代码记得 `systemctl restart study-tracker`。

注意事项：

- 部署时**不要覆盖服务器上的 `.env`**（含密钥）。
- **不要删 `node_modules`**：better-sqlite3 是原生模块，删了要重新编译。
- SQLite 文件在 `backend/data/`，定期备份。

### Docker 一键部署（本地 / 测试）

```bash
cp .env.example .env
# 编辑 .env
docker-compose up -d
```

- 前端：<http://localhost:8080>
- 后端健康检查：<http://localhost:3001/api/health>

数据持久化在 Docker volume 中，容器重建不丢。

## 开发说明

### 前端

前端没有打包流程，改文件即生效。两个 JS 文件的职责：

| 文件 | 职责 |
| --- | --- |
| `js/auth.js` | 注册 / 登录 / 验证码、云端同步、个人中心、管理员面板；IIFE 结构，对外暴露 `window.STAuth` |
| `js/app.js` | 刷题、错题、背书、打卡、统计、设置等全部主业务；IIFE 结构，`boot()` 启动装配 |
| `css/style.css` | 全局样式，纸感学院派风格 + 深色模式 |

`index.html` 通过普通 `<script>` 标签依次引入 `auth.js`、`app.js`，两者共享全局 `var store`。

语法检查：

```bash
node --check frontend/js/auth.js
node --check frontend/js/app.js
node --check frontend/sw.js
```

### 后端

```bash
cd backend
npm install
node server.js
```

跑测试：

```bash
npm test
# 内部执行 test_merge.js 与 test_scheduler.js
```

测试覆盖：合并算法（墓碑、多端合并、LWW、墓碑清理）与复习调度（三态、间隔计算、毕业判定、退轮）。

### API 文档

见 [docs/API.md](docs/API.md)。

### 数据结构

用户数据 store 顶层结构：

```json
{
  "currentId": "当前项目ID",
  "projects": { "项目ID": { } },
  "unitTemplates": { "习题册模板ID": {} },
  "paperTemplates": { "套卷模板ID": {} },
  "tombstones": { "被删除的ID": 删除时间戳 }
}
```

## 版本历史

| 版本 | 日期 | 主要变更 |
| --- | --- | --- |
| v1 | 2026-09-15 | 初始版本，单页学习记录 |
| v6 | 2026-09-20 | iOS 数据丢失防护 |
| v7 | 2026-09-21 | 存储异常时备份弹窗提醒 |
| v11 | 2026-09-28 | 刷题 / 错题 / 背书三大模块成型，PWA、深色模式 |
| v13 | 2026-09-30 | 接入 Node.js 后端，邮箱登录，云端同步 |
| v15 | 2026-10-01 | 服务端合并算法、管理员面板、安全加固 |
| v17 | 2026-10-02 | 纸感学院派视觉定稿，品牌图标，性能优化 |
| v18 | 2026-10-03 | 图标更新、ETag 增量同步、同步性能优化 |
| v19 | 2026-10-03 | 修复 401 提示、未打卡弹窗样式、管理员邀请码批量删除、外键约束硬删除 500、邀请码过期判断与旧格式兼容、重注册删除顺序等问题；SW 升级至 v26 |

## 许可证

MIT License，详见 [LICENSE](LICENSE)。欢迎提 Issue 与 PR。

## 联系方式

- 线上站点：<https://yystudy.top>
- ICP 备案：皖 ICP 备 2026033517 号
