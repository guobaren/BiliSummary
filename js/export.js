/**
 * BiliSummary Export Module
 * 精简版：只保留 SRT 导出
 */
(function () {
  'use strict';

  window.BiliSummary = window.BiliSummary || {};

  // ── SRT 导出 ──

  function buildSrt(body) {
    return body.map((item, i) => {
      const from = formatSrtTime(item.from);
      const to = formatSrtTime(item.to || item.from + 2);
      const text = String(item.content || '').trim();
      return `${i + 1}\n${from} --> ${to}\n${text}`;
    }).join('\n\n');
  }

  function formatSrtTime(seconds) {
    const msTotal = Math.max(0, Math.floor((seconds || 0) * 1000));
    const h = Math.floor(msTotal / 3600000);
    const m = Math.floor((msTotal % 3600000) / 60000);
    const s = Math.floor((msTotal % 60000) / 1000);
    const ms = msTotal % 1000;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)},${String(ms).padStart(3, '0')}`;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function downloadSrt() {
    const s = window.BiliSummary.state;
    const panel = window.BiliSummary.panel;

    if (!s.subtitleBody || s.subtitleBody.length === 0) {
      panel.showToast('没有可导出的字幕');
      return;
    }

    const content = buildSrt(s.subtitleBody);
    const filename = `${sanitize(s.title || 'subtitle')}.srt`;
    downloadText(content, filename, 'text/plain;charset=utf-8');
    panel.showToast('已导出 SRT');
  }

  // ── 工具函数 ──

  function downloadText(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function sanitize(str) {
    return String(str || 'untitled')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  window.BiliSummary.exportUtil = {
    buildSrt,
    downloadSrt,
  };
})();
