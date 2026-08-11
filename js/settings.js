/**
 * BiliSummary Settings Module
 * 读写 chrome.storage.local，管理设置项
 */
(function () {
  'use strict';

  window.BiliSummary = window.BiliSummary || {};

  const DEFAULTS = {
    fontSize: 'default',
    lineHeight: 'standard',
    autoScroll: true,
    darkMode: false,
    subtitleLang: '',
    deepseekPrompt: window.BiliSummary.DEFAULT_PROMPT,
    aiChannel: 'browser',   // 'browser' | 'api'
    aiMode: 'fast',         // 'fast' | 'expert'
    floatIconEnabled: true, // 浮动图标常驻
    autoSummary: true,      // 打开面板后自动开始总结
    apiCfg: {
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      apiKey: '',
      model: 'deepseek-v4-flash',
      stream: true,
    },
  };

  async function load() {
    return new Promise(resolve => {
      chrome.storage.local.get(['bilisummary_settings'], result => {
        if (chrome.runtime.lastError) {
          console.warn('[BiliSummary] Storage load error:', chrome.runtime.lastError);
          resolve({ ...DEFAULTS });
          return;
        }
        const saved = result.bilisummary_settings || {};
        Object.assign(window.BiliSummary.state.settings, { ...DEFAULTS, ...saved });
        // 特殊处理 deepseekPrompt：如果 storage 里存的是空字符串（老版本遗留），
        // 说明用户未自定义，应恢复为默认提示词
        if (!saved.deepseekPrompt) {
          window.BiliSummary.state.settings.deepseekPrompt = DEFAULTS.deepseekPrompt;
        }
        // 确保 apiCfg 存在
        if (!window.BiliSummary.state.settings.apiCfg) {
          window.BiliSummary.state.settings.apiCfg = { ...DEFAULTS.apiCfg };
        } else {
          Object.assign(window.BiliSummary.state.settings.apiCfg, { ...DEFAULTS.apiCfg, ...saved.apiCfg });
        }
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
    const preserved = {
      deepseekPrompt: s.deepseekPrompt,
      apiCfg: s.apiCfg,
    };
    Object.assign(s, { ...DEFAULTS }, preserved);
    save();
  }

  window.BiliSummary.settings = {
    load,
    save,
    resetDefaults,
    DEFAULTS: { ...DEFAULTS }
  };
})();
