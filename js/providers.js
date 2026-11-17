/**
 * BiliSummary — 共享 AI 服务商预设
 *
 * Content script: 通过 window.BiliSummary.AI_PROVIDERS 读取
 * Service worker: 通过 importScripts 后读取 BS_AI_PROVIDERS
 *
 * 目前内置两个预设：
 *   - opencode-go：OpenCode Go 订阅套餐，仅提供 DeepSeek V4.1 Flash（默认配置）
 *   - custom：任意 OpenAI 兼容接口（Endpoint / API Key / 模型均由用户填写）
 */
const BS_AI_PROVIDERS = (function () {
  'use strict';

  const OPENCODE_GO = {
    id: 'opencode-go',
    label: 'OpenCode Go',
    title: 'OpenCode Go · DeepSeek V4.1 Flash',
    description: 'OpenCode Go 订阅套餐仅提供 DeepSeek V4.1 Flash；在 OpenCode Console 创建 API Key 后填入即可使用。',
    endpoint: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
    modelsUrl: 'https://opencode.ai/inference/go/v1/models',
    host: 'opencode.ai',
    model: 'deepseek-v4.1-flash',
    models: [
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
    ],
    lockEndpoint: true,   // Endpoint 由服务商固定
    lockModel: true,      // 套餐仅提供 DeepSeek V4.1 Flash
    sessionHeader: 'x-opencode-session', // OpenCode 要求的稳定会话标识，用于路由与缓存
    includeUsage: true,   // 请求最终 usage（含 Go 额度），用于展示用量
    keyUrl: 'https://opencode.ai/console',
    keyLabel: '获取 OpenCode API Key ↗',
    keyPlaceholder: 'OpenCode Console 中创建的 API Key',
  };

  const CUSTOM = {
    id: 'custom',
    label: '自定义接口（OpenAI 兼容）',
    title: '自定义接口',
    description: '兼容 OpenAI 协议的任意接口：官方 API、自建网关、本地 LLM 等。',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    modelsUrl: '',
    host: '',
    model: 'deepseek-v4-flash',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek-V3 (chat)' },
      { id: 'deepseek-reasoner', name: 'DeepSeek-R1 (reasoner)' },
    ],
    lockEndpoint: false,
    lockModel: false,
    sessionHeader: '',
    includeUsage: false,
    keyUrl: '',
    keyLabel: '',
    keyPlaceholder: 'sk-...',
  };

  const list = [OPENCODE_GO, CUSTOM];
  const byId = {};
  list.forEach(provider => { byId[provider.id] = provider; });

  const DEFAULT_ID = OPENCODE_GO.id;

  function normalizeEndpoint(endpoint) {
    return String(endpoint || '').trim().replace(/\/+$/, '');
  }

  function get(providerId) {
    return byId[providerId] || null;
  }

  /**
   * 根据 Endpoint 反推服务商（用于兼容未保存 provider 的旧配置）
   */
  function matchByEndpoint(endpoint) {
    const ep = normalizeEndpoint(endpoint);
    if (!ep) return null;
    for (const provider of list) {
      if (!provider.host) continue;
      try {
        const url = new URL(ep);
        if (url.hostname === provider.host && ep.toLowerCase().includes('/inference/go/')) {
          return provider;
        }
      } catch {
        if (ep.toLowerCase().includes(provider.host)) return provider;
      }
    }
    return null;
  }

  /**
   * 解析当前生效的服务商：
   * 1) 显式 provider id；
   * 2) 旧配置按 Endpoint 反推；
   * 3) 兜底为自定义接口（保证旧配置行为不变）
   */
  function resolve(providerId, endpoint) {
    return get(providerId) || matchByEndpoint(endpoint) || CUSTOM;
  }

  /**
   * 把用户可能填写的各种 OpenCode 地址补全为 chat/completions
   */
  function resolveChatUrl(endpoint, provider) {
    const ep = normalizeEndpoint(endpoint);
    if (!ep) return provider.endpoint || '';
    if (!provider || provider.id !== OPENCODE_GO.id) return ep;
    let url;
    try {
      url = new URL(ep);
    } catch {
      return ep;
    }
    if (url.hostname !== OPENCODE_GO.host) return ep;
    const path = url.pathname.replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(path)) return ep;
    if (path === '' || path === '/' || /\/inference\/go(\/openai(\/v1)?)?$/.test(path)) {
      return OPENCODE_GO.endpoint;
    }
    return ep;
  }

  function createSessionId() {
    let uuid = '';
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        uuid = crypto.randomUUID();
      }
    } catch {}
    if (!uuid) {
      uuid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
    return `bilisummary-${uuid}`;
  }

  /**
   * 构造 OpenAI 兼容请求（headers + payload）
   * OpenCode Go 会额外带上会话头与 usage 统计开关。
   */
  function buildChatRequest(options) {
    const opts = options || {};
    const provider = resolve(opts.providerId, opts.endpoint);
    const url = resolveChatUrl(opts.endpoint, provider);
    const apiKey = String(opts.apiKey || '').trim();
    const stream = opts.stream !== false;
    const model = String(opts.model || '').trim() || provider.model;

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const payload = {
      model,
      messages: Array.isArray(opts.messages) ? opts.messages : [],
      stream,
    };

    if (provider.sessionHeader) {
      headers[provider.sessionHeader] = opts.sessionId || createSessionId();
    }
    if (provider.includeUsage && stream) {
      // OpenAI 规范：流式时通过最后一个 usage chunk 返回计费信息
      payload.stream_options = { include_usage: true };
    }

    return { url, headers, payload, provider };
  }

  /**
   * 模型列表候选地址：优先服务商固定地址，其次按 OpenAI 常见路径推导
   */
  function modelListUrls(endpoint, providerId) {
    const provider = resolve(providerId, endpoint);
    const urls = [];
    if (provider.modelsUrl) urls.push(provider.modelsUrl);

    const chatUrl = resolveChatUrl(endpoint, provider);
    const base = normalizeEndpoint(chatUrl).replace(/\/chat\/completions$/, '').replace(/\/+$/, '');
    if (base) {
      urls.push(`${base}/models`);
      const gateway = base.match(/^(.*)\/(openai|anthropic|google)(\/v\d+[a-z0-9]*)?$/i);
      if (gateway) {
        urls.push(`${gateway[1]}/v1/models`);
        urls.push(`${gateway[1]}/models`);
      }
      urls.push(`${base}/v1/models`);
    }
    return urls.filter((url, index) => url && urls.indexOf(url) === index);
  }

  /**
   * 归一化 usage（含 OpenCode 的计费字段）
   */
  function parseUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const opencode = (usage.opencode && typeof usage.opencode === 'object') ? usage.opencode : {};
    const tokens = (opencode.tokens && typeof opencode.tokens === 'object') ? opencode.tokens : {};
    const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    return {
      inputTokens: num(usage.prompt_tokens),
      outputTokens: num(usage.completion_tokens),
      cost: num(usage.cost),
      listCost: num(opencode.list_cost),
      allowance: num(opencode.allowance),
      billingSource: typeof opencode.billing_source === 'string' ? opencode.billing_source : '',
      cacheRead: num(tokens.cache_read),
    };
  }

  function isGoBilling(billingSource) {
    return billingSource === 'go' || billingSource === 'go-plus' || billingSource === 'go-teams';
  }

  /**
   * 默认 AI 接口配置（OpenCode Go + DeepSeek V4.1 Flash）
   */
  function defaultApiConfig() {
    return {
      provider: OPENCODE_GO.id,
      endpoint: OPENCODE_GO.endpoint,
      apiKey: '',
      model: OPENCODE_GO.model,
      stream: true,
    };
  }

  return {
    DEFAULT_ID,
    list,
    get,
    matchByEndpoint,
    resolve,
    resolveChatUrl,
    buildChatRequest,
    modelListUrls,
    createSessionId,
    normalizeEndpoint,
    parseUsage,
    isGoBilling,
    defaultApiConfig,
    OPENCODE_GO,
    CUSTOM,
  };
})();

if (typeof window !== 'undefined') {
  window.BiliSummary = window.BiliSummary || {};
  window.BiliSummary.AI_PROVIDERS = BS_AI_PROVIDERS;
}
if (typeof globalThis !== 'undefined') {
  globalThis.BS_AI_PROVIDERS = BS_AI_PROVIDERS;
}
