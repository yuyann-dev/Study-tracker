/**
 * utils/aiProviders.js — 服务商注册表（OpenAI 兼容接口，最终版）
 *
 * 5 家服务商，每家带可选模型列表。用户在前端选好服务商 + 具体模型，
 * 后端原样存 model 并按 provider.baseUrl 调用，不做任何自动切换。
 */

const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-flash', recommended: false },
      { id: 'deepseek-v4-pro', recommended: true },
    ],
    docsUrl: 'https://platform.deepseek.com/',
  },
  zhipu: {
    name: '智谱AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-4-flash', recommended: false },
      { id: 'glm-4-air', recommended: true },
    ],
    docsUrl: 'https://open.bigmodel.cn/',
  },
  dashscope: {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen-turbo', recommended: false },
      { id: 'qwen-plus', recommended: true },
    ],
    docsUrl: 'https://dashscope.console.aliyun.com/',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o-mini', recommended: false },
      { id: 'gpt-4o', recommended: true },
    ],
    docsUrl: 'https://platform.openai.com/',
  },
  kimi: {
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'kimi-k2-thinking', recommended: true },
    ],
    docsUrl: 'https://platform.moonshot.cn/',
  },
};

const DEFAULT_PROVIDER = 'deepseek';

/** 取服务商配置（未知返回 null），带 key 字段 */
function getProvider(provider) {
  const key = String(provider || DEFAULT_PROVIDER).toLowerCase();
  return PROVIDERS[key] ? Object.assign({ key }, PROVIDERS[key]) : null;
}

/** 列出全部服务商（含 models 列表，供前端渲染下拉与模型选择） */
function listProviders() {
  return Object.entries(PROVIDERS).map(([key, p]) => ({
    key, name: p.name, models: p.models,
  }));
}

/** 校验某 model 是否属于该服务商的模型列表 */
function modelBelongsTo(provider, model) {
  const p = getProvider(provider);
  if (!p || !Array.isArray(p.models)) return false;
  return p.models.some((m) => m.id === model);
}

module.exports = { PROVIDERS, DEFAULT_PROVIDER, getProvider, listProviders, modelBelongsTo };
