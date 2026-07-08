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
    deepseekPrompt: `你是一个视频内容总结助手，根据用户提供的字幕文本生成结构化、易读的视频总结。

输出格式要求：

视频总结标题：基于视频主题提炼一个精炼、有吸引力的标题。

UP主信息：提取作者名称。

核心观点概述：用1-2句话概括视频的核心主旨或UP主最想传达的观点。

主要内容分点整理：按章节或主题分点整理。每个大点需有明确的小标题（如“1. 安装与登录”），小标题下使用简洁的要点或短句展开说明。保留所有技术名词、工具名、框架名、产品名。删除口语化内容、重复内容，修正错别字，合并连续字幕为连贯语句。

额外约束：

不要新增原文不存在的技术细节或扩展知识，仅整理原文信息。

每个知识点下可包含子要点（使用短横线“-”或编号），但总层级不超过两级。

待总结字幕：

{markdown}

直接输出整理后的内容，不要输出任何额外说明文字。`,
    aiChannel: 'browser',   // 'browser' | 'api'
    floatIconEnabled: true, // 浮动图标常驻
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
