# Study Tracker 后续维护 / 修改 / 部署 指引 Prompt

> 用法：新建一个豆包对话，把下面「==== PROMPT 开始 ====」到「==== PROMPT 结束 ====」之间的全部内容复制发送即可。

==== PROMPT 开始 ====

我需要你继续维护我的全栈学习应用「Study Tracker」。请先完整阅读我本地的项目代码再动手，改动务必保证无 bug、不影响线上用户数据。

## 一、项目是什么
- Study Tracker：考研/学习规划 Web 应用，含刷题本（习题册/套卷两种模式）、错题本（自由出处/习题册/套卷三种模式 + 错题标签 + 薄弱点分析）、背书（经典间隔 classic / 均匀分布等模式，记得·模糊·忘记三态）。
- 前端：单文件 `index.html`（原生 HTML/CSS/JS，无框架，自包含），PWA（manifest + service worker），支持添加到桌面、深色模式、手机/平板/PC 全适配。
- 后端：Node.js Express + better-sqlite3，提供邮箱验证码注册登录、JWT 鉴权、云端数据自动同步、管理员面板。
- 数据：用户学习数据默认存浏览器 localStorage/IndexedDB，登录后自动同步到服务器；仍支持 JSON 手动导入/导出。
- 本项目为本科毕业设计，已上线生产环境。

## 二、服务器与域名（生产环境）
- 腾讯云轻量应用服务器，区域上海 ap-shanghai，实例 ID `lhins-rn61vlnk`，公网 IP `43.142.72.50`，系统 OpenCloudOS 9.6。
- 域名 `yystudy.top`（DNSPod，所有人喻颜），@ 与 www 均解析到 43.142.72.50。
- ICP 备案号 `皖ICP备2026033517号`（首页底部悬挂并链接 https://beian.miit.gov.cn ）；公安联网备案已完成。
- HTTPS：Let's Encrypt 证书（certbot，自动续期），80 自动跳转 443。
- 控制台：https://console.cloud.tencent.com/lighthouse/instance/detail?id=lhins-rn61vlnk

## 三、SSH 连接信息
- 私钥路径：`C:\Users\MXyuan\.ssh\study_tracker_ed25519`（ed25519 密钥对）
- 公钥：`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID6kOpDw76JJo8Obc8wVRXeQTsrFx2lu+D7XRHcQYTZM study-tracker-deploy`
- 连接命令：`ssh -i "$env:USERPROFILE\.ssh\study_tracker_ed25519" -o StrictHostKeyChecking=no root@43.142.72.50`
- 公钥已添加到服务器 root 用户的 authorized_keys，可免密登录。
- 如密钥丢失或需重新配置：在本地用 `ssh-keygen -t ed25519 -f study_tracker_ed25519 -N ""` 生成新密钥对，然后通过腾讯云控制台 Web 终端（OrcaTerm）将公钥追加到 `~/.ssh/authorized_keys`。

