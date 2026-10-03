/**
 * utils/respond.js — 统一响应格式
 *
 * 所有 API 返回 { ok: true, ... } 或 { ok: false, error: "消息" }。
 * 路由里只调用 ok()/fail()，不要手写 res.json，避免格式不一致。
 */

/**
 * 成功响应
 * @param {import('express').Response} res
 * @param {object} extra 附加字段（如 token/user/codes/store）
 * @param {number} status HTTP 状态码，默认 200
 */
function ok(res, extra = {}, status = 200) {
  return res.status(status).json(Object.assign({ ok: true }, extra));
}

/**
 * 失败响应
 * @param {import('express').Response} res
 * @param {string} message 面向用户的错误描述
 * @param {number} status HTTP 状态码，默认 400
 */
function fail(res, message = '请求失败', status = 400) {
  return res.status(status).json({ ok: false, error: message });
}

module.exports = { ok, fail };
