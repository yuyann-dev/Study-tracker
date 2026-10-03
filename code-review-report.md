# Study Tracker 后端代码审查报告

> 审查范围：`backend/` 下 server.js / config.js / database.js / middleware/auth.js / routes/(auth,data,admin,user).js / utils/(syncMerge,mailer,verification,scheduler,audit,logger,metrics,alert,respond).js
> 方式：纯静态代码审查 + 关键逻辑本地最小验证。未做浏览器/端到端测试，未修改任何代码。
> 日期：2026-10-03

---

## 一、问题清单（按严重程度排序）

### 🔴 高（High）

#### H1. 外键约束导致「物理删除用户」与「注销后重新注册」必然失败（500）
- **文件/行号**：
  - `routes/admin.js:548-552`（管理员永久删除事务）
  - `routes/auth.js:176`（软注销用户用同邮箱重新注册时的硬删除）
  - 根因 schema：`database.js:79-80` —— `invite_codes.created_by / used_by INTEGER REFERENCES users(id)`，**未声明 `ON DELETE` 动作**
- **问题描述**：
  代码在硬删除 users 行前，只把 `created_by` 置 NULL，刻意保留 `used_by`（注释写明"保持已使用状态"）：
  ```js
  db.prepare('UPDATE invite_codes SET created_by = NULL WHERE created_by = ?').run(targetId);
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId); // ← 若 used_by 指向本行，外键约束失败
  ```
  由于 `database.js:39` 开启了 `PRAGMA foreign_keys = ON`，而 `used_by` 对 users(id) 的引用没有任何 `ON DELETE` 动作（SQLite 默认 NO ACTION），**只要该用户当年是凭邀请码注册的（used_by 已被占用），DELETE 就会抛 `FOREIGN KEY constraint failed (19)`**。该异常被外层 `try/catch` 捕获后返回 500。
- **影响面**：
  - `DELETE /api/admin/users/:id/permanent`：对所有"非首个用户"（即所有走邀请码注册的真实用户）永久删除全部失败，用户永远卡在回收站。
  - `POST /api/auth/register`：用户自助注销后用同一邮箱重新注册时（auth.js:176 硬删旧号）同样 500，无法重新注册。
  - 注：首个超管 id=1 无 used_by 且本身被禁止删除，故问题恰好不在超管身上，极具迷惑性。
- **修复建议**：
  - 方案 A（推荐）：给外键加 `ON DELETE SET NULL`：`used_by INTEGER REFERENCES users(id) ON DELETE SET NULL`、`created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`，迁移时 `PRAGMA foreign_keys=OFF` 后重建表（SQLite 不支持 ALTER 修改外键）。
  - 方案 B：在硬删除事务内先 `UPDATE invite_codes SET used_by = NULL WHERE used_by = ?`（与 created_by 同等处理），再 DELETE。

#### H2. 邀请码过期判断因日期格式不一致而失效（到期当天全天仍可用）
- **文件/行号**：
  - 写入处：`routes/admin.js:570` —— `expiresAt = new Date(...).toISOString()` → `"2026-10-10T12:00:00.000Z"`（带 `T`/`Z`/毫秒）
  - 比较处：`routes/auth.js:82` —— `(expires_at IS NULL OR expires_at > datetime('now'))`，`datetime('now')` = `"2026-10-03 04:00:00"`（空格分隔）
  - 连带：`routes/admin.js:90` 的 `expiredInviteCodes` 统计用同样的字符串比较
- **问题描述**：
  两个字符串在第 11 个字符处分别是 `'T'`(0x54) 与 `' '`(0x20)，`'T' > ' '`。因此**只要过期时间与"现在"是同一天，无论当天几点，`expires_at > datetime('now')` 恒为 true**，验证码（邀请码）被判为"未过期"。已本地实测验证：`"2026-10-03T05:35:07.033Z" > "2026-10-03 04:00:00"` 结果为 `true`（即 2 小时前就该过期的码仍视为有效）。
- **影响面**：
  - 邀请码在其"到期日"当天完全不失效，实际过期时间被推迟到次日 UTC 零点之后；管理员设的 `expiresInDays` 时间精度丢失。
  - `/admin/stats` 的 `expiredInviteCodes` 几乎永远为 0。
  - 注意 `routes/admin.js:662` 的批量清理用 `new Date()` JS 解析是正确的，导致"注册校验"与"批量清理"对同一条码的是否过期判断互相矛盾。
