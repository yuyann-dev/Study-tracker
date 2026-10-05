# Study Tracker 后端与数据安全审查报告

- 审查日期：2026-10-04
- 审查范围：`backend/`（server.js / config.js / database.js / middleware / routes / utils）+ 前端 `app.js` 的 XSS 链路 + `.gitignore` / `.env.example` / `backup.sh`
- 审查方式：只读静态审查，未修改任何文件、未做渗透测试、未读取 `.env`
- 实际路由清单：`routes/` 下仅 `auth.js / data.js / user.js / studyRoom.js / admin.js`（不存在 review.js / mistake.js / stats.js）

## 总体结论

上一轮列出的修复基本到位：JWT 强度兜底、邀请码条件抢占（`WHERE used_count < max_uses`）、改邮箱需旧密码+验证码、事务包裹、越权防护、超管 id=1 写操作全量拦截、软删除按"未登录"处理、token_version 强制下线，均已落实。

**未发现 P0 级远程代码执行 / 未授权批量数据泄露 / SQL 注入**。但存在 2 个 P1（用户枚举、已登录态邮件轰炸）与若干 P2 加固项。

---

## P0（安全漏洞 / 数据泄露风险）

**本轮审查未发现 P0。**

说明：
- 所有 better-sqlite3 查询均使用 `?` 占位符；仅有的动态 SQL（`admin.js` 的 WHERE 拼接、`IN(?)` 占位符列表、`studyRoom.js` 的 `sets.join(', ')`、`database.js` 的 `ensureColumn`）拼接的都是**硬编码片段/列名**，用户输入一律走绑定参数，无字符串注入点。
- 所有路由均在 `router.use(authRequired)` 或逐路由 `authRequired` 之后；`admin.js` 整路由 `authRequired + requireAdmin`。
- 用户数据读写全部基于 `req.user.id`，未发现"改 id 参数操作用户 B 数据"的越权点。
- 超管 id=1 的重置密码/封禁/软删/物理删/降级全部被显式拦截。

---

## P1（防护缺失）

### P1-1　`reset-password` 接口存在邮箱用户枚举

- 文件：`backend/routes/auth.js:345`
- 代码：
  ```js
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(emailNorm);
  if (!row || row.deleted_at != null) return fail(res, '该邮箱未注册');
  ```
- 攻击场景：攻击者无需任何前置条件，直接对 `POST /api/auth/reset-password` 提交任意邮箱 + 错误验证码：
  - 邮箱**未注册** → 返回「该邮箱未注册」
  - 邮箱**已注册** → 走到 `verifyCode` 返回「请先获取验证码 / 验证码错误」
  两种响应文案不同，攻击者可离线批量探测哪些邮箱已注册，与 `send-code` 里刻意做的反枚举（统一返回"如果该邮箱已注册，验证码已发送"）自相矛盾。
- 修复建议：未注册时不要立即返回差异化文案，统一走完验证码校验流程后再返回相同提示。例如：
  ```js
  // 无论邮箱是否存在，都先 verifyCode；无验证码记录时统一返回
  const codeCheck = verifyCode(emailNorm, 'reset', code);
  if (!row || row.deleted_at != null) {
    // 邮箱不存在：若恰好也没验证码记录，返回与"验证码错误"相同的文案
    return fail(res, '验证码错误或已过期，请重新获取');
  }
  if (!codeCheck.valid) return fail(res, codeCheck.reason || '验证码错误或已过期，请重新获取');
  ```
  并确保"邮箱不存在 + 验证码错误"与"邮箱存在 + 验证码错误"返回完全一致的文案与 HTTP 状态码。

### P1-2　已登录态 `change-email/request` 无独立限流，可被用作邮件轰炸

