# Study Tracker 考研学习规划应用

![CI](https://github.com/yuyann-dev/Study-tracker/actions/workflows/ci.yml/badge.svg)
![Deploy](https://github.com/yuyann-dev/Study-tracker/actions/workflows/deploy.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![Platform](https://img.shields.io/badge/platform-web%20%7C%20PWA-lightgrey)

## 项目简介

Study Tracker 是一个面向考研学生的学习规划 Web 应用，帮助学生管理刷题、错题整理和背书复习三大核心学习任务。应用采用前后端分离架构，前端为单文件原生 HTML/CSS/JS 实现，后端基于 Node.js Express + SQLite，支持 PWA 离线使用和多设备数据同步。

我自己是考研人，这个项目最初是为了解决自己刷题、错题整理和背书复习的需求开发的，后来身边朋友也在用，就慢慢完善成了现在的样子。项目已上线生产环境 `https://yystudy.top`。

## 功能模块

### 1. 刷题本



* 支持习题册模式和套卷模式两种录入方式

* 习题册模式：按页码范围记录每天完成的题目

* 套卷模式：记录套卷编号、完成情况和用时

* 自动统计完成进度，生成学习趋势图

### 2. 错题本



* 支持三种出处模式：自由出处、习题册、套卷

* 错题标签系统，可自定义标签分类

* 薄弱点分析，根据错题标签统计知识盲区

* 错题复习状态管理（未掌握 / 已掌握）

### 3. 背书模块



* 经典间隔重复（classic）和均匀分布两种复习模式

* 三态标记：记得、模糊、忘记

* 根据记忆状态自动安排下次复习时间

* 支持多本书籍管理，每本书独立进度

### 4. 用户系统



* 邮箱验证码注册登录

* JWT 鉴权，支持多设备登录

* 云端数据自动同步，本地优先离线可用

* JSON 手动导入 / 导出备份

### 5. 管理员面板



* 用户管理（搜索、筛选、封禁、重置密码）

* 邀请码系统（生成、作废、使用统计）

* 审计日志（管理员操作留痕）

* 系统监控（请求量、错误率、存储使用、服务器状态）

## 技术栈

### 前端



* 原生 HTML5 / CSS3 / JavaScript（ES6+），无框架依赖

* PWA：Web App Manifest + Service Worker，支持离线缓存和添加到桌面

* 数据存储：localStorage（主数据）+ IndexedDB（大容量缓存）

* 响应式设计：手机、平板、PC 全适配，支持深色模式

### 后端



* Node.js + Express 4

* 数据库：better-sqlite3（同步 API，单文件数据库）

* 认证：bcrypt 密码哈希 + JWT（jsonwebtoken）

* 邮件：Nodemailer（QQ 邮箱 SMTP）

* 日志：自定义 JSONL 日志，按天轮转

### 部署与运维

* 服务器：腾讯云轻量应用服务器（OpenCloudOS 9.6）

* Web 服务器：Nginx（静态资源 + 反向代理 + HTTPS）

* HTTPS：Let's Encrypt 证书，certbot 自动续期

* 进程管理：systemd，非特权用户运行

* 数据备份：sqlite3 .backup 在线热备，每日自动执行

* 监控告警：服务异常邮件告警

* CI/CD：GitHub Actions（自动语法检查 + 单元测试 + 自动部署）

* 容器化：Docker + Docker Compose（支持一键本地部署）

## 目录结构



```
study-tracker/
├── frontend/                  # 前端文件
│   ├── index.html            # 主页面（单文件应用，含全部 CSS/JS）
│   ├── sw.js                 # Service Worker（离线缓存）
│   ├── manifest.json         # PWA 应用清单
│   ├── icon-192.png          # 应用图标 192x192
│   ├── icon-512.png          # 应用图标 512x512
│   ├── apple-touch-icon.png  # iOS 添加到桌面图标
│   ├── favicon-64.png        # 浏览器标签页图标
│   ├── paper-warm.jpg        # 浅色模式纸纹背景
│   └── paper-dark.jpg        # 深色模式纸纹背景
├── backend/                   # 后端文件
│   ├── server.js             # 应用入口
│   ├── config.js             # 配置管理
│   ├── database.js           # 数据库初始化与连接
│   ├── package.json          # 依赖声明
│   ├── middleware/
│   │   └── auth.js           # JWT 鉴权中间件
│   ├── routes/
│   │   ├── auth.js           # 注册登录路由
│   │   ├── user.js           # 用户信息路由
│   │   ├── data.js           # 数据同步路由（支持 ETag 增量）
│   │   └── admin.js          # 管理员面板路由
│   ├── utils/
│   │   ├── syncMerge.js      # 服务端数据合并算法
│   │   ├── verification.js   # 邮箱验证码
│   │   ├── mailer.js         # 邮件发送
│   │   ├── respond.js        # 统一响应格式
│   │   ├── logger.js         # JSONL 日志
│   │   ├── audit.js          # 审计日志
│   │   ├── alert.js          # 告警邮件
│   │   ├── scheduler.js      # 背书复习调度算法
│   │   └── metrics.js        # 性能指标
│   ├── scripts/
│   │   ├── backup.sh         # 数据库备份脚本
│   │   ├── study-backup.service  # systemd 备份服务
│   │   ├── study-backup.timer    # systemd 备份定时器
│   │   └── study-tracker.service.study  # 应用服务单元
│   ├── data/                 # 数据库文件（不提交到 git）
│   ├── logs/                 # 日志文件（不提交到 git）
│   └── uploads/              # 用户上传（头像等）
├── deploy/                    # 部署配置
│   ├── yystudy-https.conf    # Nginx 生产配置（HTTPS、反代、缓存）
│   ├── nginx-api.conf         # Nginx API 反代配置（参考）
│   ├── enable-https.sh        # Let's Encrypt 证书配置脚本
│   └── study-tracker.service  # systemd 服务单元（参考）
├── .env.example               # 环境变量示例（复制为 .env 后填入实际值）
├── .gitignore                # Git 忽略规则
├── LICENSE                   # 开源协议
└── README.md                 # 本文件
```

## 核心设计

### 数据同步机制

采用 "本地优先 + 云端同步" 的最终一致性方案：



1. 用户数据默认存储在浏览器 localStorage，操作立即生效，不依赖网络

2. 登录后自动同步到服务器，支持多设备数据合并

3. 服务端采用对称合并算法（syncMerge.js），按 updatedAt 时间戳做 "最后写入胜"（LWW）

4. 墓碑机制（tombstones）记录删除操作，防止已删除数据在多设备同步时被复活

5. ETag 增量同步：客户端缓存上次数据的 ETag，请求时带 If-None-Match，服务端数据未变时返回 304，减少传输量

### 背书复习算法



* 经典间隔（classic）：根据 "记得 / 模糊 / 忘记" 三态动态调整复习间隔，模拟艾宾浩斯遗忘曲线

* 均匀分布：将待复习内容均匀分配到每天，避免某一天复习量过大

### 安全设计



* 密码使用 bcrypt 哈希存储，加盐防彩虹表

* JWT 鉴权，token\_version 支持强制下线

* CORS 白名单，仅允许 yystudy.top 域名访问 API

* /api/data 接口限流，每 IP 每分钟 30 次

* CSP 内容安全策略，防止 XSS

* 管理员危险操作需二次确认（重输密码）

* 服务以非特权用户运行，数据库文件权限 700

## 部署说明

### 环境要求



* Node.js 18+

* Nginx

* 系统：Linux（推荐 OpenCloudOS / CentOS / Ubuntu）

### 前端部署



1. 将 `frontend/` 目录下所有文件上传到服务器静态目录（如 `/var/www/yystudy/`）

2. 为 index.html、sw.js、manifest.json 生成 gzip 预压缩文件（gzip -9）

3. 配置 Nginx：静态资源服务 + gzip\_static on + 合理的缓存策略

### 后端部署



1. 将 `backend/` 目录上传到服务器（如 `/opt/study-tracker/backend/`）

2. 在 backend 目录执行 `npm install --production` 安装依赖

3. 复制 `.env.example` 为 `.env`，填写 JWT\_SECRET、SMTP 配置等

4. 配置 systemd 服务（参考 `scripts/study-tracker.service.study`）

5. 启动服务：`systemctl start study-tracker`

### 注意事项



* 部署后端时**绝不覆盖 .env**（含密钥）

* **绝不删除 node\_modules**（better-sqlite3 为原生模块，删除后需重新编译）

* 改完后端必须 `systemctl restart study-tracker`

* 数据库文件位于 `backend/data/study.db`，定期备份

### Docker 一键部署（推荐本地开发/测试）

1. 复制环境变量配置：
   ```bash
   cp .env.example .env
   # 编辑 .env，填入 JWT_SECRET、SMTP 等配置
   ```

2. 启动服务：
   ```bash
   docker-compose up -d
   ```

3. 访问：
   - 前端：http://localhost:8080
   - 后端 API：http://localhost:3001/api/health

4. 停止服务：
   ```bash
   docker-compose down
   ```

数据持久化在 Docker volume 中（`backend-data`、`backend-logs`、`backend-uploads`），不会因容器重建而丢失。

### CI/CD 自动部署

项目配置了 GitHub Actions 工作流：

* **CI**（`.github/workflows/ci.yml`）：每次 push/PR 自动运行后端语法检查、单元测试、前端语法检查
* **Deploy**（`.github/workflows/deploy.yml`）：push 到 main 分支后自动部署到生产服务器

配置自动部署需要在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加以下 Secrets：

| Secret 名 | 说明 |
|---|---|
| `SSH_PRIVATE_KEY` | SSH 私钥（用于部署到服务器） |
| `SERVER_HOST` | 服务器地址（IP 或域名） |
| `SSH_USER` | SSH 登录用户名 |
| `APP_DOMAIN` | 应用域名（用于健康检查） |

## 开发说明

### 前端开发

前端为单文件 `index.html`，所有 CSS 和 JS 都内联在其中。修改时直接编辑该文件即可，无需构建工具。

语法检查：



```
node --check <(sed -n '/<script>/,/<\/script>/p' frontend/index.html | head -n -1 | tail -n +2)
```

### 后端开发



```
cd backend
npm install          # 安装全部依赖（含开发依赖）
node server.js       # 本地启动（默认监听 3001 端口）
```

### 运行测试

后端包含数据合并和复习调度算法的单元测试：

```bash
cd backend
npm test
```

测试覆盖：
* 数据同步合并（12 个用例）：墓碑机制、多设备合并、LWW 策略、墓碑清理等
* 背书复习调度（15 个用例）：三态标记、间隔计算、毕业判定、退轮机制等

### API 文档

完整的接口文档见 [docs/API.md](docs/API.md)，包含认证、用户、数据同步、管理员等所有接口的请求/响应格式说明。

### 数据结构

用户数据 store 的顶层结构：



```
{
  currentId: "当前项目ID",
  projects: { "项目ID": { 项目详情 } },
  unitTemplates: { "习题册模板ID": {} },
  paperTemplates: { "套卷模板ID": {} },
  tombstones: { "被删除的ID": 删除时间戳 }
}
```

## 版本历史



| 版本  | 日期         | 主要变更                              |
| --- | ---------- | --------------------------------- |
| v1  | 2026-09-15 | 初始版本，单页学习记录应用                     |
| v6  | 2026-09-20 | 新增苹果数据防护机制，iOS 数据丢失防护             |
| v7  | 2026-09-21 | 新增备份弹窗保护，存储异常时提醒导出                |
| v11 | 2026-09-28 | 功能完善：刷题 / 错题 / 背书三大模块，PWA 支持，深色模式 |
| v13 | 2026-09-30 | 全栈版本：加入 Node.js 后端，邮箱登录，云端同步      |
| v15 | 2026-10-01 | 稳定版本：服务端合并算法，管理员面板，安全加固           |
| v17 | 2026-10-02 | 视觉定稿：纸感学院派设计，品牌图标，性能优化            |
| v18 | 2026-10-03 | 修复图标更新问题，ETag 增量同步，同步性能优化         |

## 许可证

代码开源，欢迎学习参考和提 Issue / PR。

## 联系方式



* 项目地址：[https://yystudy.top](https://yystudy.top)

* ICP 备案：皖 ICP 备 2026033517 号