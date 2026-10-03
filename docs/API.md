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

## 认证相关

### POST /api/auth/request-code
发送邮箱验证码（注册或重置密码时使用）。

请求体：
```json
{ "email": "user@example.com", "purpose": "register" }
```
- `purpose`: `register`（注册）或 `reset`（重置密码）

响应：
```json
{ "ok": true, "message": "验证码已发送" }
```

### POST /api/auth/register
注册新用户。

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
{ "ok": true, "token": "jwt_token", "user": { "id": 1, "username": "...", "email": "..." } }
```

### POST /api/auth/login
登录。

请求体：
```json
{ "email": "user@example.com", "password": "密码" }
```

响应：
```json
{ "ok": true, "token": "jwt_token", "user": { "id": 1, "username": "...", "email": "..." } }
```

### POST /api/auth/reset-password
重置密码。

请求体：
```json
{ "email": "user@example.com", "code": "123456", "newPassword": "新密码" }
```

## 用户相关（需登录）

以下接口需在请求头携带 `Authorization: Bearer <token>`。

### GET /api/user/profile
获取当前用户信息。

### PUT /api/user/profile
更新用户信息（用户名等）。

### POST /api/user/change-password
修改密码。

请求体：
```json
{ "oldPassword": "旧密码", "newPassword": "新密码" }
```

### POST /api/user/logout
登出（使当前 token 失效）。

### DELETE /api/user/account
注销账号（PIPL 第47条，需二次确认）。

## 数据同步（需登录）

### GET /api/data
拉取当前用户的云端数据快照。

支持 ETag 增量同步：请求头携带 `If-None-Match: <etag>`，若服务端数据未变化则返回 `304 Not Modified`。

响应（数据有变化时）：
```json
{
  "ok": true,
  "data": {
    "store": { "currentId": "...", "projects": {...}, ... },
    "updatedAt": "2026-10-03 10:00:00"
  }
}
```

响应头包含 `ETag: "<hash>"`，供下次增量同步使用。

### PUT /api/data
推送本地数据到云端，服务端执行对称合并。

请求体：
```json
{ "store": { "currentId": "...", "projects": {...}, ... } }
```

响应：
```json
{ "ok": true, "data": { "updatedAt": "2026-10-03 10:00:00", "projectCount": 3 } }
```

合并规则：
- 墓碑（tombstones）取并集，30天前的自动清理
- 项目按 `updatedAt` 取最新
- 记录按 `rid` 去重
- 条目字段按 `updatedAt` LWW（最后写入胜）

## 管理员相关（需管理员权限）

### GET /api/admin/overview
获取系统概览统计（DAU、新增用户、留存、存储使用等）。

### GET /api/admin/users
用户列表（支持搜索、筛选、分页）。

### PUT /api/admin/users/:id
修改用户状态（启用/禁用、重置密码等）。

### DELETE /api/admin/users/:id
删除用户（软删除，进入回收站）。

### PUT /api/admin/users/:id/admin
授予或撤销管理员权限（仅超级管理员可操作）。

### GET /api/admin/invite-codes
邀请码列表。

### POST /api/admin/invite-codes
生成邀请码。

### DELETE /api/admin/invite-codes/:id
作废邀请码。

### GET /api/admin/audit-logs
审计日志（仅超级管理员可查）。

### GET /api/admin/system
系统监控（请求量、错误率、Node/内存/磁盘/数据库状态）。

## 公共接口

### GET /api/health
健康检查。

响应：
```json
{ "ok": true, "ts": 1790993766444 }
```

## 错误码

| HTTP 状态码 | 含义 |
|---|---|
| 400 | 请求参数错误 |
| 401 | 未登录或 token 失效 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 413 | 数据超出大小限制 |
| 429 | 请求过于频繁（限流） |
| 500 | 服务器内部错误 |