- 文件：`backend/routes/user.js:93-124`；限流挂载见 `backend/server.js:95-107`
- 问题：`authLimiter`（10 次/分钟/IP）只挂在 `/api/auth/register`、`/api/auth/login`、`/api/auth/send-code` 上。`/api/user/change-email/request` 虽需登录，但**没有任何限流**；`verification.js` 的 60s 重发冷却只按 `${type}:${email}` 维度生效——即对**同一目标邮箱** 60s 一次，但攻击者（持有任意账号）可遍历大量不同受害者邮箱，每个都触发一封"更换邮箱验证码"邮件。
- 攻击场景：恶意注册一个账号后，循环调用 `POST /api/user/change-email/request { newEmail: 受害者邮箱 }`，向任意第三方邮箱批量发信，既消耗 SMTP 额度，也可用于社工/骚扰。
- 修复建议：
  1. 在 `server.js` 给 `/api/user/change-email/request` 单独挂一个 limiter（如每账号/IP 每小时 10 次）；
  2. 在 `verification.js` 增加"同一账号单位时间内对不同邮箱发码总数"计数（按 `req.user.id` 维度，不只是目标邮箱维度）；
  3. 邮件模板里加"如非本人操作请忽略"已具备，但发件频率仍需服务端兜底。

---

## P2（加固建议）

### P2-1　登录接口存在时序侧信道（用户枚举）

- 文件：`backend/routes/auth.js:257-284`
- 现象：邮箱不存在/已注销时，直接 `return fail(res, '邮箱或密码错误', 401)`，**跳过 `bcrypt.compareSync`**；邮箱存在但密码错误时会执行一次 bcrypt（约 50–100ms）。响应时间差可被用于枚举已注册邮箱。
- 修复建议：用户不存在时，对一个固定的假 hash 执行一次 `bcrypt.compareSync`，抹平时间差：
  ```js
  if (!row || row.deleted_at != null) {
    bcrypt.compareSync(String(password), '$2a$10$.........................'); // 预生成固定假 hash
    writeLoginLog({...result:'failed'});
    return fail(res, '邮箱或密码错误', 401);
  }
  ```
  （已有 10 次/分钟 IP 限流 + 账号锁定，风险被稀释，故列 P2。）

### P2-2　`send-code` 注册分支的响应时间差

- 文件：`backend/routes/auth.js:111-144`
- 现象：邮箱已注册（活跃账号）时第 112 行**提前 return 200，不触碰 SMTP**；邮箱未注册时会真实调用 SMTP（~200ms+）。生产环境 SMTP 正常时两者最终文案一致，但响应耗时差异仍可被高精度计时攻击利用。
- 修复建议：已注册邮箱提前 return 前，可 `await new Promise(r => setTimeout(r, 随机 50–150ms))` 与真实发信路径对齐耗时；或在 SMTP 正常时统一走"发码→返回"同一分支。

### P2-3　bcrypt cost factor 偏低

- 文件：`backend/config.js:48`
- 现状：`bcryptRounds: 10`。2026 年单机 GPU 暴力破解场景下，10 轮偏快。
- 建议：提升到 `12`（注册/改密延迟增加约 4 倍，单次仍 <300ms，可接受）；或迁移到 `argon2id`。注意 cost 变更只影响新 hash，老 hash 仍按旧 cost 校验，无需迁移。

### P2-4　JWT 有效期 30 天过长，无刷新轮换

- 文件：`backend/config.js:42`
- 现状：`expiresIn: '30d'`。token 被盗后，只要用户不改密码，30 天内一直可用（虽有 token_version 兜底改密/封禁，但不覆盖"token 泄漏且用户无感知"场景）。
- 建议：access token 缩短到 12–24h，配合 refresh token；或至少在 `authRequired` 里增加"距签发时间 > 7 天要求重新登录"的滑动续期。

### P2-5　数字参数未做 NaN/负数校验，边界输入会 500

- 文件：`backend/routes/admin.js:339`、`studyRoom.js:362,445`、`user.js`（多处 `parseInt`）
- 现象：`parseInt(req.params.id, 10)` 在 `id=abc` 时返回 `NaN`，better-sqlite3 绑定 `NaN` 会抛 `TypeError`，被路由 catch 后返回 500（虽不泄露堆栈，但属于未处理输入）。
- 修复建议：封装一个 `toInt(v, fallback)` 工具：
  ```js
  function toInt(v) { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; }
  // 用法：const targetId = toInt(req.params.id); if (!targetId) return fail(res, 'ID 不合法', 400);
  ```
  所有 `:id` / `:userId` / `:code` 入口统一走该校验。

