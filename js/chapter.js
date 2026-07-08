/**
 * BiliSummary Chapter Module
 * 章节获取、解析、渲染（精简版：移除截图相关）
 */
(function () {
  'use strict';

  window.BiliSummary = window.BiliSummary || {};

  let chapterListenerAttached = false;

  function render() {
    const s = window.BiliSummary.state;
    const container = document.getElementById('bn-chapter-list');
    if (!container) return;

    container.innerHTML = '';

    if (!chapterListenerAttached) {
      container.addEventListener('click', onChapterClick);
      chapterListenerAttached = true;
    }

    if (!s.chapters || s.chapters.length === 0) {
      container.innerHTML = '<div class="bn-empty">当前视频无章节</div>';
      return;
    }

    s.chapters.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = 'bn-row';
      el.dataset.index = index;
      el.innerHTML = `
        <span class="bn-row-time">${formatTime(item.from)}</span>
        <span class="bn-row-text">${escapeHtml(item.title)}</span>
        <div class="bn-btns">
          <button data-action="copy">复制</button>
        </div>
      `;

      el.addEventListener('click', (e) => {
        if (e.target.closest('.bn-btns')) return;
        jumpToChapter(item.from);
      });

      container.appendChild(el);
    });
  }

  function onChapterClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const row = btn.closest('.bn-row');
    if (!row) return;
    const index = parseInt(row.dataset.index);
    const s = window.BiliSummary.state;
    const item = s.chapters[index];
    if (!item) return;

    if (btn.dataset.action === 'copy') {
      navigator.clipboard.writeText(item.title).then(() => {
        window.BiliSummary.panel.showToast('已复制');
      });
    }
  }

  function jumpToChapter(seconds) {
    const video = window.BiliSummary.subtitle?.getVideoElement();
    if (!video) return;
    const wasPaused = video.paused;
    video.currentTime = seconds;
    if (wasPaused) {
      video.pause();
    }
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  window.BiliSummary.chapter = {
    render,
    jumpToChapter,
    formatTime
  };
})();
