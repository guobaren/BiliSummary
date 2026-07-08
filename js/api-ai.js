// js/api-ai.js - 通用 OpenAI 兼容 API 通道
// 调用路径：content script -> chrome.runtime.sendMessage -> background(fetch) -> content -> panel
(function () {
  'use strict';

  const BN = window.BiliSummary;
  if (!BN) return;

  // 内置模型清单（只是给 UI 提供默认值，用户可手动输入任意模型 ID）
  const BUILTIN_MODELS = {
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
  const listeners = { chunk: [], state: [], done: [], error: [] };
  let state = 'idle';          // idle | sending | responding | done | error
  let activeRequestId = null;
  let activeChatId = null;     // 一段对话的唯一 id（复用 chat_session 语义；API 通道每轮重新赋值）

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

  // 通过 background fetch 走，绕过 content_scripts 的 CORS 限制
  function callBackground(requestId) {
    return new Promise((resolve, reject) => {
      const onMsg = (msg) => {
        if (!msg || msg.requestId !== requestId) return;
        if (msg.type === 'api-chunk') {
          emit('chunk', { type: msg.role === 'think' ? 'think' : 'response', text: msg.text });
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
    const requestId = crypto.randomUUID();
    activeRequestId = requestId;
    setState('sending');

    chrome.runtime.sendMessage({
      type: 'api-send',
      messages,
      requestId,
      stream: opts.stream !== false,
      endpoint: opts.endpoint || '',
      apiKey: opts.apiKey || '',
      model: opts.model || '',
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
    setState('idle');
  }

  /**
   * 从指定 endpoint/apiKey 获取可用模型列表（走 background fetch）
   */
  function fetchModels(endpoint, apiKey) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get('bilisummary_api_cfg', (stored) => {
        const cfg = stored.bilisummary_api_cfg || {};
        const merged = {
          endpoint: endpoint || cfg.endpoint || 'https://api.deepseek.com/v1/chat/completions',
          apiKey: apiKey || cfg.apiKey || '',
        };
        chrome.runtime.sendMessage({ type: 'api-fetch-models', endpoint: merged.endpoint, apiKey: merged.apiKey }, (resp) => {
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
    getState: () => state,
    onChunk: (fn) => listeners.chunk.push(fn),
    onStateChange: (fn) => listeners.state.push(fn),
    onDone: (fn) => listeners.done.push(fn),
    onError: (fn) => listeners.error.push(fn),
    BUILTIN_MODELS,
  };
})();
