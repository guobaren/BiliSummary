/**
 * BiliSummary Panel Module
 * 三标签页：字幕 / AI 总结 / 设置
 */
(function () {
  'use strict';

  window.BiliSummary = window.BiliSummary || {};

  let panelEl = null;
  let mainWrapEl = null;
  let footerEl = null;
  let headerEl = null;
  let tabs = [];
  let resizeData = null; // for resize drag state
  let views = {};

  // ── AI 总结页状态 ──
  let aiThinkEl = null;
  let aiResultEl = null;
  let aiInputEl = null;
  let aiSendBtn = null;
  let aiStatusEl = null;
  let aiActionBtn = null;
  let aiClearBtn = null;
  let aiCopyBtn = null;
  let aiStopBtn = null;
  let aiStatusLineEl = null;
  let aiChannelTagEl = null;
  let aiDsLoginBtn = null;
  let aiMessages = [];
  let aiLoginPollTimer = null;
  let aiResultRaw = ''; // 累加原始 Markdown 文本
  let aiIsFollowUp = false;
  let aiThinkBufStarted = false; // 追问思考是否已加分隔符
  let aiAutoStarted = false; // 自动总结是否已触发（防止重复）
  let lastApiUsage = null; // 最近一次 API 请求的用量（含 OpenCode Go 额度）
  let fetchedModels = null; // 最近一次接口返回的模型列表
  let renderApiConfigUI = null; // 由 bindApiConfigEvents 注册的设置页渲染函数

  const TAB_DEFS = [
    { id: 'ai', label: 'AI 总结', footer: false },
    { id: 'subtitle', label: '字幕', footer: true },
    { id: 'setting', label: '设置', footer: false }
  ];

  // ── 创建面板 ──

  function createPanel() {
    const s = window.BiliSummary.state;

    panelEl = document.createElement('div');
    panelEl.className = 'bn-panel bn-hidden';
    panelEl.setAttribute('data-bn-theme', s.settings.darkMode ? 'dark' : '');

    // Header
    headerEl = document.createElement('div');
    headerEl.className = 'bn-header';

    const tabGroup = document.createElement('div');
    tabGroup.className = 'bn-tab-group';
    tabs = TAB_DEFS.map(def => {
      const btn = document.createElement('button');
      btn.className = 'bn-tab' + (def.id === 'ai' ? ' bn-active' : '');
      btn.textContent = def.label;
      btn.dataset.tab = def.id;
      btn.addEventListener('click', () => switchTab(def.id));
      tabGroup.appendChild(btn);
      return { id: def.id, btn, def };
    });
    headerEl.appendChild(tabGroup);

    // 关闭按钮
    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'bn-minimize';
    minimizeBtn.title = '最小化为浮动图标';
    minimizeBtn.textContent = '−';
    minimizeBtn.addEventListener('click', () => window.BiliSummary.panel.minimize());
    headerEl.appendChild(minimizeBtn);

    setupDrag(headerEl);
    panelEl.appendChild(headerEl);

    // 调整手柄
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "bn-resize-handle";
    panelEl.appendChild(resizeHandle);
    setupResize(panelEl, resizeHandle);

    // Main
    mainWrapEl = document.createElement('div');
    mainWrapEl.className = 'bn-main';

    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'bn-scroll';

    TAB_DEFS.forEach(def => {
      const view = document.createElement('div');
      view.className = 'bn-view' + (def.id === 'ai' ? ' bn-show' : '');
      view.id = `bn-view-${def.id}`;
      if (def.id === 'subtitle') {
        view.innerHTML = '<div id="bn-subtitle-list"></div>';
      } else if (def.id === 'ai') {
        view.innerHTML = buildAiHTML();
      } else if (def.id === 'setting') {
        view.innerHTML = buildSettingHTML();
      }
      scrollWrap.appendChild(view);
      views[def.id] = view;
    });

    mainWrapEl.appendChild(scrollWrap);

    // Footer
    footerEl = document.createElement('div');
    footerEl.className = 'bn-footer';
    footerEl.innerHTML = `
      <button data-action="refresh">刷新</button>
      <button data-action="copy">复制</button>
      <button data-action="export-srt">导出.srt</button>
    `;
    mainWrapEl.appendChild(footerEl);

    panelEl.appendChild(mainWrapEl);
    document.body.appendChild(panelEl);

    // 阻止滚轮事件穿透
    panelEl.addEventListener('wheel', (e) => {
      const el = e.target;
      // 优先匹配最内层的可滚动元素
      const scrollable = el.closest('.bn-ai-result, .bn-ai-think, .bn-sub-list, textarea, [style*="overflow"]');
      if (scrollable) {
        const { scrollTop, scrollHeight, clientHeight } = scrollable;
        const atTop = scrollTop <= 0 && e.deltaY < 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0;
        if (!atTop && !atBottom) return;
      } else {
        // 不在可滚动区域内：检查是否在 .bn-scroll 内（用于字幕/设置页滚动）
        const scrollWrap = el.closest('.bn-scroll');
        if (scrollWrap) {
          const { scrollTop, scrollHeight, clientHeight } = scrollWrap;
          const atTop = scrollTop <= 0 && e.deltaY < 0;
          const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0;
          if (!atTop && !atBottom) return;
        }
      }
      e.preventDefault();
    }, { passive: false });

    // 事件绑定
    footerEl.addEventListener('click', onFooterClick);
    bindSettingEvents();
    bindAiEvents();

    // 同步 footer 状态到当前标签页（默认 'ai'，footer 不显示）
    const initialTab = window.BiliSummary.state.activeTab || 'ai';
    switchTab(initialTab);

    // 应用字体、行高
    applyDisplaySettings();
  }

  // ── AI 总结页 HTML ──

  function buildAiHTML() {
    return `
      <div class="bn-ai-status-bar">
        <span id="bn-ai-status-line" class="bn-ai-status-line">正在检测连接…</span>
        <span class="bn-ai-spacer"></span>
        <button id="bn-ai-ds-login" class="bn-btn-link" style="display:none">登录 DeepSeek</button>
        <span id="bn-ai-channel-tag" class="bn-ai-channel-tag"></span>
      </div>
      <div class="bn-ai-body">
        <div id="bn-ai-think" class="bn-ai-think" style="display:none"></div>
        <div id="bn-ai-result" class="bn-ai-result" style="display:none"></div>
        <div id="bn-ai-empty" class="bn-ai-empty">点击「开始总结」按钮，AI 将根据当前视频字幕生成总结。<br>总结完成后可在下方输入框追问。</div>
      </div>
      <div class="bn-ai-actions">
        <span id="bn-ai-status" class="bn-status bn-status-off"><span class="bn-dot bn-dot-red"></span>未连接</span>
        <button id="bn-ai-action" class="bn-btn-primary">开始总结</button>
        <button id="bn-ai-stop" style="display:none">停止</button>
        <button id="bn-ai-copy" style="display:none">复制</button>
        <button id="bn-ai-clear" style="display:none">新对话</button>
      </div>
      <div class="bn-ai-input-row">
        <textarea id="bn-ai-input" placeholder="追问：输入后回车发送（Shift+Enter 换行）" rows="1"></textarea>
        <button id="bn-ai-send" title="发送">↑</button>
      </div>
    `;
  }

  // ── AI 总结页事件 ──

  function bindAiEvents() {
    const aiView = views['ai'];
    if (!aiView) return;

    aiThinkEl = aiView.querySelector('#bn-ai-think');
    aiResultEl = aiView.querySelector('#bn-ai-result');
    aiInputEl = aiView.querySelector('#bn-ai-input');
    aiSendBtn = aiView.querySelector('#bn-ai-send');
    aiStatusEl = aiView.querySelector('#bn-ai-status');
    aiActionBtn = aiView.querySelector('#bn-ai-action');
    aiClearBtn = aiView.querySelector('#bn-ai-clear');
    aiCopyBtn = aiView.querySelector('#bn-ai-copy');
    aiStopBtn = aiView.querySelector('#bn-ai-stop');
    aiStatusLineEl = aiView.querySelector('#bn-ai-status-line');
    aiChannelTagEl = aiView.querySelector('#bn-ai-channel-tag');
    aiDsLoginBtn = aiView.querySelector('#bn-ai-ds-login');

    // DeepSeek 登录
    aiDsLoginBtn.addEventListener('click', () => {
      window.BiliSummary.deepseek.openLogin();
      startAiLoginPoll();
    });

    // 主按钮
    aiActionBtn.addEventListener('click', onAiActionClick);
    // 停止
    aiStopBtn.addEventListener('click', onAiStopClick);
    // 复制
    aiCopyBtn.addEventListener('click', onAiCopyClick);
    // 新对话
    aiClearBtn.addEventListener('click', onAiClearClick);

    // 输入框
    aiInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onAiSend();
      }
    });
    aiSendBtn.addEventListener('click', onAiSend);

    // 监听两个通道的事件
    bindAiBrowserChannelEvents();
    bindAiApiChannelEvents();

    // 默认检测 DeepSeek 登录状态
    if (window.BiliSummary.deepseek) {
      window.BiliSummary.deepseek.checkLogin().then(() => refreshAiStatusUI());
    }
  }

  let aiLoginPollStartTime = 0;
  function startAiLoginPoll() {
    stopAiLoginPoll();
    aiLoginPollStartTime = Date.now();
    aiLoginPollTimer = setInterval(async () => {
      if (!window.BiliSummary.deepseek) return;
      await window.BiliSummary.deepseek.checkLogin();
      if (window.BiliSummary.deepseek.getState() === 'ready' || Date.now() - aiLoginPollStartTime > 30000) {
        stopAiLoginPoll();
        refreshAiStatusUI();
      }
    }, 2000);
  }

  function stopAiLoginPoll() {
    if (aiLoginPollTimer) {
      clearInterval(aiLoginPollTimer);
      aiLoginPollTimer = null;
    }
  }

  function bindAiBrowserChannelEvents() {
    const ds = window.BiliSummary.deepseek;
    if (!ds) return;
    ds.onStateChange((s) => {
      if ((window.BiliSummary.state.settings.aiChannel || 'api') !== 'browser') return;
      refreshAiStatusUI(s);
    });
    ds.onChunk((chunk) => {
      if ((window.BiliSummary.state.settings.aiChannel || 'api') !== 'browser') return;
      appendAiStreamChunk(chunk);
    });
    ds.onDone(() => {
      if ((window.BiliSummary.state.settings.aiChannel || 'api') !== 'browser') return;
      onAiStreamDone();
    });
    ds.onError((err) => {
      if ((window.BiliSummary.state.settings.aiChannel || 'api') !== 'browser') return;
      onAiStreamError(err);
    });
  }

  function bindAiApiChannelEvents() {
    const api = window.BiliSummary.apiAI;
    if (!api) return;
    api.onStateChange((s) => {
      if ((window.BiliSummary.state.settings.aiChannel || 'api') !== 'api') return;
      refreshAiStatusUI(s);
    });
    api.onChunk((chunk) => {
      if ((window.BiliSummary.state.settings.aiChannel || 'api') !== 'api') return;
      appendAiStreamChunk(chunk);
    });
    api.onDone(() => {
      if ((window.BiliSummary.state.settings.aiChannel || 'api') !== 'api') return;
      onAiStreamDone();
    });
    api.onError((err) => {
      if ((window.BiliSummary.state.settings.aiChannel || 'api') !== 'api') return;
      onAiStreamError(err);
    });
    api.onUsage((usage) => {
      lastApiUsage = usage;
      renderApiUsage();
    });
  }

  function renderMarkdown(text) {
    if (!text) return '';
    // 转义 HTML
    let escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = escaped.split('\n');
    const out = [];
    let inCode = false, codeBuf = [], listStack = [];

    function flushList() {
      while (listStack.length > 0) {
        const frame = listStack.pop();
        if (frame.liOpen) out.push('</li>');
        out.push('</ul>');
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 代码块
      if (/^```/.test(line.trimStart())) {
        flushList();
        if (inCode) { out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>'); codeBuf = []; inCode = false; }
        else { inCode = true; }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      // 空行
      if (line.trim() === '') { flushList(); out.push(''); continue; }

      // 标题
      const hm = line.match(/^(#{1,6})\s+(.+)/);
      if (hm) { flushList(); out.push('<h' + hm[1].length + '>' + hm[2] + '</h' + hm[1].length + '>'); continue; }

      // 列表 (支持嵌套)
      const lm = line.match(/^(\s*)[-*]\s+(.+)/);
      if (lm) {
        const indent = lm[1].length;
        const content = lm[2];
        // 关闭更深层级的列表
        while (listStack.length > 0 && listStack[listStack.length - 1].indent > indent) {
          const frame = listStack.pop();
          if (frame.liOpen) out.push('</li>');
          out.push('</ul>');
          if (listStack.length > 0 && listStack[listStack.length - 1].liOpen) {
            out.push('</li>');
            listStack[listStack.length - 1].liOpen = false;
          }
        }
        if (listStack.length === 0 || listStack[listStack.length - 1].indent < indent) {
          listStack.push({ indent, liOpen: false });
          out.push('<ul>');
        }
        if (listStack.length > 0 && listStack[listStack.length - 1].liOpen) {
          out.push('</li>');
        }
        out.push('<li>' + content);
        listStack[listStack.length - 1].liOpen = true;
        continue;
      }
      // 引用
      const qm = line.match(/^>\s+(.+)/);
      if (qm) { flushList(); out.push('<blockquote>' + qm[1] + '</blockquote>'); continue; }

      // 分隔线
      if (/^---+\s*$/.test(line)) { flushList(); out.push('<hr>'); continue; }

      // 段落
      flushList(); out.push('<p>' + line + '</p>');
    }
    flushList();
    if (inCode) out.push('<pre><code>' + codeBuf.join('\n') + '</code></pre>');

    // 内联样式
    let html = out.join('\n');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return html;
  }

  function appendAiStreamChunk(chunk) {
    if (chunk.type === 'think') {
      // 追问的思考也显示在思考区，与首次总结共用（加分隔符区分）
      if (aiIsFollowUp && !aiThinkBufStarted) {
        aiThinkBufStarted = true;
        aiThinkEl.textContent += '\n\n---\n\n';
      }
      if (aiThinkEl.style.display === 'none') aiThinkEl.style.display = '';
      aiThinkEl.textContent += chunk.text;
      aiThinkEl.scrollTop = aiThinkEl.scrollHeight;
    } else {
      if (aiResultEl.style.display === 'none') aiResultEl.style.display = '';
      aiResultRaw += chunk.text;
      aiResultEl.innerHTML = renderMarkdown(aiResultRaw);
      aiResultEl.scrollTop = aiResultEl.scrollHeight;
    }
  }

  function onAiStreamDone() {
    // 浏览器 SDK 通道：deepseek.js 内部已维护 history
    // API 通道：维护 aiMessages
    if (getActiveChannel() === 'api') {
      const result = getAiResult();
      if ((result.response || '').trim()) {
        aiMessages.push({ role: 'assistant', content: result.response.trim() });
      }
    }
    refreshAiStatusUI('done');
  }

  function onAiStreamError(err) {
    if (aiResultEl.style.display === 'none') aiResultEl.style.display = '';
    aiResultRaw += '\n\n[错误] ' + err;
    aiResultEl.innerHTML = renderMarkdown(aiResultRaw);
    refreshAiStatusUI('error');
  }

  function getAiResult() {
    if (getActiveChannel() === 'browser') {
      return window.BiliSummary.deepseek.getResult();
    }
    return { think: aiThinkEl?.textContent?.trim() || '', response: aiResultEl?.textContent?.trim() || '' };
  }

  function getActiveChannel() {
    return window.BiliSummary.state.settings.aiChannel || 'api';
  }

  /**
   * 当前生效的 API 服务商（默认 OpenCode Go）
   */
  function getApiProvider() {
    const settings = window.BiliSummary.state.settings;
    const cfg = settings.apiCfg || {};
    const providers = window.BiliSummary.AI_PROVIDERS;
    if (providers) return providers.resolve(settings.apiProvider || cfg.provider, cfg.endpoint);
    return {
      id: 'custom',
      label: '自定义接口',
      description: '',
      endpoint: cfg.endpoint || '',
      model: cfg.model || '',
      models: [],
      lockEndpoint: false,
      lockModel: false,
      keyUrl: '',
      keyLabel: '',
      keyPlaceholder: 'sk-...',
    };
  }

  function getApiModelLabel(provider, modelId) {
    const id = String(modelId || '');
    const found = (provider?.models || []).find(item => item.id === id);
    return found ? found.name : (id || provider?.model || '');
  }

  function formatApiUsage(usage) {
    const providers = window.BiliSummary.AI_PROVIDERS;
    const parsed = providers ? providers.parseUsage(usage) : null;
    if (!parsed) return '';
    const parts = [];
    if (parsed.inputTokens != null || parsed.outputTokens != null) {
      parts.push(`tokens 输入 ${parsed.inputTokens ?? '-'} / 输出 ${parsed.outputTokens ?? '-'}`);
    }
    if (parsed.cacheRead != null && parsed.cacheRead > 0) parts.push(`缓存读取 ${parsed.cacheRead}`);
    const formatUsd = (value) => `$${(value >= 0.01 ? value.toFixed(4) : value.toFixed(6))}`;
    if (providers && providers.isGoBilling(parsed.billingSource)) parts.push('计费来源：OpenCode Go 额度');
    if (parsed.allowance != null) {
      parts.push(`本次计入套餐额度 ${formatUsd(parsed.allowance)}`);
    } else if (parsed.cost != null) {
      parts.push(`本次消耗 ${formatUsd(parsed.cost)}`);
    }
    return parts.join(' · ');
  }

  function renderApiUsage() {
    const el = panelEl?.querySelector('#bn-api-usage');
    if (!el) return;
    const text = lastApiUsage ? formatApiUsage(lastApiUsage) : '';
    if (!text) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.style.display = '';
    el.textContent = `上次请求：${text}`;
  }

  async function onAiActionClick() {
    if (getActiveChannel() === 'browser') {
      const ds = window.BiliSummary.deepseek;
      // 每次点击前重新检测登录，捕获外部登出
      const loginResult = await ds.checkLogin().catch(() => ({ loggedIn: false }));
      if (!loginResult?.loggedIn) {
        refreshAiStatusUI('not_logged_in');
        ds.openLogin();
        startAiLoginPoll();
        return;
      }
      const st = ds.getState();
      if (st === 'reading' || st === 'responding') {
        ds.abort();
        return;
      }
      if (st === 'ready' || st === 'error' || st === 'done') {
        startAiSummary();
      }
    } else {
      const api = window.BiliSummary.apiAI;
      const st = api.getState();
      if (st === 'sending' || st === 'responding') {
        api.abort();
        return;
      }
      const cfg = window.BiliSummary.state.settings.apiCfg || {};
      if (!cfg.apiKey || !cfg.endpoint || !cfg.model) {
        refreshAiStatusUI();
        switchTab('setting');
        showToast('请先到「设置」页填写 API Key');
        return;
      }
      startAiSummary();
    }
  }

  function onAiStopClick() {
    if (getActiveChannel() === 'browser') window.BiliSummary.deepseek.abort();
    else window.BiliSummary.apiAI.abort();
  }

  function onAiCopyClick() {
    const text = aiResultRaw || getAiResult().response || '';
    if (text) navigator.clipboard.writeText(text).then(() => showToast('已复制'));
  }

  function onAiClearClick() {
    if (getActiveChannel() === 'browser') {
      window.BiliSummary.deepseek.clear();
    } else {
      window.BiliSummary.apiAI.clear();
      aiMessages = [];
    }
    aiThinkEl.style.display = 'none';
    aiThinkEl.textContent = '';
    aiResultEl.style.display = 'none';
    aiResultEl.innerHTML = '';
    aiResultRaw = '';
    aiIsFollowUp = false;
    aiThinkBufStarted = false;
    const aiView = views['ai'];
    aiView.querySelector('#bn-ai-empty').style.display = '';
    refreshAiStatusUI('idle');
  }

  function onAiSend() {
    const text = aiInputEl.value.trim();
    if (!text) return;
    aiInputEl.value = '';
    if (aiResultEl.style.display === 'none') aiResultEl.style.display = '';
    aiResultRaw += '\n\n---\n\n**追问:** ' + text + '\n\n';
    aiResultEl.innerHTML = renderMarkdown(aiResultRaw);
    aiResultEl.scrollTop = aiResultEl.scrollHeight;
    views['ai'].querySelector('#bn-ai-empty').style.display = 'none';

    // 追问时保留已有思考，追加分隔符准备新一轮思考
    if (aiThinkEl.style.display === 'none') aiThinkEl.style.display = '';
    aiIsFollowUp = true;
    aiThinkBufStarted = false;

    if (getActiveChannel() === 'browser') {
      // 追问：直接发追问文本，chatId 让 DeepSeek 在同一会话中继续，像网页端一样多轮对话
      window.BiliSummary.deepseek.sendMarkdown(text, '');
    } else {
      aiMessages.push({ role: 'user', content: text });
      sendAiApiMessages();
    }
  }

  function startAiSummary() {
    const s = window.BiliSummary.state;
    if (!s.subtitleBody || s.subtitleBody.length === 0) {
      const emptyEl = views['ai'].querySelector('#bn-ai-empty');
      if (emptyEl) {
        emptyEl.textContent = '当前视频无字幕，无法生成总结。';
        emptyEl.style.display = '';
      }
      aiThinkEl.style.display = 'none';
      aiThinkEl.textContent = '';
      aiResultEl.style.display = 'none';
      aiResultEl.textContent = '';
      return;
    }
    aiThinkEl.style.display = 'none';
    aiThinkEl.textContent = '';
    aiResultEl.style.display = 'none';
    aiResultEl.textContent = '';
    aiResultRaw = '';
    aiIsFollowUp = false;
    aiThinkBufStarted = false;
    views['ai'].querySelector('#bn-ai-empty').style.display = 'none';

    // 开启新对话时清空历史
    if (getActiveChannel() === 'browser') {
      window.BiliSummary.deepseek.clear();
      const videoContext = buildAiVideoContext();
      const prompt = s.settings.deepseekPrompt || '';
      const mode = s.settings.aiMode || 'fast';
      window.BiliSummary.deepseek.sendMarkdown(videoContext, prompt, mode);
    } else {
      // 新对话：重置 OpenCode 会话标识与用量显示
      window.BiliSummary.apiAI.newSession();
      lastApiUsage = null;
      renderApiUsage();
      aiMessages = [
        { role: 'system', content: buildAiSystemPrompt() },
        { role: 'user', content: buildAiVideoContext() },
      ];
      sendAiApiMessages();
    }
  }

  function waitForSubtitles(cb) {
    const s = window.BiliSummary.state;
    if (s.subtitleBody?.length) { cb(); return; }
    const start = Date.now();
    const timer = setInterval(() => {
      if (s.subtitleBody?.length) {
        clearInterval(timer);
        cb();
      } else if (Date.now() - start > 15000) {
        clearInterval(timer);
      }
    }, 300);
  }

  function autoSummarizeIfReady() {
    const s = window.BiliSummary.state;
    if (!s.settings.autoSummary) return;
    if (aiAutoStarted) return;

    const channel = s.settings.aiChannel || 'api';

    if (channel === 'browser') {
      const ds = window.BiliSummary.deepseek;
      if (!ds) return;
      waitForSubtitles(() => {
        if (aiAutoStarted) return;
        ds.checkLogin().then((result) => {
          if (!aiAutoStarted && result?.loggedIn && ds.getState() === 'ready' && s.subtitleBody?.length) {
            aiAutoStarted = true;
            startAiSummary();
          }
          refreshAiStatusUI();
        });
      });
    } else {
      const cfg = s.settings.apiCfg || {};
      if (!cfg.apiKey || !cfg.endpoint || !cfg.model) return;
      waitForSubtitles(() => {
        if (!aiAutoStarted && s.subtitleBody?.length) {
          aiAutoStarted = true;
          startAiSummary();
        }
      });
    }
  }

  function sendAiApiMessages() {
    const cfg = window.BiliSummary.state.settings.apiCfg || {};
    const provider = getApiProvider();
    window.BiliSummary.apiAI.sendToApi(aiMessages, {
      provider: provider.id,
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: cfg.model,
      stream: cfg.stream,
      sessionId: window.BiliSummary.apiAI.getSessionId(),
    });
  }

  function buildAiSystemPrompt() {
    const s = window.BiliSummary.state;
    const custom = (s.settings.deepseekPrompt || '').trim();
    if (custom) {
      return custom.replace(/\{markdown\}/g, '').trim() || '你是一个视频内容总结助手。';
    }
    return `你是一个视频内容总结助手。用户会提供一段视频的字幕文本（可能包含时间戳和章节信息）。
请根据字幕内容生成简洁、高质量的视频总结。
要求：
1. 删除口语化内容、重复内容、无意义过渡语句。
2. 不要逐句输出字幕，将连续字幕整理为简洁、连贯、易阅读的知识内容。
3. 字幕可能由 AI 识别生成，存在错别字、同音字、术语错误，请结合上下文修正。
4. 若存在章节结构，按章节整理；若无章节，按内容自然分段。
5. 保留所有技术名词、工具名、框架名、产品名。
6. 仅整理原文，禁止总结、解释、扩展原文不存在的信息。
7. 使用中文输出。`;
  }

  function buildAiVideoContext() {
    const s = window.BiliSummary.state;
    let text = '';
    if (s.title) text += `视频标题：${s.title}\n`;
    if (s.author) text += `作者：${s.author}\n`;
    if (s.chapters && s.chapters.length > 0) {
      text += `\n章节：\n`;
      s.chapters.forEach((c, i) => {
        text += `${i + 1}. [${formatAiTime(c.from)}] ${c.title}\n`;
      });
    }
    text += `\n字幕：\n`;
    if (s.subtitleBody && s.subtitleBody.length > 0) {
      s.subtitleBody.forEach(item => {
        text += `[${formatAiTime(item.from)}] ${item.content}\n`;
      });
    } else {
      text += '(无字幕)\n';
    }
    return text;
  }

  function formatAiTime(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function refreshAiStatusUI(forceState) {
    if (!aiStatusEl) return;
    // 始终从 settings 读取当前通道，保证和设置页同步
    const channel = window.BiliSummary.state.settings.aiChannel || 'api';

    let st = forceState;
    if (!st) {
      st = channel === 'browser' ? window.BiliSummary.deepseek.getState() : window.BiliSummary.apiAI.getState();
    }

    // 顶部状态行 & 通道标签
    const cfg = window.BiliSummary.state.settings.apiCfg || {};
    const provider = getApiProvider();
    const providerModel = getApiModelLabel(provider, cfg.model) || cfg.model;
    if (aiChannelTagEl) {
      aiChannelTagEl.textContent = channel === 'browser'
        ? 'DeepSeek 浏览器'
        : (provider.id === 'opencode-go' ? `OpenCode Go · ${providerModel}` : `自定义接口 · ${providerModel || '未配置模型'}`);
    }

    // 未登录时 status line 显示主动提醒而非「就绪」
    let loginNotice = '';
    let statusLineText = '';
    let statusLineCls = '';
    if (channel === 'browser') {
      if (st === 'not_logged_in') {
        loginNotice = '未登录 DeepSeek，请点击右侧「登录 DeepSeek」按钮登录。';
        statusLineText = '未登录';
        statusLineCls = 'bn-ai-status-warn';
        aiDsLoginBtn.style.display = '';
      } else if (st === 'ready') {
        statusLineText = '已登录 DeepSeek';
        statusLineCls = 'bn-ai-status-ok';
        aiDsLoginBtn.style.display = 'none';
      } else if (st === 'reading' || st === 'responding') {
        statusLineText = '总结中…';
        statusLineCls = 'bn-ai-status-warn';
        aiDsLoginBtn.style.display = 'none';
      } else if (st === 'done') {
        statusLineText = '总结完成';
        statusLineCls = 'bn-ai-status-ok';
        aiDsLoginBtn.style.display = 'none';
      } else if (st === 'error') {
        statusLineText = '发生错误';
        statusLineCls = 'bn-ai-status-warn';
        aiDsLoginBtn.style.display = 'none';
      }
    } else {
      aiDsLoginBtn.style.display = 'none';
      // OpenCode Go / 自定义接口：检查是否配置了必要信息
      const hasCfg = !!(cfg.apiKey && cfg.endpoint && cfg.model);
      if (!hasCfg) {
        loginNotice = provider.id === 'opencode-go'
          ? '尚未填写 OpenCode API Key：请到「设置」页填入 OpenCode Console 中的 Key（OpenCode Go 仅提供 DeepSeek V4.1 Flash）。'
          : '尚未配置 API Key / Endpoint / 模型，请先到「设置」页配置。';
        statusLineText = '未配置';
        statusLineCls = 'bn-ai-status-warn';
      } else if (st === 'idle' || !st) {
        statusLineText = `就绪 · ${providerModel || cfg.model}`;
        statusLineCls = 'bn-ai-status-ok';
      } else if (st === 'sending' || st === 'responding') {
        statusLineText = '总结中…';
        statusLineCls = 'bn-ai-status-warn';
      } else if (st === 'done') {
        statusLineText = '总结完成';
        statusLineCls = 'bn-ai-status-ok';
      } else if (st === 'error') {
        statusLineText = '发生错误';
        statusLineCls = 'bn-ai-status-warn';
      }
    }
    if (aiStatusLineEl) {
      aiStatusLineEl.className = `bn-ai-status-line ${statusLineCls}`;
      aiStatusLineEl.innerHTML = loginNotice
        ? `<span class="bn-ai-login-notice">${loginNotice}</span>`
        : statusLineText;
    }

    const stateMap = {
      'not_logged_in': { cls: 'bn-status-off', dot: 'bn-dot-red', text: '未登录', action: '打开 DeepSeek 登录' },
      'ready':         { cls: 'bn-status-ok',  dot: 'bn-dot-green', text: '已登录', action: '开始总结' },
      'reading':       { cls: 'bn-status-warn', dot: 'bn-spinner', text: '总结中', action: '停止', hideAction: true },
      'responding':    { cls: 'bn-status-warn', dot: 'bn-spinner', text: '总结中', action: '停止', hideAction: true },
      'done':          { cls: 'bn-status-ok',  dot: 'bn-dot-green', text: '已完成', action: '再次总结' },
      'error':         { cls: 'bn-status-off', dot: 'bn-dot-red', text: '错误', action: '重试' },
      'idle':          { cls: 'bn-status-ok',  dot: 'bn-dot-green', text: '就绪', action: '开始总结' },
      'sending':       { cls: 'bn-status-warn', dot: 'bn-spinner', text: '总结中', action: '停止', hideAction: true },
    };
    const info = stateMap[st] || stateMap['idle'];
    aiStatusEl.className = `bn-status ${info.cls}`;
    aiStatusEl.innerHTML = `<span class="${info.dot}"></span>${info.text}`;
    aiActionBtn.textContent = info.action;
    aiActionBtn.style.display = info.hideAction ? 'none' : '';
    const isStreaming = (st === 'reading' || st === 'responding' || st === 'sending');
    aiStopBtn.style.display = isStreaming ? '' : 'none';
    const hasResult = (aiResultEl && aiResultEl.style.display !== 'none' && aiResultEl.textContent);
    aiCopyBtn.style.display = hasResult ? '' : 'none';
    aiClearBtn.style.display = hasResult ? '' : 'none';
  }

  // ── 设置页 HTML ──

  function buildSettingHTML() {
    return `
      <div id="bn-settings-main">
        <div class="bn-setting-label">字幕语言</div>
        <select class="bn-select" id="bn-lang-select"><option value="">暂无字幕</option></select>
        <div class="bn-setting-label">AI 提示词</div>
        <div class="bn-prompt-toggle" data-prompt="ds">▸ 编辑提示词（用于 AI 总结）</div>
        <div class="bn-setting-label">字体大小</div>
        <div class="bn-chip-group" data-setting="fontSize">
          <input type="radio" name="bn-fontSize" id="bn-fs-s" value="small"><label for="bn-fs-s">小</label>
          <input type="radio" name="bn-fontSize" id="bn-fs-d" value="default" checked><label for="bn-fs-d">默认</label>
          <input type="radio" name="bn-fontSize" id="bn-fs-m" value="medium"><label for="bn-fs-m">中</label>
          <input type="radio" name="bn-fontSize" id="bn-fs-l" value="large"><label for="bn-fs-l">大</label>
        </div>
        <div class="bn-setting-label">行高</div>
        <div class="bn-chip-group" data-setting="lineHeight">
          <input type="radio" name="bn-lineHeight" id="bn-lh-n" value="narrow"><label for="bn-lh-n">窄</label>
          <input type="radio" name="bn-lineHeight" id="bn-lh-s" value="standard" checked><label for="bn-lh-s">标准</label>
          <input type="radio" name="bn-lineHeight" id="bn-lh-w" value="wide"><label for="bn-lh-w">宽</label>
        </div>
        <div class="bn-switch">
          <span>自动滚动</span>
          <input type="checkbox" id="bn-auto-scroll" checked>
          <label class="bn-switch-track" for="bn-auto-scroll"></label>
        </div>
        <div class="bn-switch">
          <span>夜间模式</span>
          <input type="checkbox" id="bn-dark-mode">
          <label class="bn-switch-track" for="bn-dark-mode"></label>
        </div>
        <div class="bn-switch">
          <span>打开后自动总结</span>
          <input type="checkbox" id="bn-auto-summary" checked>
          <label class="bn-switch-track" for="bn-auto-summary"></label>
        </div>
        <div class="bn-switch-desc">开启后，打开面板时若 AI 通道已就绪（DeepSeek 已登录 / 自定义 API 已配置 Key 和模型），将自动开始总结。</div>
        <button class="bn-setting-btn" id="bn-reset-btn">恢复默认设置</button>

        <div class="bn-setting-label" style="margin-top:16px">AI 总结通道</div>
        <label class="bn-radio-line">
          <input type="radio" name="bn-ai-channel-setting" id="bn-as-browser" value="browser">
          <div><div class="bn-radio-title">DeepSeek（浏览器 SDK）</div><div class="bn-radio-desc">登录 chat.deepseek.com 后使用；需安装并保持登录状态</div></div>
        </label>
        <div class="bn-mode-row" id="bn-mode-row">
          <span class="bn-mode-label">AI 模式</span>
          <div class="bn-mode-toggle">
            <input type="radio" name="bn-ai-mode" id="bn-mode-fast" value="fast" checked><label for="bn-mode-fast">快速</label>
            <input type="radio" name="bn-ai-mode" id="bn-mode-expert" value="expert"><label for="bn-mode-expert">专家</label>
          </div>
        </div>
        <label class="bn-radio-line">
          <input type="radio" name="bn-ai-channel-setting" id="bn-as-api" value="api">
          <div><div class="bn-radio-title">OpenCode Go / 自定义接口（OpenAI 兼容）</div><div class="bn-radio-desc">默认使用 OpenCode Go 套餐（仅提供 DeepSeek V4.1 Flash），也可切换到任意 OpenAI 兼容接口</div></div>
        </label>

        <div class="bn-setting-label" style="margin-top:16px">AI 接口配置（用于「OpenCode Go / 自定义接口」通道）</div>
        <div class="bn-api-config">
          <div class="bn-field-row">
            <label>服务商</label>
            <select id="bn-api-provider" class="bn-select"></select>
          </div>
          <div class="bn-field-hint" id="bn-api-provider-hint"></div>
          <div class="bn-field-row">
            <label>Endpoint</label>
            <input type="text" id="bn-api-endpoint" class="bn-input" placeholder="https://opencode.ai/inference/go/openai/v1/chat/completions">
          </div>
          <div class="bn-field-row">
            <label>API Key</label>
            <input type="password" id="bn-api-key" class="bn-input" placeholder="OpenCode Console 中创建的 API Key">
          </div>
          <div class="bn-field-row">
            <label>模型</label>
            <div class="bn-model-row">
              <select id="bn-api-model-select" class="bn-select bn-model-select"></select>
              <input type="text" id="bn-api-model-input" class="bn-input bn-model-input" placeholder="deepseek-v4.1-flash">
            </div>
          </div>
          <div class="bn-field-row">
            <button id="bn-api-fetch-models" class="bn-btn-secondary">测试连接 / 获取模型</button>
            <span id="bn-api-status" class="bn-api-status"></span>
          </div>
          <div class="bn-field-row">
            <label class="bn-checkbox-row">
              <input type="checkbox" id="bn-api-stream" checked>
              <span>使用流式输出（SSE）</span>
            </label>
          </div>
          <div class="bn-api-links">
            <a class="bn-btn-link" id="bn-api-key-link" href="https://opencode.ai/console" target="_blank" rel="noopener noreferrer">获取 OpenCode API Key ↗</a>
          </div>
          <div class="bn-api-usage" id="bn-api-usage" style="display:none"></div>
        </div>

        <div class="bn-clear-history-section">
          <div class="bn-clear-history-row">
            <button class="bn-setting-btn bn-btn-danger" id="bn-scan-sessions-btn">清除插件历史对话</button>
            <span class="bn-clear-history-desc" id="bn-clear-history-desc"></span>
          </div>
          <div class="bn-clear-history-status" id="bn-clear-history-status"></div>
          <div class="bn-scan-progress" id="bn-scan-progress" style="display:none"></div>
        </div>

        <div class="bn-about">
          <div class="bn-about-divider"></div>
          <div class="bn-about-version">BiliSummary <span id="bn-version"></span></div>
          <a class="bn-about-link" href="https://github.com/guobaren/BiliSummary/releases" target="_blank">GitHub Releases ↗</a>
        </div>
      </div>
      <div id="bn-settings-editor" style="display:none">
        <div class="bn-editor-title">提示词管理</div>
        <div class="bn-prompt-toggle bn-editor-back" id="bn-editor-back">▾ AI 总结提示词</div>
        <textarea class="bn-prompt-textarea" id="bn-editor-textarea"></textarea>
        <div class="bn-doc-actions">
          <button id="bn-editor-save" class="bn-btn-primary">保存</button>
          <button id="bn-editor-reset">重置</button>
        </div>
      </div>
    `;
  }

  // ── 设置页事件 ──

  function bindSettingEvents() {
    // 字体大小
    panelEl.querySelectorAll('input[name="bn-fontSize"]').forEach(r => {
      r.addEventListener('change', () => {
        window.BiliSummary.state.settings.fontSize = r.value;
        applyDisplaySettings();
        window.BiliSummary.settings.save();
      });
    });

    // 行高
    panelEl.querySelectorAll('input[name="bn-lineHeight"]').forEach(r => {
      r.addEventListener('change', () => {
        window.BiliSummary.state.settings.lineHeight = r.value;
        applyDisplaySettings();
        window.BiliSummary.settings.save();
      });
    });

    // 自动滚动
    const autoScrollEl = panelEl.querySelector('#bn-auto-scroll');
    if (autoScrollEl) {
      autoScrollEl.addEventListener('change', () => {
        window.BiliSummary.state.settings.autoScroll = autoScrollEl.checked;
        window.BiliSummary.settings.save();
      });
    }

    // 夜间模式
    const darkModeEl = panelEl.querySelector('#bn-dark-mode');
    if (darkModeEl) {
      darkModeEl.addEventListener('change', () => {
        window.BiliSummary.state.settings.darkMode = darkModeEl.checked;
        const theme = darkModeEl.checked ? 'dark' : '';
        panelEl.setAttribute('data-bn-theme', theme);
        window.BiliSummary.settings.save();
      });
    }

    // 打开后自动总结
    const autoSummaryEl = panelEl.querySelector('#bn-auto-summary');
    if (autoSummaryEl) {
      autoSummaryEl.addEventListener('change', () => {
        window.BiliSummary.state.settings.autoSummary = autoSummaryEl.checked;
        window.BiliSummary.settings.save();
      });
    }

    // 提示词管理
    let editingType = null;
    const PROMPT_MAP = {
      ds: { key: 'deepseekPrompt', default: '', label: 'AI 总结提示词' },
    };

    function openEditor(type) {
      const info = PROMPT_MAP[type];
      if (!info) return;
      editingType = type;
      const mainEl = document.getElementById('bn-settings-main');
      const editorEl = document.getElementById('bn-settings-editor');
      const textarea = document.getElementById('bn-editor-textarea');
      const backBtn = document.getElementById('bn-editor-back');
      const stored = window.BiliSummary.state.settings[info.key];
      if (mainEl) mainEl.style.display = 'none';
      if (editorEl) editorEl.style.display = '';
      if (textarea) textarea.value = stored || getDefaultAiPrompt();
      if (backBtn) backBtn.textContent = '▾ ' + info.label;
    }

    function closeEditor() {
      editingType = null;
      const mainEl = document.getElementById('bn-settings-main');
      const editorEl = document.getElementById('bn-settings-editor');
      if (mainEl) mainEl.style.display = '';
      if (editorEl) editorEl.style.display = 'none';
    }

    const settingView = views['setting'];
    if (settingView) {
      settingView.addEventListener('click', (e) => {
        const toggle = e.target.closest('.bn-prompt-toggle');
        if (!toggle) return;
        const type = toggle.dataset.prompt;
        if (type) openEditor(type);
      });
    }

    const editorBack = document.getElementById('bn-editor-back');
    if (editorBack) editorBack.addEventListener('click', closeEditor);

    const editorSave = document.getElementById('bn-editor-save');
    if (editorSave) editorSave.addEventListener('click', () => {
      if (!editingType) return;
      const info = PROMPT_MAP[editingType];
      const textarea = document.getElementById('bn-editor-textarea');
      if (info && textarea) {
        window.BiliSummary.state.settings[info.key] = textarea.value;
        window.BiliSummary.settings.save();
        showToast('已保存');
      }
      closeEditor();
    });

    const editorReset = document.getElementById('bn-editor-reset');
    if (editorReset) editorReset.addEventListener('click', () => {
      if (!editingType) return;
      const info = PROMPT_MAP[editingType];
      const textarea = document.getElementById('bn-editor-textarea');
      if (info && textarea) {
        window.BiliSummary.state.settings[info.key] = '';
        textarea.value = getDefaultAiPrompt();
        window.BiliSummary.settings.save();
        showToast('已重置为默认提示词');
      }
    });

    // 恢复默认
    const resetBtn = panelEl.querySelector('#bn-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        window.BiliSummary.settings.resetDefaults();
        fetchedModels = null;
        loadSettingsToUI();
        applyDisplaySettings();
        panelEl.setAttribute('data-bn-theme', '');
        refreshAiStatusUI();
        showToast('已恢复默认设置（OpenCode Go / DeepSeek V4.1 Flash）');
      });
    }

    // ── 清除历史对话 ──
    const scanSessionsBtn = panelEl.querySelector('#bn-scan-sessions-btn');
    const clearStatus = panelEl.querySelector('#bn-clear-history-status');
    const scanProgressEl = panelEl.querySelector('#bn-scan-progress');
    let scannedSessionIds = [];
    let isScanning = false;
    let scanPromise = null;
    const BTN_DEFAULT = '清除插件历史对话';
    const SCAN_LIMIT = 40;
    const descEl = panelEl.querySelector('#bn-clear-history-desc');
    if (descEl) descEl.textContent = `扫描最近 ${SCAN_LIMIT} 次对话，删除所有由插件生成的记录`;
    const BTN_STOP = '停止扫描';

    if (scanSessionsBtn) {
      // 接收扫描进度
      chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'ds-scan-progress' && isScanning) {
          scanProgressEl.style.display = '';
          scanProgressEl.textContent = `[${message.checked}/${message.total}] ${message.current || ''}`;
        }
      });

      scanSessionsBtn.addEventListener('click', async () => {
        // 正在扫描中 → 中止
        if (isScanning) {
          scanSessionsBtn.disabled = true;
          scanSessionsBtn.textContent = '正在停止...';
          try {
            await chrome.runtime.sendMessage({ type: 'ds-abort-scan' });
            if (scanPromise) {
              try {
                const resp = await scanPromise;
                handleScanResult(resp);
                scanPromise = null;
                return;
              } catch (e) {
                clearStatus.textContent = '扫描请求失败: ' + e.message;
                clearStatus.className = 'bn-clear-history-status bn-status-err';
              }
            }
          } catch (e) { /* ignore */ }
          resetScanButton();
          scanPromise = null;
          return;
        }

        isScanning = true;
        scanSessionsBtn.disabled = false;
        scanSessionsBtn.textContent = BTN_STOP;
        scanSessionsBtn.classList.add('bn-btn-danger');
        clearStatus.textContent = '';
        clearStatus.className = 'bn-clear-history-status';
        scanProgressEl.style.display = '';
        scanProgressEl.textContent = '正在扫描...';
        scannedSessionIds = [];

        scanPromise = chrome.runtime.sendMessage({ type: 'ds-scan-sessions', limit: SCAN_LIMIT });
        try {
          const resp = await scanPromise;
          handleScanResult(resp);
        } catch (e) {
          if (!isScanning) return;
          clearStatus.textContent = '扫描请求失败: ' + e.message;
          clearStatus.className = 'bn-clear-history-status bn-status-err';
          resetScanButton();
        }
        scanPromise = null;
      });
    }

    function handleScanResult(resp) {
      if (!resp || !resp.ok) {
        let errMsg = '扫描失败: ' + (resp?.error || '未知错误');
        if (resp?._html) {
          errMsg += '\n\n服务器返回的 HTML:\n' + resp._html;
        }
        clearStatus.textContent = errMsg;
        clearStatus.className = 'bn-clear-history-status bn-status-err';
        resetScanButton();
        return;
      }

      const count = resp.sessionIds.length;
      scannedSessionIds = resp.sessionIds;

      if (resp.aborted) {
        if (count === 0) {
          clearStatus.textContent = '扫描已停止，已检查部分对话，未发现插件生成的对话';
          clearStatus.className = 'bn-clear-history-status bn-status-ok';
        } else {
          clearStatus.innerHTML = `扫描已停止，发现 <b>${count}</b> 次插件生成的对话<br><button class="bn-setting-btn bn-btn-danger" id="bn-clear-sessions-btn" style="margin-top:8px">确认删除 ${count} 次对话</button>`;
          clearStatus.className = 'bn-clear-history-status bn-status-warn';
          bindDeleteButton(clearStatus);
        }
        resetScanButton();
        return;
      }

      if (count === 0) {
        clearStatus.textContent = `已扫描 ${resp.total} 次对话，未发现插件生成的对话`;
        clearStatus.className = 'bn-clear-history-status bn-status-ok';
      } else {
        clearStatus.innerHTML = `已扫描 ${resp.total} 次对话，发现 <b>${count}</b> 次插件生成的对话<br><button class="bn-setting-btn bn-btn-danger" id="bn-clear-sessions-btn" style="margin-top:8px">确认删除 ${count} 次对话</button>`;
        clearStatus.className = 'bn-clear-history-status bn-status-warn';
        bindDeleteButton(clearStatus);
      }
      resetScanButton();
    }

    function resetScanButton() {
      isScanning = false;
      scanSessionsBtn.textContent = BTN_DEFAULT;
      scanSessionsBtn.classList.remove('bn-btn-danger');
      scanSessionsBtn.disabled = false;
      scanProgressEl.style.display = 'none';
    }

    function bindDeleteButton(container) {
      const clearBtn = container.querySelector('#bn-clear-sessions-btn');
      if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
          clearBtn.disabled = true;
          clearBtn.textContent = '正在删除...';
          try {
            const delResp = await chrome.runtime.sendMessage({
              type: 'ds-delete-sessions',
              sessionIds: scannedSessionIds
            });
            if (!delResp || !delResp.ok) {
              clearStatus.innerHTML = '删除失败: ' + (delResp?.error || '未知错误');
              clearStatus.className = 'bn-clear-history-status bn-status-err';
            } else {
              clearStatus.innerHTML = `已删除 ${delResp.deleted} 次对话` + (delResp.failed ? `，${delResp.failed} 次失败` : '');
              clearStatus.className = 'bn-clear-history-status bn-status-ok';
              scannedSessionIds = [];
            }
          } catch (e) {
            clearStatus.innerHTML = '删除请求失败: ' + e.message;
            clearStatus.className = 'bn-clear-history-status bn-status-err';
          }
        });
      }
    }

    // 字幕语言切换
    const langSelect = panelEl.querySelector('#bn-lang-select');
    if (langSelect) {
      langSelect.addEventListener('change', () => {
        const url = langSelect.value;
        const lang = langSelect.options[langSelect.selectedIndex]?.dataset?.lang || '';
        if (url && window.BiliSummary.subtitle) {
          window.BiliSummary.subtitle.switchSubtitle(url, lang);
        }
      });
    }

    // ── 通用 API 配置 ──
    bindApiConfigEvents();
  }

  function bindApiConfigEvents() {
    const providers = window.BiliSummary.AI_PROVIDERS;
    const providerSelect = panelEl.querySelector('#bn-api-provider');
    const epEl = panelEl.querySelector('#bn-api-endpoint');
    const keyEl = panelEl.querySelector('#bn-api-key');
    const modelSelect = panelEl.querySelector('#bn-api-model-select');
    const modelInput = panelEl.querySelector('#bn-api-model-input');
    const fetchBtn = panelEl.querySelector('#bn-api-fetch-models');
    const apiStatus = panelEl.querySelector('#bn-api-status');
    const streamEl = panelEl.querySelector('#bn-api-stream');
    const hintEl = panelEl.querySelector('#bn-api-provider-hint');
    const keyLink = panelEl.querySelector('#bn-api-key-link');

    if (providerSelect && providers) {
      providerSelect.innerHTML = providers.list
        .map(p => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.label)}</option>`)
        .join('');
    }

    const savedChannel = window.BiliSummary.state.settings.aiChannel || 'api';
    const browserRadio = panelEl.querySelector('#bn-as-browser');
    const apiRadio = panelEl.querySelector('#bn-as-api');
    if (browserRadio && apiRadio) {
      browserRadio.checked = (savedChannel === 'browser');
      apiRadio.checked = (savedChannel === 'api');
    }

    // AI 总结通道选择
    panelEl.querySelectorAll('input[name="bn-ai-channel-setting"]').forEach(r => {
      r.addEventListener('change', () => {
        window.BiliSummary.state.settings.aiChannel = r.value;
        window.BiliSummary.settings.save();
        refreshAiStatusUI();
      });
    });
    // AI 模式切换（DeepSeek 浏览器 SDK）
    panelEl.querySelectorAll('input[name="bn-ai-mode"]').forEach(r => {
      r.addEventListener('change', () => {
        window.BiliSummary.state.settings.aiMode = r.value;
        window.BiliSummary.settings.save();
      });
    });
    // 恢复已保存的模式
    const savedMode = window.BiliSummary.state.settings.aiMode || 'fast';
    const modeRadio = panelEl.querySelector(`input[name="bn-ai-mode"][value="${savedMode}"]`);
    if (modeRadio) modeRadio.checked = true;

    function modelOptions(provider) {
      if (fetchedModels && fetchedModels.length) return fetchedModels;
      return (provider && provider.models) || [];
    }

    // 模型下拉：预设模型为默认项，获取到的在线列表优先展示
    function renderModelSelect(provider, currentModel) {
      if (!modelSelect) return;
      const models = modelOptions(provider);
      if (!models.length) {
        modelSelect.innerHTML = '<option value="">-- 获取模型列表或手动输入 --</option>';
        modelSelect.value = '';
        return;
      }
      const options = models.map(m => {
        const label = m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id;
        return `<option value="${escapeAttr(m.id)}">${escapeHtml(label)}</option>`;
      });
      const matched = models.find(m => m.id === currentModel)
        || models.find(m => m.id === (provider && provider.model))
        || (models.length === 1 ? models[0] : null);
      if (!matched && !provider.lockModel) {
        options.unshift('<option value="">-- 选择模型 --</option>');
      }
      if (!provider.lockModel) {
        options.push('<option value="__manual__">-- 手动输入其他模型 ID --</option>');
      }
      modelSelect.innerHTML = options.join('');
      modelSelect.value = matched ? matched.id : '';
    }

    // 把保存的设置渲染到设置页
    function renderApiConfig() {
      const s = window.BiliSummary.state.settings;
      const cfg = s.apiCfg || {};
      const provider = getApiProvider();
      if (providerSelect && providerSelect.value !== provider.id) providerSelect.value = provider.id;
      if (epEl) {
        epEl.value = cfg.endpoint || provider.endpoint || '';
        epEl.readOnly = !!provider.lockEndpoint;
        epEl.classList.toggle('bn-input-locked', !!provider.lockEndpoint);
      }
      if (keyEl) {
        keyEl.value = cfg.apiKey || '';
        keyEl.placeholder = provider.keyPlaceholder || 'sk-...';
      }
      if (modelInput) {
        modelInput.value = cfg.model || provider.model || '';
        modelInput.readOnly = !!provider.lockModel;
        modelInput.classList.toggle('bn-input-locked', !!provider.lockModel);
        // 固定模型的服务商只用下拉选择，隐藏重复的只读输入框
        modelInput.style.display = provider.lockModel ? 'none' : '';
      }
      if (streamEl) streamEl.checked = cfg.stream !== false;
      if (hintEl) hintEl.textContent = provider.description || '';
      if (keyLink) {
        const visible = !!provider.keyUrl;
        keyLink.style.display = visible ? '' : 'none';
        if (visible) {
          keyLink.href = provider.keyUrl;
          keyLink.textContent = provider.keyLabel || '获取 API Key ↗';
        }
      }
      renderModelSelect(provider, cfg.model || provider.model);
      renderApiUsage();
    }

    function saveCfg() {
      const provider = getApiProvider();
      const endpoint = provider.lockEndpoint
        ? provider.endpoint
        : ((epEl && epEl.value.trim()) || provider.endpoint || '');
      const model = (modelInput && modelInput.value.trim()) || provider.model || '';
      const apiKey = (keyEl && keyEl.value.trim()) || '';
      const settings = window.BiliSummary.state.settings;
      settings.apiProvider = provider.id;
      settings.apiKeys = { ...(settings.apiKeys || {}), [provider.id]: apiKey };
      settings.apiCfg = {
        provider: provider.id,
        endpoint,
        apiKey,
        model,
        stream: streamEl ? streamEl.checked : true,
      };
      window.BiliSummary.settings.save();
    }

    // 切换服务商预设：OpenCode Go 固定 Endpoint 与模型
    function applyProvider(provider) {
      if (!provider) return;
      const s = window.BiliSummary.state.settings;
      const current = getApiProvider();
      // 先记住当前服务商的 Key，再取出目标服务商自己的 Key（避免把 Key 发给别家）
      const keyMap = { ...(s.apiKeys || {}) };
      if (keyEl && current.id) keyMap[current.id] = keyEl.value.trim();
      fetchedModels = null;
      s.apiProvider = provider.id;
      s.apiKeys = keyMap;
      s.apiCfg = {
        provider: provider.id,
        endpoint: provider.endpoint,
        apiKey: keyMap[provider.id] || '',
        model: provider.model,
        stream: streamEl ? streamEl.checked : true,
      };
      renderApiConfig();
      window.BiliSummary.settings.save();
      if (apiStatus) apiStatus.textContent = '';
      refreshAiStatusUI();
    }

    if (providerSelect && providers) {
      providerSelect.addEventListener('change', () => {
        const provider = providers.get(providerSelect.value);
        if (provider) applyProvider(provider);
      });
    }

    // endpoint / key / model / stream 变化自动保存
    [epEl, keyEl, modelInput, streamEl].forEach(el => {
      if (!el) return;
      el.addEventListener('change', () => { saveCfg(); refreshAiStatusUI(); });
      el.addEventListener('blur', () => { saveCfg(); });
    });

    // model select → input
    if (modelSelect) {
      modelSelect.addEventListener('change', () => {
        const v = modelSelect.value;
        if (v && v !== '__manual__') {
          modelInput.value = v;
          saveCfg();
          refreshAiStatusUI();
        } else if (v === '__manual__') {
          // 切回保留当前用户输入的模型，不做修改
          modelSelect.value = modelInput.value || '';
          modelSelect.blur();
        }
      });
    }

    // 测试连接 / 获取模型列表
    if (fetchBtn) {
      fetchBtn.addEventListener('click', async () => {
        const provider = getApiProvider();
        const originalText = fetchBtn.textContent;
        fetchBtn.disabled = true;
        fetchBtn.textContent = '请求中…';
        if (apiStatus) apiStatus.textContent = '';
        try {
          const endpoint = provider.lockEndpoint ? provider.endpoint : ((epEl && epEl.value.trim()) || provider.endpoint);
          const models = await window.BiliSummary.apiAI.fetchModels(endpoint, keyEl ? keyEl.value.trim() : '', provider.id);
          if (!models || models.length === 0) {
            if (apiStatus) apiStatus.textContent = '连接正常，但该接口未返回模型列表';
          } else {
            fetchedModels = models;
            renderModelSelect(provider, (modelInput && modelInput.value.trim()) || provider.model);
            if (apiStatus) apiStatus.textContent = `连接正常 · 返回 ${models.length} 个模型`;
          }
        } catch (err) {
          fetchedModels = null;
          if (apiStatus) apiStatus.textContent = '失败：' + (err.message || err);
        } finally {
          fetchBtn.disabled = false;
          fetchBtn.textContent = originalText;
        }
      });
    }

    renderApiConfigUI = renderApiConfig;
    renderApiConfig();
  }

  function getDefaultAiPrompt() {
    return window.BiliSummary.DEFAULT_PROMPT;
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  // ── 加载设置到 UI ──

  function loadSettingsToUI() {
    const s = window.BiliSummary.state.settings;
    const setRadio = (name, value) => {
      const r = panelEl.querySelector(`input[name="${name}"][value="${value}"]`);
      if (r) r.checked = true;
    };
    setRadio('bn-fontSize', s.fontSize);
    setRadio('bn-lineHeight', s.lineHeight);

    const autoScrollEl = panelEl.querySelector('#bn-auto-scroll');
    if (autoScrollEl) autoScrollEl.checked = s.autoScroll;

    const darkModeEl = panelEl.querySelector('#bn-dark-mode');
    if (darkModeEl) darkModeEl.checked = s.darkMode;

    const autoSummaryEl = panelEl.querySelector('#bn-auto-summary');
    if (autoSummaryEl) autoSummaryEl.checked = s.autoSummary !== false;

    // AI 接口配置（服务商预设 / Endpoint / API Key / 模型 / 用量）
    if (renderApiConfigUI) renderApiConfigUI();

    // AI 总结通道
    const savedChannel = s.aiChannel || 'api';
    const browserRadio = panelEl.querySelector('#bn-as-browser');
    const apiRadio = panelEl.querySelector('#bn-as-api');
    if (browserRadio && apiRadio) {
      browserRadio.checked = (savedChannel === 'browser');
      apiRadio.checked = (savedChannel === 'api');
    }

    // AI 模式
    const savedMode = s.aiMode || 'fast';
    const modeRadio = panelEl.querySelector(`input[name="bn-ai-mode"][value="${savedMode}"]`);
    if (modeRadio) modeRadio.checked = true;
  }

  // ── 应用显示设置 ──

  function applyDisplaySettings() {
    if (!panelEl) return;
    const s = window.BiliSummary.state.settings;
    const sizeMap = { small: '12px', default: '13px', medium: '14px', large: '15px' };
    const lineMap = { narrow: '1.4', standard: '1.5', wide: '1.8' };
    panelEl.style.setProperty('--bn-font-size', sizeMap[s.fontSize] || '13px');
    panelEl.style.setProperty('--bn-line-height', lineMap[s.lineHeight] || '1.5');
  }

  // ── 标签页切换 ──

  function switchTab(tabId) {
    const s = window.BiliSummary.state;
    s.activeTab = tabId;

    tabs.forEach(t => {
      t.btn.classList.toggle('bn-active', t.id === tabId);
    });

    Object.keys(views).forEach(id => {
      views[id].classList.toggle('bn-show', id === tabId);
    });

    // footer 只在字幕页显示
    const tabDef = TAB_DEFS.find(d => d.id === tabId);
    footerEl.classList.toggle('bn-show', tabDef?.footer || false);

    // 切换到 AI 总结页时刷新状态
    if (tabId === 'ai' && aiStatusEl) {
      refreshAiStatusUI();
    }
  }

  // ── 拖动 ──

  function setupDrag(handle) {
    let isDragging = false;
    let offsetX = 0, offsetY = 0;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('bn-tab') || e.target.classList.contains('bn-arrow') || e.target.classList.contains('bn-minimize')) return;
      isDragging = true;
      const rect = panelEl.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      let x = e.clientX - offsetX;
      let y = e.clientY - offsetY;
      const rect = panelEl.getBoundingClientRect();
      x = Math.max(20, Math.min(x, window.innerWidth - rect.width - 20));
      y = Math.max(20, Math.min(y, window.innerHeight - rect.height - 20));
      panelEl.style.left = x + 'px';
      panelEl.style.top = y + 'px';
      panelEl.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  // ── Footer 按钮 ──

  function onFooterClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'refresh') {
      if (window.BiliSummary.subtitle) window.BiliSummary.subtitle.refresh();
    } else if (action === 'copy') {
      if (window.BiliSummary.subtitle) window.BiliSummary.subtitle.copyText();
    } else if (action === 'export-srt') {
      if (window.BiliSummary.exportUtil) window.BiliSummary.exportUtil.downloadSrt();
    }
  }

  // ── 显示/隐藏面板 ──

  function show() {
    if (!panelEl) createPanel();
    panelEl.classList.remove('bn-hidden');
    window.BiliSummary.state.panelVisible = true;
    if (window.BiliSummary.floatIcon?.hide) window.BiliSummary.floatIcon.hide();
    loadSettingsToUI();
    applyDisplaySettings();
    // 自动加载字幕
    const s = window.BiliSummary.state;
    const currentBvid = window.BiliSummary.subtitle?.extractBvid(location.href) || '';
    const currentPage = window.BiliSummary.subtitle?.extractPageIndex(location.href) || 1;
    if (window.BiliSummary.subtitle && (!s.bvid || s.bvid !== currentBvid || currentPage !== (s.pageIndex || 1))) {
      window.BiliSummary.subtitle.refresh();
    }
    autoSummarizeIfReady();
  }

  function hide() {
    if (panelEl) {
      panelEl.classList.add('bn-hidden');
      window.BiliSummary.state.panelVisible = false;
    }
    stopAiLoginPoll();
    if (window.BiliSummary.floatIcon?.update) window.BiliSummary.floatIcon.update();
  }

  function toggle() {
    if (window.BiliSummary.state.panelVisible) hide();
    else show();
  }

  function minimize() {
    hide();
  }

  // ── 更新字幕语言下拉 ──

  function updateSubtitleSelect(subtitles, selectedUrl) {
    const select = panelEl?.querySelector('#bn-lang-select');
    if (!select) return;
    if (!subtitles || subtitles.length === 0) {
      select.innerHTML = '<option value="">暂无字幕</option>';
      select.disabled = true;
      return;
    }
    select.innerHTML = subtitles.map(item => {
      const aiTag = item.lan?.startsWith('ai-') ? ' [AI]' : '';
      const label = `${item.lanDoc || item.lan}${aiTag}`;
      const selected = item.subtitleUrl === selectedUrl ? 'selected' : '';
      return `<option value="${escapeHtml(item.subtitleUrl)}" data-lang="${escapeHtml(item.lan)}" ${selected}>${escapeHtml(label)}</option>`;
    }).join('');
    select.disabled = false;
  }

  // ── 窗口调整 ──

  function setupResize(panel, handle) {
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = panel.getBoundingClientRect();
      resizeData = {
        startX: e.clientX,
        startY: e.clientY,
        startW: rect.width,
        startH: rect.height,
        startRight: rect.right,
      };
      document.addEventListener("mousemove", onResizeMove);
      document.addEventListener("mouseup", onResizeEnd);
    });
  }

  function calculateLeftResizeGeometry(data, clientX, viewportWidth) {
    const minWidth = 320;
    const viewportMargin = 20;
    const dx = clientX - data.startX;
    const maxWidth = Math.max(
      minWidth,
      Math.min(viewportWidth * 0.9, data.startRight - viewportMargin),
    );
    const width = Math.max(minWidth, Math.min(data.startW - dx, maxWidth));
    return { width, left: data.startRight - width };
  }

  function onResizeMove(e) {
    if (!resizeData) return;
    const panel = panelEl;
    if (!panel) return;
    const dy = e.clientY - resizeData.startY;
    // 左下角手柄：向右拖（dx>0）宽度减小，向左拖（dx<0）宽度增大
    const horizontal = calculateLeftResizeGeometry(resizeData, e.clientX, window.innerWidth);
    let newW = horizontal.width;
    let newH = Math.max(400, Math.min(resizeData.startH + dy, window.innerHeight - 40));
    panel.style.width = newW + "px";
    panel.style.height = newH + "px";
    // 左下角缩放时固定拖动开始时的右边界，避免右侧随宽度向右漂移
    panel.style.left = horizontal.left + "px";
    panel.style.right = "auto";
    panel.style.top = Math.min(parseInt(panel.style.top) || 100, window.innerHeight - newH - 20) + "px";
  }

  function onResizeEnd() {
    resizeData = null;
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeEnd);
  }

  // ── Toast ──

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'bn-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  // ── 公开接口 ──

  window.BiliSummary.panel = {
    create: createPanel,
    show,
    hide,
    toggle,
    minimize,
    switchTab,
    updateSubtitleSelect,
    showToast,
    getPanelEl: () => panelEl,
    getScrollWrap: () => panelEl?.querySelector('.bn-scroll'),
    loadSettingsToUI,
  };
  if (window.BiliSummary.__testHooks) {
    window.BiliSummary.__testHooks.calculateLeftResizeGeometry = calculateLeftResizeGeometry;
    window.BiliSummary.__testHooks.formatApiUsage = formatApiUsage;
    window.BiliSummary.__testHooks.getApiProvider = getApiProvider;
    window.BiliSummary.__testHooks.buildSettingHTML = buildSettingHTML;
  }
})();
