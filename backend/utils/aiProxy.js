/**
 * utils/aiProxy.js — 代理调用用户自供的 OpenAI 兼容接口（PRD §12.2/§12.3）
 *
 *  - POST {baseUrl}/chat/completions，Header Authorization: Bearer {apiKey}
 *  - 30s 超时（AbortController）；401/429/5xx 分别归类错误
 *  - SSRF 防护：baseUrl 必须 https；解析后 IP 不得是内网段
 *    （127/8, 10/8, 172.16/12, 192.168/16, 169.25/16）
 *
 * callLLM 返回 { content, usage:{prompt_tokens, completion_tokens} }；
 * 失败抛带 .status / .kind 的错误，由路由统一转成 502 文案。
 */
const dns = require('dns').promises;

const TIMEOUT_MS = 30 * 1000;

/**
 * 判断 IPv4 是否属于内网 / 保留段。
 */
function isPrivateIpv4(ip) {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o[0] === 127) return true;            // 127.0.0.0/8
  if (o[0] === 10) return true;              // 10.0.0.0/8
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16/12
  if (o[0] === 192 && o[1] === 168) return true;             // 192.168/16
  if (o[0] === 169 && o[1] === 254) return true;             // 169.25/16
  if (o[0] === 0) return true;                                // 0.0.0.0/8
  return false;
}

function isPrivateIp(ip) {
  if (!ip) return true;
  // IPv6 本地/链路
  if (/:/.test(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80')) return true;
    return false;
  }
  return isPrivateIpv4(ip);
}

/**
 * 校验 baseUrl：协议必须 https，解析主机 IP 不得是内网。
 * 在真正发请求前调用，防借服务器打内网。
 * @throws {{kind:'ssrf', message}}
 */
async function assertSafeBaseUrl(baseUrl) {
  let u;
  try {
    u = new URL(baseUrl);
  } catch (e) {
    const err = new Error('baseUrl 格式不合法');
    err.kind = 'bad_url';
    throw err;
  }
  if (u.protocol !== 'https:') {
    const err = new Error('baseUrl 必须使用 https');
    err.kind = 'bad_url';
    throw err;
  }
  const host = u.hostname;
  // 字面量 IP 直接判
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || /:/.test(host)) {
    if (isPrivateIp(host)) {
      const err = new Error('baseUrl 指向内网地址，已拦截');
      err.kind = 'ssrf';
      throw err;
    }
    return;
  }
  // 域名：解析所有 A/AAAA 记录，任一为内网即拒
  try {
    const addrs = await dns.lookup(host, { all: true });
    for (const a of addrs) {
      if (isPrivateIp(a.address)) {
        const err = new Error('baseUrl 解析到内网地址，已拦截');
        err.kind = 'ssrf';
        throw err;
      }
    }
  } catch (e) {
    const err = new Error('baseUrl 域名解析失败');
    err.kind = 'dns';
    throw err;
  }
}

/**
 * 调用 OpenAI 兼容 chat/completions。
 * @param {{baseUrl:string, model:string, apiKey:string}} cfg 已解密的配置
 * @param {Array<{role:string,content:string}>} messages
 * @param {object} [opts] { temperature?, maxTokens? }
 * @returns {Promise<{content:string, usage:{prompt_tokens:number, completion_tokens:number}}>}
 */
async function callLLM(cfg, messages, opts = {}) {
  const baseUrl = String(cfg.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl || !cfg.model || !cfg.apiKey) {
    const err = new Error('AI 配置不完整');
    err.kind = 'bad_config';
    throw err;
  }
  await assertSafeBaseUrl(baseUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      const err = new Error('AI开小差了，请稍后再试');
      err.kind = 'timeout'; err.status = 504;
      err.aiCode = 'TIMEOUT'; err.aiMessage = 'AI开小差了，请稍后再试';
      throw err;
    }
    const err = new Error('AI服务暂时不可用，请稍后再试');
    err.kind = 'network'; err.status = 502;
    err.aiCode = 'UPSTREAM_ERROR'; err.aiMessage = 'AI服务暂时不可用，请稍后再试';
    throw err;
  }
  clearTimeout(timer);

  // 错误分类：统一不把上游原文抛给用户；每个错误带 aiCode（前端据此显示友好提示/重试按钮）
  if (!res.ok) {
    const err = new Error('AI服务暂时不可用，请稍后再试');
    err.status = 502;
    err.aiCode = 'UPSTREAM_ERROR';
    err.aiMessage = 'AI服务暂时不可用，请稍后再试';
    if (res.status === 401 || res.status === 403) {
      err.kind = 'unauthorized'; err.status = 401;
      err.aiCode = 'INVALID_KEY'; err.aiMessage = 'API key似乎无效，请检查后重新输入';
    } else if (res.status === 402) {
      err.kind = 'insufficient_balance'; err.status = 402;
      err.aiCode = 'INSUFFICIENT_BALANCE';
      err.aiMessage = 'AI服务余额不足，请前往服务商控制台充值后继续使用';
      err.aiDetail = cfg.docsUrl || 'https://platform.deepseek.com/';
    } else if (res.status === 429) {
      err.kind = 'rate_limited'; err.status = 429;
      err.aiCode = 'RATE_LIMITED'; err.aiMessage = '问得太快啦，歇一秒再问';
    } else if (res.status >= 500) {
      err.kind = 'upstream_5xx'; err.status = 502;
      err.aiCode = 'UPSTREAM_ERROR'; err.aiMessage = 'AI服务暂时不可用，请稍后再试';
    }
    throw err;
  }

  let data;
  try { data = await res.json(); }
  catch (e) {
    const err = new Error('AI服务暂时不可用，请稍后再试');
    err.kind = 'bad_json'; err.status = 502;
    err.aiCode = 'UPSTREAM_ERROR'; err.aiMessage = 'AI服务暂时不可用，请稍后再试';
    throw err;
  }

  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : '';
  const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0 };
  return {
    content: typeof content === 'string' ? content : JSON.stringify(content || ''),
    usage: {
      prompt_tokens: Number(usage.prompt_tokens) || 0,
      completion_tokens: Number(usage.completion_tokens) || 0,
    },
  };
}

module.exports = { callLLM, assertSafeBaseUrl, isPrivateIp };