## 四、Git 仓库信息（2026-10-03 初始化）
- 本地 Git 仓库：`C:\Users\MXyuan\Doubao\chats\2026-10-03\new-chat-2\study-tracker-git\`（权威开发仓库）
- 服务器 Git 仓库：`/opt/study-tracker/`（生产环境代码，已初始化 git）
- 主分支：`master`
- 版本标签：
  - `v1-初始版本`（2026-09-15）
  - `v6-苹果数据防护`（2026-09-20）
  - `v7-备份弹窗保护`（2026-09-21）
  - `v11-功能完善`（2026-09-28）
  - `v13-全栈版本`（2026-09-30）
  - `v15-稳定版本`（2026-10-01）
  - `v18-current`（2026-10-03，当前生产版本）
- 提交规范：使用 Conventional Commits 格式（feat/fix/docs/refactor/chore 等），中文提交信息，写清变更内容和原因。
- .gitignore 已排除：node_modules/、.env、data/、logs/、uploads/、*.db、*.gz、backups/ 等。
- 部署后记得将变更提交到本地 git 仓库，并同步到服务器（`git pull` 或重新 bundle 导入）。

## 五、服务器上的关键路径（部署时牢记）
- 前端目录：`/var/www/yystudy/`（index.html 走 ETag 校验、图标长缓存，部署包含预压缩 .gz）
- 后端目录：`/opt/study-tracker/backend/`（server.js 入口）
- 数据库：`/opt/study-tracker/backend/data/study.db`
- Nginx 配置：`/etc/nginx/conf.d/yystudy.conf`（静态前端 + /api 反代 http://127.0.0.1:3001，80→443）
- SSL 证书：`/etc/letsencrypt/live/yystudy.top/`
- 服务：systemd 单元 `study-tracker`（`systemctl status/restart study-tracker`），Node 监听 127.0.0.1:3001
- **服务以非特权用户 `study` 运行（已降权，非 root）**：`/opt/study-tracker` 整体属主 study:study，权限 u+rwX、go-rwx，父目录 /opt/study-tracker 与 backend 给 o+x（仅遍历）、uploads 给 go+rX 供 Nginx 穿透读头像、data 保持 700；`.env` 权限 600。
- 文件日志：`/opt/study-tracker/backend/logs/access-YYYY-MM-DD.jsonl`（请求）与 `app-YYYY-MM-DD.jsonl`（info/warn/error），按天轮转、默认保留 14 天。
- 自动备份：systemd `study-backup.timer` 每日 03:00 触发 `study-backup.service`，sqlite3 `.backup` 在线热备到 `data/backups/`，保留 7 天 + 每月 1 号归档，失败发 SMTP 告警。
- 健康检查：`https://yystudy.top/api/health` 返回 {"ok":true}
- **铁律：部署后端时绝不覆盖 `.env`（含 JWT_SECRET、SMTP 授权码）、绝不删除 `node_modules`（better-sqlite3 为原生模块）。改完后端必须 `systemctl restart study-tracker`。**