### P2-6　`GET /api/admin/users/export` 未限制为超管

- 文件：`backend/routes/admin.js:249`
- 现状：整路由 `requireAdmin`，普通管理员即可导出全量用户 CSV（含邮箱、用户名、注册时间、最近同步）。
- 说明：若产品定位是"普通管理员也能管用户"则可接受；若认为"导出全量 PII"应是超管专属，建议在该路由加 `requireSuperAdmin`（与 `/audit-logs` 对齐）。

### P2-7　备份文件权限未显式收敛

- 文件：`backend/scripts/backup.sh:35-58`；`backend/routes/admin.js:63-76`（`exportUserStore`）
- 现状：`*.db` 备份与 `user-export-*.json` 落在 `backend/data/backups/`，含全量用户 `store_json`（学习数据）与 bcrypt hash。脚本未 `chmod 600`，依赖系统 umask；同机其他系统用户理论上可读。
- 修复建议：
  ```bash
  install -d -m 700 "$BACKUP_DIR"
  # sqlite3 .backup 完成后：
  chmod 600 "$OUT"
  ```
  `exportUserStore` 写文件时用 `fs.writeFileSync(file, row.store_json, { encoding: 'utf8', mode: 0o600 })`。
- 注：备份目录不在 `/uploads` 静态路径下，不会被外网直接访问，风险仅限本机。

### P2-8　头像上传未做 magic-byte 嗅探

- 文件：`backend/routes/user.js:32-39`
- 现状：`fileFilter` 只校验客户端声明的 `mimetype`，未校验文件头。由于落盘扩展名由 mimetype 映射表决定（`.png/.jpg/.webp/.gif`），且 `express.static` 按扩展名返回 `image/*` Content-Type，浏览器不会把它当 HTML 执行，实际 XSS 风险低。
- 建议：用 `file-type` 库嗅探前 12 字节，与声明 mimetype 不一致则拒绝；同时禁止上传 SVG（已在白名单外）。旧头像清理已有 `path.normalize + startsWith(uploadDir)` 防穿越，这点做得好。

### P2-9　自习室成员数上限存在理论竞态

- 文件：`backend/routes/studyRoom.js:289-295`
- 现状：`COUNT(*)` 在事务外，`INSERT` 在事务内。better-sqlite3 同步阻塞 + 中间无 `await`，实际单线程下不会被其他请求打断，竞态概率极低；但代码注释自称"MVP 阶段可接受"，建议显式收敛：把 COUNT+INSERT 放进同一 `db.transaction()`，并依赖 `UNIQUE(room_id,user_id)` 兜底。
- 另：软删除用户（`DELETE /api/user`）不会清理 `study_room_members` 记录，也不会把房主身份转让；若被软删用户恰是房主，会留下"owner_id 指向已删用户"的孤儿房。建议在用户软删事务内一并 `DELETE FROM study_room_members WHERE user_id=?` 并处理房主转让。

### P2-10　CORS 白名单仍包含 http:// 明文源

- 文件：`backend/server.js:33-38`
- 现状：`ALLOWED_ORIGINS` 含 `http://yystudy.top` / `http://www.yystudy.top`。生产应强制 HTTPS，http 源应 301 到 https 而非允许跨域。
- 建议：从 `ALLOWED_ORIGINS` 移除 http 条目，由 Nginx 层做 HTTP→HTTPS 跳转。

### P2-11　审计日志字段含 PII，保留期需合规

- 文件：`backend/utils/audit.js:39-52`、`backend/utils/logger.js:16`
- 现状：`login_logs.username` 存邮箱、`ip`、`ua`；文件日志保留 14 天。
- 建议：在隐私政策/文档中声明这些字段的用途与保留期；`audit_logs.detail_json` 写入时注意不要把临时密码、验证码塞进 detail（当前 `reset_password` 审计只写 `{ username }`，未写 tempPassword，这点正确，保持即可）。

