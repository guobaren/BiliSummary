/**
 * BiliSummary Subtitle Module
 * 字幕获取、解析、渲染、高亮同步（精简版：移除截图相关）
 */
(function () {
  'use strict';

  window.BiliSummary = window.BiliSummary || {};

  let syncTimer = null;

  // ── API 通信 ──

  async function fetchFromBg(type, params) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...params }, resp => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp?.ok) {
          reject(new Error(resp?.error || '请求失败'));
          return;
        }
        resolve(resp.data);
      });
    });
  }

  // ── 获取视频元信息 ──

  async function fetchVideoMeta(bvid) {
    return fetchFromBg('fetch-video-meta', { bvid });
  }

  // ── 获取字幕列表 ──

  async function fetchSubtitleList(bvid, cid, aid) {
    return fetchFromBg('fetch-subtitle-list', { bvid, cid, aid });
  }

  // ── 获取字幕正文 ──

  async function fetchSubtitleBody(url) {
    return fetchFromBg('fetch-subtitle-body', { url });
  }

  // ── 提取 BVID ──

  function extractBvid(url) {
    const match = url.match(/\/video\/(BV[\w]+)/);
    return match ? match[1] : '';
  }

  // ── 获取视频元素 ──

  function getVideoElement() {
    const selectors = [
      '.bpx-player-video-wrap video',
      '#bilibili-player video',
      'video'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // ── 提取分P索引 ──

  function extractPageIndex(url) {
    try {
      const page = Number(new URL(url).searchParams.get('p') || '1');
      return Number.isFinite(page) && page > 0 ? page : 1;
    } catch {
      return 1;
    }
  }

  // ── 从 pages 数组中按索引选页 ──

  function pickPageFromPages(pages, pageIndex) {
    const safePages = Array.isArray(pages) ? pages : [];
    const byIndex = safePages[pageIndex - 1];
    if (byIndex?.cid) return byIndex;
    const byNo = safePages.find(item => Number(item.page) === pageIndex);
    if (byNo?.cid) return byNo;
    return null;
  }

  // ── 刷新（主流程） ──

  async function refresh() {
    const s = window.BiliSummary.state;
    const panel = window.BiliSummary.panel;

    const newBvid = extractBvid(location.href);
    if (!newBvid) {
      panel.showToast('当前页面不是 B 站视频页');
      return;
    }

    if (newBvid !== s.bvid) {
      s.reset();
    }
    s.bvid = newBvid;

    const runId = ++s.fetchRunId;

    panel.showToast('正在获取字幕...');

    try {
      const meta = await fetchVideoMeta(s.bvid);
      if (runId !== s.fetchRunId) return;

      s.aid = meta.aid || '';
      s.title = meta.title || '';
      s.author = meta.author || '';
      s.uploadDate = meta.uploadDate || '';
      s.description = meta.description || '';
      s.videoDuration = meta.defaultDuration || 0;

      const pageIndex = extractPageIndex(location.href);
      s.pageIndex = pageIndex;
      const currentPage = pickPageFromPages(meta.pages, pageIndex);
      s.cid = currentPage?.cid || meta.defaultCid || meta.pages?.[0]?.cid || '';

      if (!s.cid) {
        panel.showToast('无法获取视频 CID');
        return;
      }

      const bundle = await fetchSubtitleList(s.bvid, s.cid, s.aid);
      if (runId !== s.fetchRunId) return;

      s.subtitles = bundle.subtitles || [];
      s.chapters = bundle.chapters || [];

      panel.updateSubtitleSelect(s.subtitles, s.selectedSubtitleUrl);

      if (s.subtitles.length === 0) {
        s.subtitleBody = [];
        renderSubtitleList();
        panel.showToast('当前视频无字幕');
        return;
      }

      let preferred = s.subtitles[0];
      if (s.selectedSubtitleLang) {
        const found = s.subtitles.find(t => t.lan === s.selectedSubtitleLang);
        if (found) preferred = found;
      }
      await loadSubtitle(preferred.subtitleUrl, preferred.lan);

      if (runId !== s.fetchRunId) return;
      panel.showToast('字幕获取成功');
    } catch (err) {
      if (runId !== s.fetchRunId) return;
      console.error('[BiliSummary] refresh error:', err);
      panel.showToast('获取失败：' + err.message);
    }
  }

  // ── 加载字幕正文 ──

  async function loadSubtitle(url, lang) {
    const s = window.BiliSummary.state;
    const panel = window.BiliSummary.panel;
    const runId = s.fetchRunId;

    try {
      const body = await fetchSubtitleBody(url);
      if (runId !== s.fetchRunId) return;
      s.subtitleBody = body;
      s.selectedSubtitleUrl = url;
      s.selectedSubtitleLang = lang || '';
      renderSubtitleList();
      startSync();
    } catch (err) {
      if (runId !== s.fetchRunId) return;
      console.error('[BiliSummary] loadSubtitle error:', err);
      panel.showToast('字幕加载失败：' + err.message);
    }
  }

  // ── 切换字幕语言 ──

  async function switchSubtitle(url, lang) {
    stopSync();
    await loadSubtitle(url, lang);
  }

  // ── 渲染字幕列表 ──

  let subtitleListenerAttached = false;

  function renderSubtitleList() {
    const s = window.BiliSummary.state;
    const container = document.getElementById('bn-subtitle-list');
    if (!container) return;

    container.innerHTML = '';

    if (!subtitleListenerAttached) {
      container.addEventListener('click', onSubtitleClick);
      subtitleListenerAttached = true;
    }

    if (!s.subtitleBody || s.subtitleBody.length === 0) {
      container.innerHTML = '<div class="bn-empty">暂无字幕</div>';
      return;
    }

    s.subtitleBody.forEach((item, index) => {
      const text = String(item.content || '').trim();
      if (!text) return;

      const el = document.createElement('div');
      el.className = 'bn-row';
      el.dataset.index = index;
      el.innerHTML = `
        <span class="bn-row-time">${formatTime(item.from)}</span>
        <span class="bn-row-text">${escapeHtml(text)}</span>
        <div class="bn-btns">
          <button data-action="copy">复制</button>
        </div>
      `;

      el.addEventListener('click', (e) => {
        if (e.target.closest('.bn-btns')) return;
        jumpToTime(item.from);
      });

      container.appendChild(el);
    });

    if (lastActiveIndex >= 0) {
      updateHighlight(lastActiveIndex);
    }
  }

  // ── 字幕列表点击事件 ──

  function onSubtitleClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const row = btn.closest('.bn-row');
    if (!row) return;
    const index = parseInt(row.dataset.index);
    const action = btn.dataset.action;

    if (action === 'copy') {
      copySingleText(index);
    }
  }

  // ── 跳转到时间点 ──

  function jumpToTime(seconds) {
    const video = getVideoElement();
    if (!video) return;
    const wasPaused = video.paused;
    video.currentTime = seconds;
    if (wasPaused) {
      video.pause();
    }
  }

  // ── 字幕高亮同步 ──

  let lastActiveIndex = -1;
  let manualScrollPauseUntil = 0;
  let scrollHandlers = null;

  function startSync() {
    stopSync();
    const video = getVideoElement();
    if (!video) return;

    const s = window.BiliSummary.state;
    const container = document.getElementById('bn-subtitle-list');
    if (!container) return;

    // 滚动控制：用户上滑暂停自动滚动，回到底部恢复
    if (!scrollHandlers) {
      scrollHandlers = {
        onScroll: () => {
          const now = Date.now();
          if (manualScrollPauseUntil > 0 && now > manualScrollPauseUntil) {
            manualScrollPauseUntil = 0;
          }
          if (manualScrollPauseUntil === 0) {
            const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 5;
            if (!isAtBottom) {
              manualScrollPauseUntil = now + 3000;
            }
          }
        }
      };
      container.addEventListener('scroll', scrollHandlers.onScroll, { passive: true });
    }

    syncTimer = setInterval(() => {
      if (video.paused) return;
      const idx = findActiveIndex(video.currentTime);
      if (idx >= 0 && idx !== lastActiveIndex) {
        updateHighlight(idx);
        // 自动滚动
        if (manualScrollPauseUntil === 0) {
          const activeEl = container.querySelector(`[data-index="${idx}"]`);
          if (activeEl) {
            const top = activeEl.offsetTop - container.clientHeight / 2;
            container.scrollTo({ top: top, behavior: 'smooth' });
          }
        }
      }
    }, 300);
  }

  function stopSync() {
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
  }

  function findActiveIndex(currentTime) {
    const s = window.BiliSummary.state;
    if (!s.subtitleBody || s.subtitleBody.length === 0) return -1;
    for (let i = s.subtitleBody.length - 1; i >= 0; i--) {
      if (currentTime >= s.subtitleBody[i].from) return i;
    }
    return 0;
  }

  function updateHighlight(activeIndex) {
    const container = document.getElementById('bn-subtitle-list');
    if (!container) return;
    const rows = container.querySelectorAll('.bn-row');
    rows.forEach(row => {
      row.classList.toggle('bn-active', parseInt(row.dataset.index) === activeIndex);
    });
    lastActiveIndex = activeIndex;
  }

  // ── 复制单条字幕 ──

  function copySingleText(index) {
    const s = window.BiliSummary.state;
    const item = s.subtitleBody[index];
    if (!item) return;
    navigator.clipboard.writeText(item.content).then(() => {
      window.BiliSummary.panel.showToast('已复制');
    });
  }

  // ── 复制全部字幕文本 ──

  function copyText() {
    const s = window.BiliSummary.state;
    if (!s.subtitleBody || s.subtitleBody.length === 0) {
      window.BiliSummary.panel.showToast('没有可复制的字幕');
      return;
    }
    const text = s.subtitleBody
      .map(item => item.content)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      window.BiliSummary.panel.showToast('已复制全部字幕');
    });
  }

  // ── 工具函数 ──

  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  // ── 公开接口 ──

  window.BiliSummary.subtitle = {
    refresh,
    switchSubtitle,
    copyText,
    renderSubtitleList,
    getVideoElement,
    jumpToTime,
    startSync,
    stopSync,
    formatTime,
    fetchVideoMeta,
    extractBvid,
    extractPageIndex,
    findActiveIndex
  };
})();