- **修复建议**：统一时间格式。写入时改用 SQLite 格式：`new Date(Date.now()+days*864e5).toISOString().slice(0,19).replace('T',' ')`，或比较时用 SQLite 函数 `datetime(expires_at) > datetime('now')`。

---

### 🟡 中（Medium）

#### M1. 存储配额只展示、不强制拦截
- **文件/行号**：`config.js:55-60`（perUserMB=5 / totalMB=50），`routes/data.js:76`
- **问题描述**：PUT /api/data 落库前只做了 `if (json.length > config.jsonBodyLimitBytes)`（10MB，即 body 上限），**从未按 `perUserMB`(5MB) 或 `totalMB`(50MB) 做应用层配额判断**。配额仅在 `/admin/stats`（admin.js:104-105）里算个百分比展示。
- **影响面**：单用户实际可同步至多 10MB（是标称配额 5MB 的 2 倍），总量配额无上限。
- **修复建议**：在 data.js PUT 落库前计算 `Buffer.byteLength(json,'utf8')`，超过 `perUserMB*1024*1024` 返回 413；并可选校验全表 `SUM(LENGTH(store_json))` 是否超 `totalMB`。

#### M2. 管理员重置用户密码无二次密码校验（与其他高危操作不一致）
- **文件/行号**：`routes/admin.js:371-392`
- **问题描述**：撤销管理员权限（admin.js:455-462）和永久删除用户（admin.js:540-546）都要求重输当前管理员登录密码，但 **`POST /users/:id/reset-password`（直接接管某账号、并在响应里明文返回临时密码）却不需要二次校验**。一旦管理员会话被冒用，无需口令即可接管任意普通用户。
- **修复建议**：与 permanent/reset-admin 对齐，对 reset-password 同样要求 `body.password` 并 `bcrypt.compareSync` 校验当前管理员口令。

#### M3. items / records 的删除不参与墓碑合并，跨端删除会"复活"
- **文件/行号**：`utils/syncMerge.js:131-135`（墓碑仅按 project id 应用）、`84-120`（mergeItems 纯 union）、`149-160`（records 纯 union）
- **问题描述**：`mergeProjects` 只在项目级检查 `tombstones[id]`；`mergeItems` 对同 id 做 union + 字段级 LWW，`records` 按 rid union，二者都**不查墓碑**。若设备 A 删除了某个 item（并写了 tombstones），设备 B 仍持有该 item，合并时 B 的副本会被 union 回来，删除无法跨端生效（打卡记录/错题本删除后在另一台设备复活）。
- **修复建议**：在 mergeItems / records union 前，按 id/rid 过滤掉 `tombstones` 中标记为删除（且时间晚于该条目 updatedAt）的条目；或在文档中明确"item/records 删除不做跨端同步"的口径。

#### M4. /send-code 可枚举已注册邮箱
- **文件/行号**：`routes/auth.js:105`（"该邮箱已注册，请直接登录"）vs `:114`（"该邮箱未注册"）
- **问题描述**：登录接口刻意返回统一的"邮箱或密码错误"防枚举，但未鉴权的 `/api/auth/send-code` 对 register 与 reset 两类返回明确不同的文案，攻击者可批量探测哪些邮箱已注册。
- **修复建议**：对 reset/register 两种分支统一返回（如"若该邮箱存在，验证码已发送"），或在 reset 分支对未注册邮箱也假装发送成功。

---

### 🟢 低（Low）

