/**
 * BiliSummary State Module
 * 集中管理运行时状态
 */
window.BiliSummary = window.BiliSummary || {};

window.BiliSummary.state = {
  // 视频信息
  bvid: '',
  aid: '',
  cid: '',
  pageIndex: 1,
  title: '',
  author: '',
  uploadDate: '',
  description: '',
  videoDuration: 0,

  // 字幕
  subtitles: [],
  selectedSubtitleUrl: '',
  selectedSubtitleLang: '',
  selectedSubtitleId: '',
  subtitleBody: [],

  // 章节
  chapters: [],

  // UI 状态
  panelVisible: false,
  activeTab: 'ai',
  fetchRunId: 0,

  // 设置
  settings: {
    fontSize: 'default',
    lineHeight: 'standard',
    autoScroll: true,
    darkMode: false,
    subtitleLang: '',
    deepseekPrompt: '',
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
  },
};

/**
 * 重置运行时状态（视频切换时调用）
 */
window.BiliSummary.state.reset = function () {
  const s = window.BiliSummary.state;
  s.bvid = '';
  s.aid = '';
  s.cid = '';
  s.pageIndex = 1;
  s.title = '';
  s.author = '';
  s.uploadDate = '';
  s.description = '';
  s.videoDuration = 0;
  s.subtitles = [];
  s.selectedSubtitleUrl = '';
  s.selectedSubtitleLang = '';
  s.selectedSubtitleId = '';
  s.subtitleBody = [];
  s.chapters = [];
  // 递增 runId，取消所有进行中的请求
  s.fetchRunId++;
};
