/**
 * utils/aiCrypto.js — AI API Key 的 AES-256-GCM 加解密
 *
 * 设计（PRD §12.2）：
 *   - 主密钥不硬编码，从服务端 JWT_SECRET 经 crypto.scrypt 派生；
 *   - 每用户专属随机 12 字节 salt（base64 存于 ai_configs.key_salt），
 *     即便密文泄露也无法跨用户复用；
 *   - 每条密文格式：`iv:tag:cipher`，三段均为 base64；
 *   - 前端任何接口都拿不到明文 key，后端仅在代理转发上游时于内存中解密即用。
 *
 * 用法：
 *   const salt = generateSalt();            // 新建配置时生成并落库
 *   const enc  = encrypt(plainKey, salt);  // 存 ai_configs.encrypted_api_key
 *   const key  = decrypt(enc, salt);        // 调上游前解密
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;   // AES-256
const IV_LEN = 16;    // GCM 推荐 12–16 字节
const SALT_LEN = 12;  // 每用户随机 salt 长度

/**
 * 从 JWT_SECRET + 用户 salt 派生 32 字节对称密钥。
 * scryptSync 是确定性且足够快（每用户每请求派生一次，可接受）。
 * @param {string} saltB64 每用户 salt（base64）
 * @returns {Buffer} 32 字节密钥
 */
function deriveKey(saltB64) {
  const secret = process.env.JWT_SECRET || '';
  const salt = Buffer.from(saltB64 || '', 'base64');
  // scrypt 参数：N=16384, r=8, p=1（OWASP 常用量级）
  return crypto.scryptSync(secret, salt, KEY_LEN, { N: 16384, r: 8, p: 1 });
}

/** 生成一个新的每用户 salt（base64 字符串，12 字节） */
function generateSalt() {
  return crypto.randomBytes(SALT_LEN).toString('base64');
}

/**
 * 加密明文（API key）。
 * @param {string} plaintext 明文 key
 * @param {string} saltB64 每用户 salt（base64）
 * @returns {string} `iv:tag:cipher` 三段 base64
 */
function encrypt(plaintext, saltB64) {
  if (plaintext == null || plaintext === '') return '';
  const key = deriveKey(saltB64);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/**
 * 解密 `iv:tag:cipher` 格式的密文。
 * @param {string} encoded encrypt() 产出的字符串
 * @param {string} saltB64 每用户 salt（base64，需与加密时一致）
 * @returns {string} 明文
 * @throws 密文被篡改 / salt 不匹配时抛错（由调用方捕获，统一返回上游错误）
 */
function decrypt(encoded, saltB64) {
  if (!encoded || typeof encoded !== 'string') return '';
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('bad cipher format');
  const key = deriveKey(saltB64);
  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const data = Buffer.from(parts[2], 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

/**
 * 生成 key 回显预览：前 4 + 后 4，中间打码。
 * 例：sk-abcdef123456 → abcd...3456
 */
function previewOf(plaintext) {
  const s = String(plaintext || '').trim();
  if (!s) return '';
  if (s.length <= 8) return '****' + s.slice(-2);
  return s.slice(0, 4) + '...' + s.slice(-4);
}

module.exports = { encrypt, decrypt, generateSalt, previewOf };
