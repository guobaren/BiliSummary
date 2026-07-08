/**
 * BiliSummary Content Script
 * 入口脚本 - 初始化所有模块，监听 SPA 路由变化
 */
(async function () {
  'use strict';

  const BN = window.BiliSummary;

  // ── 浮动图标 ──

  let floatIconEl = null;

  function createFloatIcon() {
    if (floatIconEl) return;
    floatIconEl = document.createElement('div');
    floatIconEl.className = 'bn-float-icon';
    floatIconEl.setAttribute('data-testid', 'bn-float-icon');
    const img = document.createElement('img');
    img.src = chrome.runtime.getURL('icons/icon-32.png');
    img.alt = 'BiliSummary';
    floatIconEl.appendChild(img);
    floatIconEl.addEventListener('click', () => {
      if (BN.state.panelVisible) {
        BN.panel.hide();
      } else {
        BN.panel.show();
      }
    });
    document.body.appendChild(floatIconEl);
    updateFloatIconVisibility();
  }

  function updateFloatIconVisibility() {
    if (!floatIconEl) return;
    const enabled = BN.state.settings.floatIconEnabled !== false;
    floatIconEl.classList.toggle('bn-hidden', !enabled);
  }

  function hideFloatIcon() {
    if (floatIconEl) floatIconEl.classList.add('bn-hidden');
  }

  // 暴露给 panel 模块使用
  BN.floatIcon = { create: createFloatIcon, update: updateFloatIconVisibility, hide: hideFloatIcon };

  // ── 初始化 ──

  async function init() {
    try {
      // 加载设置
      await BN.settings.load();

      // 创建浮动图标
      createFloatIcon();

      // 监听 background 消息（toggle-panel）
      chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'toggle-panel') {
          const s = BN.state;
          if (s.panelVisible) {
            BN.panel.hide();
            return;
          }
          BN.panel.show();
        }
        if (message.type === 'float-icon-toggle') {
          BN.state.settings.floatIconEnabled = message.enabled !== false;
          updateFloatIconVisibility();
        }
      });

      console.log('[BiliSummary] v20260709-1 content script loaded');
    } catch (err) {
      console.error('[BiliSummary] Initialization failed:', err);
    }
  }

  // ── SPA 路由监听 ──

  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onRouteChange();
    }
  });
  if (document.body) {
    urlObserver.observe(document.body, { childList: true, subtree: true });
  }

  let lastBvid = '';
  let lastPage = 1;

  function onRouteChange() {
    const oldBvid = lastBvid;
    const oldPage = lastPage;
    BN.state.reset();
    if (BN.state.panelVisible && BN.subtitle) {
      const newBvid = BN.subtitle.extractBvid(location.href);
      const newPage = BN.subtitle.extractPageIndex(location.href);
      if (newBvid && (newBvid !== oldBvid || newPage !== oldPage)) {
        lastBvid = newBvid;
        lastPage = newPage;
        setTimeout(async () => {
          if (BN.state.panelVisible) {
            await BN.subtitle.refresh();
          }
        }, 1000);
      }
    }
  }

  // ── 启动 ──

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