| 编号 | 文件/行号 | 问题 | 建议 |
|---|---|---|---|
| L1 | `routes/auth.js:65-67` `isFirstUser()` | `SELECT COUNT(*) FROM users` 未排除 `deleted_at`，若唯一用户被软删后会误判仍"有用户"，导致后续注册要求邀请码但无管理员可发码（当前因超管不可自删而未触发，属隐患） | 加 `WHERE deleted_at IS NULL` |
| L2 | `routes/user.js:93-113` `change-email/request` | 只受验证码 60s 冷却约束，未像 `/api/auth/*` 那样挂 IP 级限流，可被用来向任意新邮箱群发邮件 | 对该路由加 `express-rate-limit` |
| L3 | `routes/user.js:35-38` 头像 fileFilter | 仅按客户端声明的 `mimetype` 放行，未校验文件魔数（magic bytes），可上传伪装扩展名的非图片文件 | 用 `file-type` 嗅探文件头 |
| L4 | `routes/admin.js:577-583` 邀请码生成 | 碰撞重试 `guard<5` 耗尽后仍 `insert.run(code)`，极小概率命中 UNIQUE 冲突抛 500 | 耗尽后改返回错误而非强行插入 |
| L5 | `utils/audit.js:15-20` `clientIp` | 直接取 `X-Forwarded-For` 第一段，客户端可伪造该头污染登录/审计日志 IP（`trust proxy=1` 下应优先用 `req.ip`） | 改用 `req.ip` 为主 |
| L6 | `utils/mailer.js:116-144` `sendResetEmail` | 死代码（路由均改用 sendVerificationCode），且把 `resetUrl` 直接拼进 HTML/href，存在潜在 XSS 面 | 删除或改为转义 |
| L7 | `routes/auth.js:194-202` 注册事务 | INSERT users 与 UPDATE invite_codes 未包在 `db.transaction` 内，邀请码占用失败会留下"已建号但未核销邀请码"的中间态 | 包事务 |
| L8 | 各路由 `console.error` | 与 `utils/logger` 不统一，错误只进 stdout 不进 jsonl 归档 | 统一改用 `logger.log('error',...)` |

---

## 二、已检查且未发现问题的领域

- **SQL 注入**：所有 SQL 均使用 `?` 占位符；动态 WHERE（admin.js:283-298）的表/列名硬编码、值全部参数化；LIKE 参数化；批量删除用占位符展开。**未发现注入点**。
- **权限隔离 / IDOR**：`/api/admin` 全路由 `authRequired+requireAdmin` 收口，`audit-logs`/`set-admin` 再加 `requireSuperAdmin`；数据类接口一律以 `req.user.id` 限定，未发现普通用户越权访问他人数据或管理员接口。
- **超级管理员(id=1)硬保护**：reset-password / status / set-admin / 软删 / 物理删 / 自助注销 六处均对 `SUPER_ADMIN_ID` 做了拦截（admin.js:376,403,451,485,537；user.js:213），且降级/删号有"至少保留一个可用管理员"校验。**保护到位**。
- **JWT**：`jwt.verify` 校验签名；payload 带 `tv`，与库中 `token_version` 强比对（auth.js:79），改密/封禁/删号即 +1 强制下线；`config.js` 首次启动自动生成 48 字节随机 `JWT_SECRET`。
- **密码哈希**：bcrypt（rounds=10），登录/改密/重置均 `compareSync`/`hashSync`，publicUser 不回传 `password_hash`。
- **验证码爆破防护**：6 位 `crypto.randomInt`、5 次尝试上限、5 分钟 TTL、60s 重发冷却、成功即删；外层另有 IP 限流（authPerMinute=10/min）。
- **登录爆破防护**：连续失败 10 次锁 15 分钟，成功清零；软删/注销账号按"用户不存在"模糊返回。
- **数据一致性（其余）**：软删/物理删/自助注销主流程均包 `db.transaction`；`user_data` 外键 `ON DELETE CASCADE`；WAL 模式；迁移幂等（`ensureColumn` + `CREATE IF NOT EXISTS`）。
- **响应封装**：统一 `ok/fail`，全局错误兜底不泄露堆栈（server.js:127-130）。
- **合并算法主体**：LWW + 墓碑的项目级合并、`mergeItems` 字段级 LWW、`pruneTombstones` 30 天 GC 逻辑自洽（仅 M3 所述 item/records 删除未覆盖）。

---

## 三、结论

共发现 **2 个高危、4 个中危、8 个低危**问题。两个高危（H1 外键硬删除失败、H2 邀请码过期失效）均为可稳定复现的功能正确性缺陷，建议优先修复；其中 H1 会直接导致"回收站清空/用户重新注册"两个核心流程对真实用户报错 500。安全面（注入、越权、JWT、密码哈希、爆破防护、超管保护）整体做得比较扎实，未发现可直接利用的入侵通道。