---

## 已确认到位的防护（无需修改）

1. **JWT**：`server.js:17` 启动时强制 `JWT_SECRET ≥ 32` 字符，否则 `process.exit(1)`；`config.js` 首次启动自动生成随机 48 字节 hex 写入 `.env`；`jwt.verify(token, secret)` 未传 `algorithms`，对称 secret 下 `none` 算法无法通过；payload 带 `tv`（token_version），改密/封禁/删号即 `token_version+1` 强制旧 token 失效。
2. **越权**：`data.js` / `user.js` 整路由 `authRequired`，所有写操作基于 `req.user.id`；`studyRoom.js` 的 `/member/:userId` 显式校验两人 `room_id` 相同；`kick` / `settings` 校验 `me === ownerId`。
3. **超管保护**：`admin.js` 对 SUPER_ADMIN_ID 的 reset-password / status / soft-delete / permanent / admin（降级）全部 `return 403`；普通管理员不能管理其他管理员（`target.is_admin===1 && req.user.id!==SUPER_ADMIN_ID` 拦截）；至少保留一个可用管理员。
4. **邀请码竞态**：`auth.js:225-231` 用 `UPDATE ... WHERE used_count < max_uses AND revoked_at IS NULL` 原子抢占，`changes===0` 时回滚事务抛 `INVITE_CODE_TAKEN`。
5. **自习室隐私**：`studyRoom.js:201-229` `/me` 对 `study_room_public=0` 且非本人的成员，`todayReviewCount/checkedInToday` 一律返回 `null`；`/member/:userId` 对未公开者直接返回 `profile:null`。后端真正过滤，不是靠前端隐藏。streak 按设计属基础社交信息，对所有同房间成员可见。
6. **SQL 注入**：全量参数化；`LIKE` 查询 `%${q}%` 虽未转义 `%`/`_` 通配符（仅影响搜索匹配结果，非注入）。
7. **限流**：登录/注册/发码 10 次/分钟/IP；忘记密码 5 次/小时/IP；数据同步 30 次/分钟/IP；登录失败 10 次锁 15 分钟。
8. **XSS**：前端 `app.js:11` 定义 `esc()`，自习室成员列表（`app.js:12696-12727`）、广场卡片（`13020-13024`）、错因标签、跳过确认弹窗均用 `esc()` 包裹用户数据；项目名/标题走 `textContent`。后端返回 JSON，不渲染 HTML。
9. **审计日志**：`writeLoginLog` 记录 success/failed/locked/register/reset；`writeAudit` 记录 ban/unban/soft_delete/permanent_delete/grant_admin/revoke_admin/generate_invite/revoke_invite/batch_delete_invite/study_room_*。日志中**不记录明文密码/验证码**。
10. **.env 管理**：`.gitignore` 第 5-7 行显式忽略 `.env` / `.env.local`，仅保留 `.env.example`；`git ls-files` 确认未跟踪任何 `.env` / `.db` / `user-export-*`。
11. **错误处理**：全局兜底 `server.js:137-140` 统一返回"服务器开小差了"，不返回堆栈；各路由 catch 后也只返回通用文案。
12. **CSV 导出**：`admin.js:257-262` 做了 Formula Injection 防护（`= + - @` 前置单引号）与引号转义。

---

## 附：审查覆盖的文件清单

```
backend/server.js
backend/config.js
backend/database.js
backend/middleware/auth.js
backend/routes/auth.js
backend/routes/data.js
backend/routes/user.js
backend/routes/studyRoom.js
backend/routes/admin.js
backend/utils/respond.js
backend/utils/audit.js
backend/utils/verification.js
backend/utils/mailer.js
backend/utils/logger.js
backend/utils/statsCache.js
backend/utils/alert.js
backend/utils/metrics.js
backend/utils/syncMerge.js
backend/scripts/backup.sh
.gitignore / .env.example
frontend/js/app.js（innerHTML/esc/textContent 链路抽查）
```