## 六、本地项目路径（Windows）
- **Git 开发仓库**：`C:\Users\MXyuan\Doubao\chats\2026-10-03\new-chat-2\study-tracker-git\`（含完整提交历史，推荐在此工作）
- **历史版本存档**：`D:\喻颜资料\大学资料\Studytracker项目\源代码\`（含 v1-v17 各版本压缩包和单文件版）
- 前端：`<仓库>\frontend\index.html`（CRLF 行尾；Edit 匹配失败时用 Python 脚本处理 \r\n）
- 后端：`<仓库>\backend\`（config.js、server.js、database.js、middleware/auth.js、routes/{auth,data,admin,user}.js、utils/{mailer,respond,syncMerge,verification,alert,audit,logger,metrics,scheduler}.js）
- 改完并部署后：把更新后的代码提交到 git 仓库，并同步更新本 prompt 的变更记录。

## 七、标准修改与部署流程

### 方式一：SSH 直接部署（推荐，2026-10-03 起可用）
1. 先 Read 本地相关代码，确认逻辑后再改；只改我点名的范围，不动无关逻辑。
2. 改完前端运行语法检查；后端用 `node --check 文件名.js`。
3. 用 scp 上传修改的文件到服务器临时目录（如 /tmp/deploy/）。
4. SSH 连接服务器，将文件移动到目标位置：
   - 前端：`cp -f /tmp/deploy/* /var/www/yystudy/`，然后为 index.html/sw.js/manifest.json 生成 gzip（`gzip -c -9 file > file.gz`），设置 `chown -R study:study /var/www/yystudy/`。
   - 后端：只覆盖修改的代码文件（routes/、utils/、middleware/、config.js、server.js 等），**绝不碰 .env 和 node_modules**，设置属主 study:study，然后 `systemctl restart study-tracker`。
5. 部署后验证：`curl -s https://yystudy.top/api/health`，检查前端页面是否正常。
6. 将变更提交到本地 git 仓库，写清 commit message。

### 方式二：TAT 自动化助手（原有方式，备用）
1. 运行打包脚本生成 dist/frontend.zip、dist/backend.zip。
2. 上传 zip 得到可访问 URL（FileBatchUpload）。
3. 用腾讯云「自动化助手 TAT」创建命令执行部署（注意地域切到上海）。

## 八、核心机制（改同步/时间逻辑前必读）
- store 顶层结构：`{currentId, projects, unitTemplates, paperTemplates, tombstones}`，records 以 rid 去重。
- 多设备同步三层保障：①前端墓碑 tombstones（删除任务时记录，保留 30 天）；②客户端先拉后推（防抖 60 秒）；③服务端对称合并 `backend/utils/syncMerge.js`（墓碑取最大、项目按 updatedAt 取新、records 按 rid 去重、items 按 id 合并、条目字段按 updatedAt LWW）。
- **ETag 增量同步（v18 新增）**：GET /api/data 支持 If-None-Match，服务端数据未变返回 304，客户端 `_lastSyncEtag` 缓存 ETag；登出/401 时清除 ETag 状态。
- **syncPending 防丢同步（v18 修复）**：同步进行中又有新变更时标记 syncPending，当前同步结束后自动补一次，不再直接丢弃请求。
- **时钟漂移口径**：项目与条目的 `updatedAt` 由客户端时钟生成，合并按 updatedAt LWW，时钟严重漂移时可能并非真正最新值。本项目定位为最终一致性，不宣称严格因果一致。
- 存储配额：单用户 5 MB、总量 50 MB；超限返回 413。
- 管理员两级角色：超级管理员（id=1，全局唯一，硬保护）和普通管理员（超管授予，不能管理超管和设置管理员）。
- **时间一律 UTC 存储、按本地时区显示**：后端 SQLite 用 `datetime('now')`（UTC），前端必须用 `parseServerTime()` 显式按 UTC 解析再转本地时区显示，不得直接截取服务器字符串。
- **前端缓存策略**：index.html 用 `no-cache, must-revalidate`（靠 ETag 校验）；sw.js 必须 `no-store`（防 SW 更新卡住）；manifest.json 1d；图标等静态资源 `30d + immutable`。
- **图标 cache-busting（v18 修复）**：所有图标引用加 `?v=2`，SW 版本号升级到 v20，CORE 缓存列表中的图标也加版本号，修复安卓 PWA 启动器图标不更新问题。下次更新图标时需同时升级 SW 版本号和图标 ?v= 版本号。

## 九、视觉品牌（方案B 纸感学院派，全局定稿）
- 浅色暖白纸 `--bg #f3ecdf`、卡片 `#fffaf1`；深色哑光蓝灰 `--bg #273859`、卡片 `#3a5079`。两套都经 body::before 平铺纸纹。
- 主色哑光墨绿 `--brand #2e6b4f`（深色 `#83bca9`），杜绝荧光绿、紫蓝渐变。
- 品牌图标：字母 S 丝带同时构成顶部学位帽（带流苏）与底部翻开的书，单色墨绿 + 暖纸底、零渐变零发光。全套 icon-512/192、apple-touch、favicon-64，不分深浅统一一套。

## 十、最新变更记录（v18，2026-10-03）
1. **图标 cache-busting**：SW 升级 v20，所有图标引用加 ?v=2，修复安卓 PWA 启动器图标清理缓存后仍不更新的问题。
2. **scheduleCloudSync 丢同步 bug**：新增 syncPending 机制，同步进行中又有新变更时标记，当前同步结束后自动补一次。
3. **ETag 304 增量同步**：前后端支持 If-None-Match，服务端数据未变时返回 304，省掉全量 JSON 下载。
4. **修复重复 controllerchange 监听器**：首次安装 SW 时不再不必要刷新。
5. **triggerSync 同步中不再丢弃请求**：改为排队等待当前同步结束后补一次。
6. **登出/401 时清除 ETag 状态**：切换账号后重新全量拉取。
7. **shimmer 骨架条美化**：匹配真实列表项布局，同步加载更优雅。
8. **初始化 Git 仓库**：本地和服务器均建立 git，含 v1-v18 完整提交历史。
9. **添加毕业设计标准 README**：项目文档完善。

## 十一、我的偏好与已关闭方向
- 交付代码时直接在回复里贴完整可复制代码块，不要只给下载链接；用简体中文。
- 我是学生，预算优先免费；极度重视数据稳定与隐私，改动要稳、先彻底搞清楚再给方案，不要反复试错。
- 已永久关闭、不要再做：任何统计埋点（51.la / 百度统计，已全删）；小红书自动发货 / /claim 接口；Cloudflare / EdgeOne / mindock；付费发卡平台。
- 不要浏览器实测（效率低），通过代码审查找到问题并修复。
- 部署后要本地备份（覆盖原文件并覆盖原后续修改 prompt）。

==== PROMPT 结束 ====
