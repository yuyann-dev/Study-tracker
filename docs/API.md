# Study Tracker API 文档

基础路径：`/api`

所有响应统一格式：
```json
{ "ok": true, "data": {...} }
```
或
```json
{ "ok": false, "error": "错误信息" }
```

需登录的接口在请求头携带 `Authorization: Bearer <token>`。

---

## 一、认证相关（/api/auth）

### POST /api/auth/send-code
发送邮箱验证码（注册或重置密码时使用）。

限流：每 IP 每分钟 10 次。

请求体：
```json
{ "email": "user@example.com", "purpose": "register" }
```
- `purpose`: `register`（注册）或 `reset`（重置密码）

响应：
```json
{ "ok": true, "data": { "message": "验证码已发送" } }
```

### POST /api/auth/register
注册新用户（邀请码制，首个用户可省略邀请码）。

限流：每 IP 每分钟 10 次。

请求体：
```json
{
  "email": "user@example.com",
  "code": "123456",
  "username": "用户名",
  "password": "密码（至少8位）",
  "inviteCode": "邀请码（首个用户可省略）"
}
```

响应：
```json
{ "ok": true, "data": { "token": "jwt_token", "user": { "id": 1, "username": "...", "email": "..." } } }
```

### POST /api/auth/login
登录。

限流：每 IP 每分钟 10 次。连续失败会触发账号锁定。

请求体：
```json
{ "email": "user@example.com", "password": "密码" }
```

响应：
```json
{ "ok": true, "data": { "token": "jwt_token", "user": { "id": 1, "username": "...", "email": "..." } } }
```

### POST /api/auth/reset-password
通过邮箱验证码重置密码。

限流：每 IP 每小时 5 次。

请求体：
```json
{ "email": "user@example.com", "code": "123456", "newPassword": "新密码（至少8位）" }
```

响应：
```json
{ "ok": true, "data": { "message": "密码已重置，请使用新密码登录" } }
```

### GET /api/auth/me
获取当前登录用户信息。

需登录。

响应：
```json
{ "ok": true, "data": { "id": 1, "username": "...", "email": "...", "avatar": "...", "isAdmin": false } }
```

### POST /api/auth/logout
登出（当前 token 加入吊销列表，立即失效）。

需登录。

---

## 二、用户相关（/api/user，需登录）

### PUT /api/user/profile
更新用户信息（用户名等）。

请求体：
```json
{ "username": "新用户名" }
```

### POST /api/user/change-email/request
申请修改邮箱，向新邮箱发送验证码。

请求体：
```json
{ "newEmail": "new@example.com", "password": "当前密码" }
```

### POST /api/user/change-email/confirm
确认修改邮箱（校验新邮箱收到的验证码）。

请求体：
```json
{ "newEmail": "new@example.com", "code": "123456" }
```

### PUT /api/user/password
修改密码。修改成功后 token_version 递增，旧 token 全部失效（强制下线其他设备）。

请求体：
```json
{ "oldPassword": "旧密码", "newPassword": "新密码（至少8位）" }
```

### POST /api/user/avatar
上传头像（multipart/form-data，字段名 `avatar`，限制 2MB，支持 jpg/png/webp/gif）。

响应：
```json
{ "ok": true, "data": { "avatarUrl": "/uploads/xxx.jpg" } }
```

### DELETE /api/user/
注销账号（软删除，进入回收站，符合 PIPL 第47条）。删除前导出用户数据，token_version 递增强制下线。

请求体：
```json
{ "password": "当前密码", "confirm": true }
```

---

## 三、数据同步（/api/data，需登录）

限流：每 IP 每分钟 30 次。

### GET /api/data
拉取当前用户的云端数据快照。

支持 ETag 增量同步：请求头携带 `If-None-Match: <etag>`，若服务端数据未变化则返回 `304 Not Modified`（无 body），客户端跳过合并。

响应头包含 `ETag: "<sha1前16位>"`，供下次增量同步使用。

响应（数据有变化时）：
```json
{
  "ok": true,
  "data": {
    "store": { "currentId": "...", "projects": {...}, "unitTemplates": [...], "paperTemplates": [...], "tombstones": {...} },
    "updatedAt": "2026-10-03 10:00:00"
  }
}
```

无数据时：
```json
{ "ok": true, "data": { "store": null, "updatedAt": null } }
```

### PUT /api/data
推送本地数据到云端，服务端执行对称合并（不做全量覆盖），落库前清理 30 天以上墓碑。

