/**
 * BiliSummary Settings Module
 * 读写 chrome.storage.local，管理设置项
 */
(function () {
  'use strict';

  window.BiliSummary = window.BiliSummary || {};

  // 默认 AI 接口：OpenCode Go 套餐（仅提供 DeepSeek V4.1 Flash）
  const API_FALLBACK = {
    provider: 'opencode-go',
    endpoint: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
    apiKey: '',
    model: 'deepseek-v4.1-flash',
    stream: true,
  };
  const DEFAULT_API_CFG = window.BiliSummary.AI_PROVIDERS
    ? window.BiliSummary.AI_PROVIDERS.defaultApiConfig()
    : { ...API_FALLBACK };

  const DEFAULTS = {
    fontSize: 'default',
    lineHeight: 'standard',
    autoScroll: true,
    darkMode: false,
    subtitleLang: '',
    deepseekPrompt: window.BiliSummary.DEFAULT_PROMPT,
    aiChannel: 'api',       // 'browser' | 'api'（默认走 OpenCode Go API 通道）
    aiMode: 'fast',         // 'fast' | 'expert'
    floatIconEnabled: true, // 浮动图标常驻
    autoSummary: true,      // 打开面板后自动开始总结
    apiProvider: DEFAULT_API_CFG.provider, // 'opencode-go' | 'custom'
    apiKeys: {},            // 按服务商保存的 API Key，切换服务商时避免互相串用
    apiCfg: { ...DEFAULT_API_CFG },
  };

  /**
   * 解析配置对应的服务商：
   * - 显式保存了 provider → 以它为准；
   * - 旧版本只保存了 Endpoint → 按 Endpoint 反推，无法识别时视为「自定义接口」，保持原行为；
   * - 全新安装（没有任何 API 配置）→ 使用默认预设 OpenCode Go。
   */
  function resolveProvider(providers, saved) {
    const rawCfg = (saved && typeof saved.apiCfg === 'object') ? saved.apiCfg : null;
    const explicitId = (saved && saved.apiProvider) || (rawCfg && rawCfg.provider) || '';
    if (explicitId) {
      return providers.get(explicitId) || providers.matchByEndpoint(rawCfg && rawCfg.endpoint) || providers.CUSTOM;
    }
    if (rawCfg && (rawCfg.endpoint || rawCfg.model)) {
      return providers.matchByEndpoint(rawCfg.endpoint) || providers.CUSTOM;
    }
    return providers.get(DEFAULTS.apiProvider) || providers.OPENCODE_GO;
  }

  /**
   * 归一化 API 配置：
   * - OpenCode Go 预设固定 Endpoint 与模型，避免出现套餐不支持的组合；
   * - 旧配置的 Endpoint / 模型 / API Key 原样保留。
   */
  function normalizeApiSettings(settings, savedSettings) {
    const providers = window.BiliSummary.AI_PROVIDERS;
    const saved = (savedSettings && typeof savedSettings.apiCfg === 'object') ? savedSettings.apiCfg : null;

    if (!providers) {
      const merged = { ...DEFAULT_API_CFG, ...(saved || {}) };
      settings.apiProvider = settings.apiProvider || merged.provider || 'custom';
      settings.apiCfg = merged;
      return;
    }

    const provider = resolveProvider(providers, savedSettings);
    const merged = {
      ...providers.defaultApiConfig(),
      ...(saved || {}),
      provider: provider.id,
    };

    if (provider.lockEndpoint || !merged.endpoint) merged.endpoint = provider.endpoint;
    if (provider.lockModel || !merged.model) merged.model = provider.model;
    if (merged.stream === undefined) merged.stream = true;

    // 每个服务商各存一份 API Key：切换服务商时不会把上一个服务商的 Key 发给新服务商
    const keyMap = (settings.apiKeys && typeof settings.apiKeys === 'object') ? { ...settings.apiKeys } : {};
    if (merged.apiKey) keyMap[provider.id] = merged.apiKey;
    settings.apiKeys = keyMap;
    settings.apiProvider = provider.id;
    settings.apiCfg = merged;
  }

  async function load() {
    return new Promise(resolve => {
      chrome.storage.local.get(['bilisummary_settings'], result => {
        if (chrome.runtime.lastError) {
          console.warn('[BiliSummary] Storage load error:', chrome.runtime.lastError);
          const fresh = { ...DEFAULTS, apiCfg: { ...DEFAULTS.apiCfg } };
          normalizeApiSettings(fresh, null);
          Object.assign(window.BiliSummary.state.settings, fresh);
          resolve(window.BiliSummary.state.settings);
          return;
        }
        const saved = result.bilisummary_settings || {};
        const merged = { ...DEFAULTS, ...saved, apiCfg: { ...DEFAULTS.apiCfg } };
        // 特殊处理 deepseekPrompt：如果 storage 里存的是空字符串（老版本遗留），
        // 说明用户未自定义，应恢复为默认提示词
        if (!saved.deepseekPrompt) {
          merged.deepseekPrompt = DEFAULTS.deepseekPrompt;
        }
        normalizeApiSettings(merged, saved);
        Object.assign(window.BiliSummary.state.settings, merged);
        resolve(window.BiliSummary.state.settings);
      });
    });
  }

  async function save() {
    return new Promise(resolve => {
      const settings = window.BiliSummary.state.settings;
      chrome.storage.local.set({
        bilisummary_settings: { ...settings },
      }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[BiliSummary] Storage save error:', chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  function resetDefaults() {
    const s = window.BiliSummary.state.settings;
    // 保留提示词与 API Key，其余恢复默认（含默认 OpenCode Go 预设）
    const preserved = {
      deepseekPrompt: s.deepseekPrompt,
      apiKeys: (s.apiKeys && typeof s.apiKeys === 'object') ? { ...s.apiKeys } : {},
    };
    Object.assign(s, { ...DEFAULTS }, { deepseekPrompt: preserved.deepseekPrompt });
    s.apiProvider = DEFAULTS.apiProvider;
    s.apiKeys = preserved.apiKeys;
    s.apiCfg = { ...DEFAULTS.apiCfg, apiKey: preserved.apiKeys[DEFAULTS.apiProvider] || '' };
    save();
  }

  window.BiliSummary.settings = {
    load,
    save,
    resetDefaults,
    DEFAULTS: { ...DEFAULTS, apiCfg: { ...DEFAULTS.apiCfg } }
  };
})();
