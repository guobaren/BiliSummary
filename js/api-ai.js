// js/api-ai.js - 通用 OpenAI 兼容 API 通道
// 调用路径：content script -> chrome.runtime.sendMessage -> background(fetch) -> content -> panel
// 默认服务商为 OpenCode Go（仅提供 DeepSeek V4.1 Flash）
(function () {
  'use strict';

  const BN = window.BiliSummary;
  if (!BN) return;

  const PROVIDERS = BN.AI_PROVIDERS || null;

  // 内置模型清单（只是给 UI 提供默认值，用户可手动输入任意模型 ID）
  const BUILTIN_MODELS = {
    'deepseek-v4.1-flash':    { provider: 'OpenCode Go', name: 'DeepSeek V4.1 Flash' },
    'deepseek-chat':          { provider: 'DeepSeek', name: 'DeepSeek-V3 (chat)' },
    'deepseek-reasoner':      { provider: 'DeepSeek', name: 'DeepSeek-R1 (reasoner)' },
    'gpt-4o':                 { provider: 'OpenAI',   name: 'GPT-4o' },
    'gpt-4o-mini':            { provider: 'OpenAI',   name: 'GPT-4o mini' },
    'gpt-3.5-turbo':          { provider: 'OpenAI',   name: 'GPT-3.5 Turbo' },
    'claude-3-5-sonnet-20241022': { provider: 'Anthropic', name: 'Claude 3.5 Sonnet' },
    'claude-3-opus-20240229': { provider: 'Anthropic', name: 'Claude 3 Opus' },
    'gemini-1.5-pro':         { provider: 'Google',   name: 'Gemini 1.5 Pro' },
    'qwen-plus':              { provider: 'Qwen',     name: 'Qwen Plus' },
    'glm-4-plus':             { provider: 'GLM',      name: 'GLM-4 Plus' },
  };

  // 拿到用户所有后续消息对应的纯文本（由 panel 在调用前拼好）
  // 这里只负责把一组 messages 流式发给 API，并透过事件通知 chat UI
  const listeners = { chunk: [], state: [], done: [], error: [], usage: [] };
  let state = 'idle';          // idle | sending | responding | done | error
  let activeRequestId = null;
  let activeChatId = null;     // 一段对话的唯一 id（当前用作 OpenCode 会话标识）
  let lastSessionId = '';

  function emit(event, data) {
    for (const fn of listeners[event]) {
      try { fn(data); } catch (e) { console.error('[BN-API-AI]', e); }
    }
  }

  function setState(s) {
    if (state === s) return;
    state = s;
    emit('state', s);
  }

  /**
   * 新建一段对话的会话 ID（OpenCode Go 通过 x-opencode-session 做路由与缓存）
   */
  function newSession() {
    lastSessionId = PROVIDERS
      ? PROVIDERS.createSessionId()
      : `bilisummary-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    activeChatId = lastSessionId;
    return lastSessionId;
  }

  function getSessionId() {
    return lastSessionId || newSession();
  }

  // 通过 background fetch 走，绕过 content_scripts 的 CORS 限制
  function callBackground(requestId) {
    return new Promise((resolve, reject) => {
      const onMsg = (msg) => {
        if (!msg || msg.requestId !== requestId) return;
        if (msg.type === 'api-chunk') {
          emit('chunk', { type: msg.role === 'think' ? 'think' : 'response', text: msg.text });
        } else if (msg.type === 'api-usage') {
          emit('usage', msg.usage);
        } else if (msg.type === 'api-done') {
          cleanup(); resolve();
        } else if (msg.type === 'api-error') {
          cleanup(); reject(new Error(msg.error));
        }
      };
      function cleanup() {
        chrome.runtime.onMessage.removeListener(onMsg);
      }
      chrome.runtime.onMessage.addListener(onMsg);
    });
  }

  /**
   * 发送一组 messages（已含 system + 历史 + 最新 user）给 API 通道
   * 通过 background.js 代理请求，绕过 CORS
   */
  async function sendToApi(messages, opts = {}) {
    if (state === 'sending' || state === 'responding') return;
    const requestId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    activeRequestId = requestId;
    setState('sending');

    chrome.runtime.sendMessage({
      type: 'api-send',
      messages,
      requestId,
      provider: opts.provider || (PROVIDERS ? PROVIDERS.DEFAULT_ID : 'opencode-go'),
      stream: opts.stream !== false,
      endpoint: opts.endpoint || '',
      apiKey: opts.apiKey || '',
      model: opts.model || '',
      sessionId: opts.sessionId || getSessionId(),
    });

    try {
      await callBackground(requestId);
      setState('done');
      emit('done', { ok: true });
    } catch (err) {
      emit('error', err.message || String(err));
      setState('error');
    }
  }

  // 终止接口：发送 api-abort 消息终止 background fetch
  function abort() {
    if (activeRequestId) {
      chrome.runtime.sendMessage({ type: 'api-abort', requestId: activeRequestId });
    }
    activeRequestId = null;
    setState('idle');
  }

  function clear() {
    activeRequestId = null;
    activeChatId = null;
    lastSessionId = '';
    setState('idle');
  }

  /**
   * 从指定 endpoint/apiKey 获取可用模型列表（走 background fetch）
   */
  function fetchModels(endpoint, apiKey, providerId) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get('bilisummary_settings', (stored) => {
        const settings = (stored && stored.bilisummary_settings) || {};
        const cfg = settings.apiCfg || {};
        const provider = providerId || settings.apiProvider || cfg.provider || (PROVIDERS ? PROVIDERS.DEFAULT_ID : '');
        const defaultEndpoint = PROVIDERS ? PROVIDERS.resolve(provider, cfg.endpoint).endpoint : 'https://api.deepseek.com/v1/chat/completions';
        const merged = {
          endpoint: endpoint || cfg.endpoint || defaultEndpoint,
          apiKey: apiKey || cfg.apiKey || '',
        };
        chrome.runtime.sendMessage({
          type: 'api-fetch-models',
          endpoint: merged.endpoint,
          apiKey: merged.apiKey,
          provider,
        }, (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (resp?.ok) resolve(resp.models || []);
          else reject(new Error(resp?.error || '获取失败'));
        });
      });
    });
  }

  BN.apiAI = {
    sendToApi,
    abort,
    clear,
    fetchModels,
    newSession,
    getSessionId,
    getState: () => state,
    getChatId: () => activeChatId,
    onChunk: (fn) => listeners.chunk.push(fn),
    onStateChange: (fn) => listeners.state.push(fn),
    onDone: (fn) => listeners.done.push(fn),
    onError: (fn) => listeners.error.push(fn),
    onUsage: (fn) => listeners.usage.push(fn),
    BUILTIN_MODELS,
    PROVIDERS,
  };
})();