请求体：
```json
{ "store": { "currentId": "...", "projects": {...}, ... } }
```

响应：
```json
{ "ok": true, "data": { "updatedAt": "2026-10-03 10:00:00", "projectCount": 3 } }
```

合并规则（LWW + 墓碑，非 CRDT/OT）：
- **tombstones**：按 id 取 max 墓碑值（删除标记对称合并，旧推送不能复活已删数据）
- **projects**：项目级 `updatedAt` LWW，以较新者为基底
- **records（打卡记录）**：按 `rid` 集合 union，按日期排序
- **items（背书条目/错题）**：按 `id` 集合 union；同 id 时字段级 LWW（updatedAt → reviews 长度 → 保留 base）
- **unitTemplates / paperTemplates**：按 id 集合 union（跳过 preset_ 内置模板）
- **currentId**：优先上传方有效 id，其次云端，最后第一个项目

---

## 四、管理员相关（/api/admin，需管理员权限）

### GET /api/admin/stats
获取系统概览统计（DAU、新增用户、留存率、存储使用量等）。

### GET /api/admin/system
系统监控（请求量、错误率、Node 内存、磁盘、数据库状态、指标滑窗）。

### GET /api/admin/audit-logs
管理员操作审计日志（仅超级管理员可查）。

支持分页参数 `page`、`pageSize`。

### GET /api/admin/users/export
导出用户列表（CSV 格式，静态路径，必须在 `/users/:id` 路由之前匹配）。

支持 `format=csv` 参数。

### GET /api/admin/users
用户列表（默认排除回收站软删除用户）。

查询参数：
- `q`：搜索关键词（用户名/邮箱）
- `status`：按状态筛选（active/disabled）
- `isAdmin`：是否仅管理员（1/0）
- `page`、`pageSize`：分页

### GET /api/admin/users/:id
用户详情。

### POST /api/admin/users/:id/reset-password
管理员重置用户密码为一次性临时密码（bcrypt 哈希，token_version 递增强制下线）。临时密码需用户登录后立即修改。

响应：
```json
{ "ok": true, "data": { "tempPassword": "临时密码", "message": "..." } }
```

### PUT /api/admin/users/:id/status
启用/封禁用户（支持临时封禁 ban_until，到期自动恢复 active）。

请求体：
```json
{ "status": "disabled", "banReason": "违规原因", "banUntil": "2026-10-10 00:00:00" }
```
或
```json
{ "status": "active" }
```

### PUT /api/admin/users/:id/admin
设置/取消管理员（仅超级管理员可操作）。

撤销管理员为敏感操作，要求请求体携带当前超级管理员密码做二次校验。

请求体：
```json
{ "makeAdmin": true }
```
或（撤销时）
```json
{ "makeAdmin": false, "password": "当前超级管理员密码" }
```

### DELETE /api/admin/users/:id
软删除用户（进入回收站，删除前导出用户数据，token_version 递增强制下线）。

### POST /api/admin/users/:id/restore
从回收站恢复用户（撤销软删除）。

### DELETE /api/admin/users/:id/permanent
物理删除用户（不可逆操作，要求先软删除，再请求体重输当前管理员密码二次校验）。

请求体：
```json
{ "password": "当前管理员密码" }
```

### POST /api/admin/invite/generate
生成邀请码。

请求体：
```json
{ "note": "备注", "channel": "渠道", "expiresAt": "2026-12-31 23:59:59" }
```

响应：
```json
{ "ok": true, "data": { "code": "ABCD1234" } }
```

### GET /api/admin/invite/list
邀请码列表（支持搜索、筛选、分页）。

### DELETE /api/admin/invite/:code
作废邀请码（软作废，revoked_at 标记，已使用码保留历史）。

---

## 五、公共接口

### GET /api/health
健康检查。

响应：
```json
{ "ok": true, "ts": 1790993766444 }
```

---

## 六、错误码

| HTTP 状态码 | 含义 |
|---|---|
| 400 | 请求参数错误 |
| 401 | 未登录或 token 失效（含 token_version 不匹配、软删除用户） |
| 403 | 无权限（非管理员、非超级管理员、账号被禁用、密码二次校验失败） |
| 404 | 资源不存在 |
| 413 | 数据超出大小限制（单用户 5MB 配额 / 请求体 10MB 限制） |
| 429 | 请求过于频繁（限流） |
| 500 | 服务器内部错误 |
