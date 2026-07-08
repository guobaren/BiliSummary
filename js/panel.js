/**
 * BiliSumi Panel Module
 * 三标签页：字幕 / AI 总结 / 设置
 */
(function () {
  'use strict';

  window.BiViNote = window.BiViNote || {};

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

  const TAB_DEFS = [
    { id: 'ai', label: 'AI 总结', footer: false },
    { id: 'subtitle', label: '字幕', footer: true },
    { id: 'setting', label: '设置', footer: false }
  ];

  // ── 创建面板 ──

  function createPanel() {
    const s = window.BiViNote.state;

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
    minimizeBtn.addEventListener('click', () => window.BiViNote.panel.minimize());
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
    footerEl.className = 'bn-footer bn-show';
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
      window.BiViNote.deepseek.openLogin();
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
    if (window.BiViNote.deepseek) {
      window.BiViNote.deepseek.checkLogin().then(() => refreshAiStatusUI());
    }
  }

  function startAiLoginPoll() {
    stopAiLoginPoll();
    let attempts = 0;
    aiLoginPollTimer = setInterval(async () => {
      attempts++;
      if (!window.BiViNote.deepseek) return;
      await window.BiViNote.deepseek.checkLogin();
      if (window.BiViNote.deepseek.getState() === 'ready' || attempts >= 15) {
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
    const ds = window.BiViNote.deepseek;
    if (!ds) return;
    ds.onStateChange((s) => {
      if ((window.BiViNote.state.settings.aiChannel || 'browser') !== 'browser') return;
      refreshAiStatusUI(s);
    });
    ds.onChunk((chunk) => {
      if ((window.BiViNote.state.settings.aiChannel || 'browser') !== 'browser') return;
      appendAiStreamChunk(chunk);
    });
    ds.onDone(() => {
      if ((window.BiViNote.state.settings.aiChannel || 'browser') !== 'browser') return;
      onAiStreamDone();
    });
    ds.onError((err) => {
      if ((window.BiViNote.state.settings.aiChannel || 'browser') !== 'browser') return;
      onAiStreamError(err);
    });
  }

  function bindAiApiChannelEvents() {
    const api = window.BiViNote.apiAI;
    if (!api) return;
    api.onStateChange((s) => {
      if ((window.BiViNote.state.settings.aiChannel || 'browser') !== 'api') return;
      refreshAiStatusUI(s);
    });
    api.onChunk((chunk) => {
      if ((window.BiViNote.state.settings.aiChannel || 'browser') !== 'api') return;
      appendAiStreamChunk(chunk);
    });
    api.onDone(() => {
      if ((window.BiViNote.state.settings.aiChannel || 'browser') !== 'api') return;
      onAiStreamDone();
    });
    api.onError((err) => {
      if ((window.BiViNote.state.settings.aiChannel || 'browser') !== 'api') return;
      onAiStreamError(err);
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
      return window.BiViNote.deepseek.getResult();
    }
    return { think: aiThinkEl?.textContent?.trim() || '', response: aiResultEl?.textContent?.trim() || '' };
  }

  function getActiveChannel() {
    return window.BiViNote.state.settings.aiChannel || 'browser';
  }

  async function onAiActionClick() {
    if (getActiveChannel() === 'browser') {
      const ds = window.BiViNote.deepseek;
      const st = ds.getState();
      if (st === 'not_logged_in') {
        refreshAiStatusUI('not_logged_in');
        return;
      }
      if (st === 'reading' || st === 'responding') {
        ds.abort();
        return;
      }
      if (st === 'ready' || st === 'error' || st === 'done') {
        startAiSummary();
      }
    } else {
      const api = window.BiViNote.apiAI;
      const st = api.getState();
      if (st === 'sending' || st === 'responding') {
        api.abort();
        return;
      }
      startAiSummary();
    }
  }

  function onAiStopClick() {
    if (getActiveChannel() === 'browser') window.BiViNote.deepseek.abort();
    else window.BiViNote.apiAI.abort();
  }

  function onAiCopyClick() {
    const text = aiResultRaw || getAiResult().response || '';
    if (text) navigator.clipboard.writeText(text).then(() => showToast('已复制'));
  }

  function onAiClearClick() {
    if (getActiveChannel() === 'browser') {
      window.BiViNote.deepseek.clear();
    } else {
      window.BiViNote.apiAI.clear();
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
      window.BiViNote.deepseek.sendMarkdown(text, '');
    } else {
      aiMessages.push({ role: 'user', content: text });
      sendAiApiMessages();
    }
  }

  function startAiSummary() {
    const s = window.BiViNote.state;
    if (!s.subtitleBody || s.subtitleBody.length === 0) {
      showToast('当前无字幕，无法总结');
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
      window.BiViNote.deepseek.clear();
      const videoContext = buildAiVideoContext();
      const prompt = s.settings.deepseekPrompt || '';
      window.BiViNote.deepseek.sendMarkdown(videoContext, prompt);
    } else {
      aiMessages = [
        { role: 'system', content: buildAiSystemPrompt() },
        { role: 'user', content: buildAiVideoContext() },
      ];
      sendAiApiMessages();
    }
  }

  function sendAiApiMessages() {
    const cfg = window.BiViNote.state.settings.apiCfg || {};
    window.BiViNote.apiAI.sendToApi(aiMessages, {
      endpoint: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: cfg.model,
      stream: cfg.stream,
    });
  }

  function buildAiSystemPrompt() {
    const s = window.BiViNote.state;
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
    const s = window.BiViNote.state;
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
    const channel = window.BiViNote.state.settings.aiChannel || 'browser';

    let st = forceState;
    if (!st) {
      st = channel === 'browser' ? window.BiViNote.deepseek.getState() : window.BiViNote.apiAI.getState();
    }

    // 顶部状态行 & 通道标签
    const cfg = window.BiViNote.state.settings.apiCfg || {};
    if (aiChannelTagEl) {
      aiChannelTagEl.textContent = channel === 'browser' ? 'DeepSeek 浏览器' : '自定义接口';
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
      // 自定义接口：检查是否配置了必要信息
      const hasCfg = !!(cfg.apiKey && cfg.endpoint && cfg.model);
      if (!hasCfg) {
        loginNotice = '尚未配置 API Key / Endpoint / 模型，请先到「设置」页配置。';
        statusLineText = '未配置';
        statusLineCls = 'bn-ai-status-warn';
      } else if (st === 'idle' || !st) {
        statusLineText = `就绪 · ${cfg.model}`;
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
        <button class="bn-setting-btn" id="bn-reset-btn">恢复默认设置</button>

        <div class="bn-setting-label" style="margin-top:16px">AI 总结通道</div>
        <label class="bn-radio-line">
          <input type="radio" name="bn-ai-channel-setting" id="bn-as-browser" value="browser">
          <div><div class="bn-radio-title">DeepSeek（浏览器 SDK）</div><div class="bn-radio-desc">登录 chat.deepseek.com 后使用；需安装并保持登录状态</div></div>
        </label>
        <label class="bn-radio-line">
          <input type="radio" name="bn-ai-channel-setting" id="bn-as-api" value="api">
          <div><div class="bn-radio-title">自定义接口（OpenAI 兼容）</div><div class="bn-radio-desc">使用下面配置的 Endpoint / API Key / 模型，绕过浏览器 SDK 直接调用</div></div>
        </label>

        <div class="bn-setting-label" style="margin-top:16px">通用 AI API 配置（用于「自定义接口」通道）</div>
        <div class="bn-api-config">
          <div class="bn-field-row">
            <label>Endpoint</label>
            <input type="text" id="bn-api-endpoint" class="bn-input" placeholder="https://api.deepseek.com/v1/chat/completions">
          </div>
          <div class="bn-field-row">
            <label>API Key</label>
            <input type="password" id="bn-api-key" class="bn-input" placeholder="sk-...">
          </div>
          <div class="bn-field-row">
            <label>模型</label>
            <div class="bn-model-row">
              <select id="bn-api-model-select" class="bn-select bn-model-select">
                <option value="">-- 点击选择模型 --</option>
              </select>
              <input type="text" id="bn-api-model-input" class="bn-input bn-model-input" placeholder="deepseek-v4-flash">
            </div>
          </div>
          <div class="bn-field-row">
            <button id="bn-api-fetch-models" class="bn-btn-secondary">获取模型列表</button>
            <span id="bn-api-status" class="bn-api-status"></span>
          </div>
          <div class="bn-field-row">
            <label class="bn-checkbox-row">
              <input type="checkbox" id="bn-api-stream" checked>
              <span>使用流式输出（SSE）</span>
            </label>
          </div>
        </div>

        <div class="bn-about">
          <div class="bn-about-divider"></div>
          <div class="bn-about-version">BiliSumi <span id="bn-version"></span></div>
          <a class="bn-about-link" href="https://github.com/hyglgithub/BiViNote/releases" target="_blank">GitHub Releases ↗</a>
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
        window.BiViNote.state.settings.fontSize = r.value;
        applyDisplaySettings();
        window.BiViNote.settings.save();
      });
    });

    // 行高
    panelEl.querySelectorAll('input[name="bn-lineHeight"]').forEach(r => {
      r.addEventListener('change', () => {
        window.BiViNote.state.settings.lineHeight = r.value;
        applyDisplaySettings();
        window.BiViNote.settings.save();
      });
    });

    // 自动滚动
    const autoScrollEl = panelEl.querySelector('#bn-auto-scroll');
    if (autoScrollEl) {
      autoScrollEl.addEventListener('change', () => {
        window.BiViNote.state.settings.autoScroll = autoScrollEl.checked;
        window.BiViNote.settings.save();
      });
    }

    // 夜间模式
    const darkModeEl = panelEl.querySelector('#bn-dark-mode');
    if (darkModeEl) {
      darkModeEl.addEventListener('change', () => {
        window.BiViNote.state.settings.darkMode = darkModeEl.checked;
        const theme = darkModeEl.checked ? 'dark' : '';
        panelEl.setAttribute('data-bn-theme', theme);
        window.BiViNote.settings.save();
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
      const stored = window.BiViNote.state.settings[info.key];
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
        window.BiViNote.state.settings[info.key] = textarea.value;
        window.BiViNote.settings.save();
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
        window.BiViNote.state.settings[info.key] = '';
        textarea.value = getDefaultAiPrompt();
        window.BiViNote.settings.save();
        showToast('已重置为默认提示词');
      }
    });

    // 恢复默认
    const resetBtn = panelEl.querySelector('#bn-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        window.BiViNote.settings.resetDefaults();
        loadSettingsToUI();
        applyDisplaySettings();
        panelEl.setAttribute('data-bn-theme', '');
        showToast('已恢复默认设置');
      });
    }

    // 字幕语言切换
    const langSelect = panelEl.querySelector('#bn-lang-select');
    if (langSelect) {
      langSelect.addEventListener('change', () => {
        const url = langSelect.value;
        const lang = langSelect.options[langSelect.selectedIndex]?.dataset?.lang || '';
        if (url && window.BiViNote.subtitle) {
          window.BiViNote.subtitle.switchSubtitle(url, lang);
        }
      });
    }

    // ── 通用 API 配置 ──
    bindApiConfigEvents();
  }

  function bindApiConfigEvents() {
    const epEl = panelEl.querySelector('#bn-api-endpoint');
    const keyEl = panelEl.querySelector('#bn-api-key');
    const modelSelect = panelEl.querySelector('#bn-api-model-select');
    const modelInput = panelEl.querySelector('#bn-api-model-input');
    const fetchBtn = panelEl.querySelector('#bn-api-fetch-models');
    const apiStatus = panelEl.querySelector('#bn-api-status');
    const streamEl = panelEl.querySelector('#bn-api-stream');

    // 加载已保存的值
    const cfg = window.BiViNote.state.settings.apiCfg || {};
    const savedChannel = window.BiViNote.state.settings.aiChannel || 'browser';
    const browserRadio = panelEl.querySelector('#bn-as-browser');
    const apiRadio = panelEl.querySelector('#bn-as-api');
    if (browserRadio && apiRadio) {
      browserRadio.checked = (savedChannel === 'browser');
      apiRadio.checked = (savedChannel === 'api');
    }
    // AI 总结「自定义接口」通道选择
    panelEl.querySelectorAll('input[name="bn-ai-channel-setting"]').forEach(r => {
      r.addEventListener('change', () => {
        window.BiViNote.state.settings.aiChannel = r.value;
        window.BiViNote.settings.save();
      });
    });

    if (epEl) epEl.value = cfg.endpoint || 'https://api.deepseek.com/v1/chat/completions';
    if (keyEl) keyEl.value = cfg.apiKey || '';
    if (modelInput) modelInput.value = cfg.model || 'deepseek-chat';
    if (streamEl) streamEl.checked = cfg.stream !== false;

    function saveCfg() {
      const newCfg = {
        endpoint: epEl.value.trim(),
        apiKey: keyEl.value.trim(),
        model: modelInput.value.trim(),
        stream: streamEl.checked,
      };
      window.BiViNote.state.settings.apiCfg = newCfg;
      window.BiViNote.settings.save();
    }

    // endpoint / key / model / stream 变化自动保存
    [epEl, keyEl, modelInput, streamEl].forEach(el => {
      if (!el) return;
      el.addEventListener('change', saveCfg);
      el.addEventListener('blur', saveCfg);
    });

    // model select → input
    if (modelSelect) {
      modelSelect.addEventListener('change', () => {
        const v = modelSelect.value;
        if (v && v !== '__manual__') {
          modelInput.value = v;
          saveCfg();
        } else if (v === '__manual__') {
          // 切回保留当前用户输入的模型，不做修改
          modelSelect.value = modelInput.value || '';
        }
      });
    }

    // 获取模型列表
    if (fetchBtn) {
      fetchBtn.addEventListener('click', async () => {
        fetchBtn.disabled = true;
        fetchBtn.textContent = '获取中…';
        apiStatus.textContent = '';
        try {
          const models = await window.BiViNote.apiAI.fetchModels(epEl.value.trim(), keyEl.value.trim());
          if (!models || models.length === 0) {
            apiStatus.textContent = '该接口未返回模型列表';
            fetchBtn.disabled = false;
            fetchBtn.textContent = '获取模型列表';
            return;
          }
          // 填充下拉；把占位项放最前并默认选中，保证后续任意选择都触发 change
          modelSelect.innerHTML =
            '<option value="">-- 点击选择模型 --</option>' +
            models.map(m => {
              const label = m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id;
              return `<option value="${escapeAttr(m.id)}">${escapeHtml(label)}</option>`;
            }).join('') +
            '<option value="__manual__">-- 手动输入其他模型 ID --</option>';
          // 如有已配置模型，选中它（但仍保持 select 当前指向占位项，强制用户一次有效选择）
          modelSelect.value = '';
          apiStatus.textContent = `已获取 ${models.length} 个模型`;
        } catch (err) {
          apiStatus.textContent = '获取失败：' + (err.message || err);
          modelSelect.innerHTML = '<option value="">获取失败</option>';
        } finally {
          fetchBtn.disabled = false;
          fetchBtn.textContent = '获取模型列表';
        }
      });
    }
  }

  function getDefaultAiPrompt() {
    return `你是一个视频内容总结助手，根据用户提供的字幕文本生成结构化、易读的视频总结。

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

直接输出整理后的内容，不要输出任何额外说明文字。`;
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
    const s = window.BiViNote.state.settings;
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

    // 通用 API 配置
    const cfg = s.apiCfg || {};
    const epEl = panelEl.querySelector('#bn-api-endpoint');
    const keyEl = panelEl.querySelector('#bn-api-key');
    const modelInput = panelEl.querySelector('#bn-api-model-input');
    const streamEl = panelEl.querySelector('#bn-api-stream');
    if (epEl) epEl.value = cfg.endpoint || 'https://api.deepseek.com/v1/chat/completions';
    if (keyEl) keyEl.value = cfg.apiKey || '';
    if (modelInput) modelInput.value = cfg.model || 'deepseek-v4-flash';
    if (streamEl) streamEl.checked = cfg.stream !== false;

    // AI 总结通道
    const savedChannel = s.aiChannel || 'browser';
    const browserRadio = panelEl.querySelector('#bn-as-browser');
    const apiRadio = panelEl.querySelector('#bn-as-api');
    if (browserRadio && apiRadio) {
      browserRadio.checked = (savedChannel === 'browser');
      apiRadio.checked = (savedChannel === 'api');
    }
  }

  // ── 应用显示设置 ──

  function applyDisplaySettings() {
    if (!panelEl) return;
    const s = window.BiViNote.state.settings;
    const sizeMap = { small: '12px', default: '13px', medium: '14px', large: '15px' };
    const lineMap = { narrow: '1.4', standard: '1.5', wide: '1.8' };
    panelEl.style.setProperty('--bn-font-size', sizeMap[s.fontSize] || '13px');
    panelEl.style.setProperty('--bn-line-height', lineMap[s.lineHeight] || '1.5');
  }

  // ── 标签页切换 ──

  function switchTab(tabId) {
    const s = window.BiViNote.state;
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
      if (window.BiViNote.subtitle) window.BiViNote.subtitle.refresh();
    } else if (action === 'copy') {
      if (window.BiViNote.subtitle) window.BiViNote.subtitle.copyText();
    } else if (action === 'export-srt') {
      if (window.BiViNote.exportUtil) window.BiViNote.exportUtil.downloadSrt();
    }
  }

  // ── 显示/隐藏面板 ──

  function show() {
    if (!panelEl) createPanel();
    panelEl.classList.remove('bn-hidden');
    window.BiViNote.state.panelVisible = true;
    if (window.BiViNote.floatIcon?.hide) window.BiViNote.floatIcon.hide();
    loadSettingsToUI();
    applyDisplaySettings();
    // 自动加载字幕
    const s = window.BiViNote.state;
    const currentBvid = window.BiViNote.subtitle?.extractBvid(location.href) || '';
    const currentPage = window.BiViNote.subtitle?.extractPageIndex(location.href) || 1;
    if (window.BiViNote.subtitle && (!s.bvid || s.bvid !== currentBvid || currentPage !== (s.pageIndex || 1))) {
      window.BiViNote.subtitle.refresh();
    }
  }

  function hide() {
    if (panelEl) {
      panelEl.classList.add('bn-hidden');
      window.BiViNote.state.panelVisible = false;
    }
    stopAiLoginPoll();
    if (window.BiViNote.floatIcon?.update) window.BiViNote.floatIcon.update();
  }

  function toggle() {
    if (window.BiViNote.state.panelVisible) hide();
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
      };
      document.addEventListener("mousemove", onResizeMove);
      document.addEventListener("mouseup", onResizeEnd);
    });
  }

  function onResizeMove(e) {
    if (!resizeData) return;
    const panel = panelEl;
    if (!panel) return;
    const dx = e.clientX - resizeData.startX;
    const dy = e.clientY - resizeData.startY;
    // 左下角手柄：向右拖（dx>0）宽度减小，向左拖（dx<0）宽度增大
    let newW = Math.max(320, Math.min(resizeData.startW - dx, window.innerWidth - 40));
    let newH = Math.max(400, Math.min(resizeData.startH + dy, window.innerHeight - 40));
    panel.style.width = newW + "px";
    panel.style.height = newH + "px";
    // 固定右下角位置
    panel.style.right = "20px";
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

  window.BiViNote.panel = {
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
})();
