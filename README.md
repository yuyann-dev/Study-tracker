# Study Tracker 考研学习规划应用

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![Platform](https://img.shields.io/badge/platform-web%20%7C%20PWA-lightgrey)

## 项目简介

Study Tracker 是一个面向考研学生的学习规划 Web 应用，围绕刷题、错题整理、背书复习三大核心任务展开，并提供自习室协作与 AI 学习助手。前端为原生 HTML/CSS/JavaScript，不依赖任何框架或构建工具；后端基于 Node.js + SQLite，支持 PWA 离线使用与多设备数据同步。

自己是考研人，最初就是为了记自己的刷题进度、攒错题、排背书计划写的，身边同学用着顺手，就一点点打磨成了现在的样子。项目已上线：<https://yystudy.top>。

注册需邀请码，公开测试码：`EFC7CG8U`（50 人额度，用完即止）。

## 功能模块

### 刷题本

- 习题册、套卷两种录入模式
- 习题册模式按页码范围记录每日完成量
- 套卷模式记录套卷编号、完成情况与用时
- 自动统计完成进度，生成学习趋势图
- 完成情况弹窗：学习节奏、完成预测、个人注意事项

### 错题本

- 三种出处模式：自由出处、习题册、套卷
- 自定义标签体系
- 薄弱点看板：按标签聚合知识盲区，含**复习热力图**（按月展示每日错题完成量，点击查看当日具体题目与掌握情况）
- 间隔重复复习算法（均衡模式），记得 / 模糊 / 忘记三态标记
- 提前复习功能，支持连续录入页码保留

### 背书

- 经典间隔重复（classic）与均匀间隔两种排期
- 记得 / 模糊 / 忘记三态标记
- 根据记忆状态自动推算下次复习时间
- 支持多本书籍，各自独立进度
- 薄弱点看板与个人注意事项

### 自习室

- 创建自习室并邀请成员加入，创建者可踢人、可解散
- 公开 / 私有设置，公开自习室在广场按热度排序展示
- 一人仅加入一个自习室，加入后仍可浏览广场
- 成员基础信息公开（头像、昵称、连续打卡），进阶信息（当日学习详情）由用户自主选择是否公开
- 自习室内打卡热力图展示

### AI 学习助手

- 用户自行配置大模型 API Key（以 DeepSeek 为例，系统不收取任何费用）
- 支持工具调用（Function Calling）：AI 可主动查询用户学习数据、项目进度、复习状态等
- 个性化答疑与排期建议，结合用户真实数据而非空泛建议
- 一键修改舒适量 / 每日容量（仅这两项可被 AI 修改），支持随时撤销
- 对话历史管理：重命名、置顶、删除，记忆可开关
- 内置考研倒计时（2026 年 12 月 19 日）与个性化用户画像

### 打卡

- 每日打卡记录
- 连续天数统计
- 打卡历史与汇总

### 用户系统

- 邮箱验证码注册 / 登录
- JWT 鉴权，支持多设备
- 登录后云端自动同步，离线时本地优先
- 支持 JSON 手动导入 / 导出备份
- 头像上传与压缩
- 自助注销账号

### 管理员面板

- **两级权限**：超级管理员（唯一最高权限，可管理管理员）与普通管理员（用户管理、邀请码、日志，不可管理超级管理员）
- 用户管理：搜索、筛选、封禁、重置密码、查看登录记录
- 邀请码系统：生成、作废、使用统计、批量清理
- 审计日志：管理员操作全程留痕
- 系统监控：请求量、错误率、存储与运行状态，5xx 连续告警邮件通知

## 技术栈

### 前端

- 原生 HTML5 / CSS3 / JavaScript（ES6+），无框架依赖、无构建步骤
- PWA：Web App Manifest + Service Worker（离线缓存、可添加到桌面）
- 数据存储三层：localStorage 主存储 + IndexedDB 快照备份 + Cache API 第三备份
- 响应式布局，手机 / 平板 / PC 全适配，支持深色模式
- 纸感学院派视觉风格：浅色纸张纹理 + 墨绿点缀，深色哑光牛皮纸风格

### 后端

- Node.js + Express 4
- 数据库：better-sqlite3（同步 API，单文件 SQLite）
- 认证：bcrypt 密码哈希 + JWT
- 邮件：Nodemailer（SMTP 发送邮箱验证码）
- AI 代理：用户 API Key 转发，支持 OpenAI 兼容接口（DeepSeek 等）
- 日志：自定义 JSONL，按天轮转
- 数据合并：LWW（Last-Write-Wins）+ 墓碑机制，多端最终一致性

### 部署与运维

- Web 服务器：Nginx（静态资源 + 反向代理 + HTTPS + Brotli/gzip 压缩）
- HTTPS：Let's Encrypt 证书，certbot 自动续期
- 进程管理：systemd，非特权用户运行
- 数据库备份：sqlite3 在线热备，每日定时执行
- 安全响应头：X-Frame-Options、X-Content-Type-Options、Referrer-Policy
- 容器化：Docker + Docker Compose 一键本地部署
- CI/CD：GitHub Actions（语法检查 + 测试）

## 目录结构

```
study-tracker-repo/
├── frontend/                     # 前端静态文件
│   ├── index.html               # 主页面
│   ├── css/
│   │   └── style.css            # 全局样式（纸感学院派，含深色模式）
│   ├── js/
│   │   ├── auth.js             # 认证与同步（IIFE，导出 window.STAuth）
│   │   └── app.js              # 主业务逻辑（boot() IIFE 启动）
│   ├── sw.js                    # Service Worker
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
│   │   ├── user.js              # 用户信息、头像、注销
│   │   ├── data.js             # 数据同步（支持 ETag 增量）
│   │   ├── admin.js             # 管理员面板（两级权限）
│   │   ├── studyroom.js         # 自习室 API
│   │   └── ai.js                # AI 助手代理与工具调用
│   ├── utils/
│   │   ├── syncMerge.js         # 服务端数据合并（LWW + 墓碑）
│   │   ├── verification.js     # 邮箱验证码
│   │   ├── mailer.js           # 邮件发送
│   │   ├── scheduler.js         # 背书复习调度
│   │   ├── aiDataAggregator.js  # AI 数据聚合（工具调用数据源）
│   │   ├── aiPrompt.js          # AI 系统提示词
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
│   ├── API.md                    # 接口文档
│   └── 用户测试说明.md           # 大模型辅助用户模拟与安全测试说明
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

1. 用户数据默认落在浏览器 localStorage，所有操作即时生效，不依赖网络。
2. 登录后自动同步到服务器，多设备之间可合并。
3. 服务端对称合并，按 `updatedAt` 时间戳走「最后写入胜」（LWW）。
4. 墓碑机制（tombstones）记录删除操作，避免已删数据在多端同步时被复活。
5. ETag 增量：客户端带 `If-None-Match` 请求，服务端数据未变直接返回 304，省流量。

### 间隔重复算法

- **错题本**：均衡模式，按「记得 / 模糊 / 忘记」三态动态调整间隔，掌握状态可由评价历史纯函数重算。
- **背书**：classic 模式模拟艾宾浩斯遗忘曲线；均匀间隔模式把待复习内容平摊到每天，避免某天爆量。

### AI 助手设计

- **用户自带 API Key**：系统仅做代理转发，不存储用户密钥，费用直接由用户与模型服务商结算。
- **工具调用（Function Calling）**：AI 可主动调用 10+ 个工具查询用户数据（项目概览、每日进度、复习队列、薄弱点、自习室信息等），建议基于真实数据而非臆测。
- **有限修改权限**：AI 仅可建议修改「每日舒适量」与「每日容量」两项，用户确认后执行，且支持随时撤销。
- **成本保护**：上下文按需聚合，敏感信息（密码、邮箱等）不传入模型，默认推荐性价比最高的模型版本。

### 自习室设计

- 一人一室约束：每个用户同时只能加入一个自习室，避免社交分散。
- 隐私分层：基础信息（头像、昵称、连续打卡）默认公开；进阶信息（当日具体学习内容）由用户自主开关。
- 广场热度排序：公开自习室按活跃成员数与近期打卡量排序。

### 安全设计

- 密码 bcrypt 加盐哈希存储。
- JWT 鉴权，支持 `token_version` 强制下线。
- CORS 白名单仅放行生产域名。
- `/api/data` 接口限流（按 IP 计）。
- CSP 内容安全策略防 XSS，用户输入统一 HTML 转义。
- 管理员危险操作需二次验证，操作全程审计留痕。
- AI API Key 仅服务端代理使用，不回传前端。
- 服务以非特权用户运行，数据库文件权限收紧。

## 部署说明

### 环境要求

- Node.js 18+
- Nginx
- Linux 服务器

### 前端部署

1. 把 `frontend/` 下所有文件（含 `js/`、`css/`）放到 Nginx 静态目录。
2. 对 `index.html`、`sw.js`、`manifest.json`、`js/*.js`、`css/*.css` 做 gzip/Brotli 预压缩。
3. Nginx 配置 `gzip_static on` 与合理的缓存策略（`sw.js`、`manifest.json` 禁用强缓存）。

### 后端部署

```bash
cd backend
npm install --production
cp ../.env.example .env   # 填入 JWT_SECRET、SMTP、AI 代理等
node server.js             # 默认 3001 端口
```

生产环境通过 systemd 托管，改完代码记得 `systemctl restart study-tracker`。

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
| `js/auth.js` | 注册 / 登录 / 验证码、云端同步、个人中心、管理员面板、自习室、AI 助手；IIFE 结构，对外暴露 `window.STAuth` |
| `js/app.js` | 刷题、错题、背书、打卡、统计、设置、薄弱点看板等全部主业务；IIFE 结构，`boot()` 启动装配 |
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
| v19 | 2026-10-03 | 修复 401 提示、未打卡弹窗样式、管理员邀请码批量删除等问题 |
| v20+ | 2026-10-04 ~ | 自习室模块、薄弱点热力图、AI 学习助手（Function Calling）、两级管理员权限、审计日志、头像压缩、多项性能与体验优化 |

## 许可证

MIT License，详见 [LICENSE](LICENSE)。欢迎提 Issue 与 PR。

## 联系方式

- 线上站点：<https://yystudy.top>
- 邮箱：<2719752623yy@gmail.com>
- ICP 备案：皖 ICP 备 2026033517 号
