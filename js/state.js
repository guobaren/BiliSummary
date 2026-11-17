/**
 * BiliSummary State Module
 * 集中管理运行时状态
 */
window.BiliSummary = window.BiliSummary || {};

// 默认 AI 接口配置：OpenCode Go 套餐（仅提供 DeepSeek V4.1 Flash）
const BN_API_PROVIDERS = window.BiliSummary.AI_PROVIDERS;
const BN_DEFAULT_API_CFG = BN_API_PROVIDERS
  ? BN_API_PROVIDERS.defaultApiConfig()
  : {
      provider: 'opencode-go',
      endpoint: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
      apiKey: '',
      model: 'deepseek-v4.1-flash',
      stream: true,
    };

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
    aiChannel: 'api',       // 'browser' | 'api'（默认 OpenCode Go API 通道）
    aiMode: 'fast',         // 'fast' | 'expert'
    floatIconEnabled: true, // 浮动图标常驻
    autoSummary: true,      // 打开面板后自动开始总结
    apiProvider: BN_DEFAULT_API_CFG.provider, // 'opencode-go' | 'custom'
    apiKeys: {},            // 按服务商保存的 API Key，切换服务商时避免互相串用
    apiCfg: { ...BN_DEFAULT_API_CFG },
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
