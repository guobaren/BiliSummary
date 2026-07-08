/**
 * BiliSummary Background Script (Service Worker)
 * 代理 Bilibili API 请求，处理 CORS，管理图标状态
 */

// ── 图标状态管理 ──

function isVideoPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('bilibili.com') &&
      (parsed.pathname.startsWith('/video/') || parsed.pathname.startsWith('/list/'));
  } catch {
    return false;
  }
}

function updateIconForTab(tabId, url) {
  const enabled = isVideoPage(url || '');
  if (enabled) {
    chrome.action.setIcon({
      tabId,
      path: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png'
      }
    }).catch(() => {});
    chrome.action.setTitle({ tabId, title: 'BiliSummary - 点击打开' }).catch(() => {});
  } else {
    chrome.action.setIcon({
      tabId,
      path: {
        16: 'icons/icon-16-disabled.png',
        32: 'icons/icon-32-disabled.png',
        48: 'icons/icon-48-disabled.png',
        128: 'icons/icon-128-disabled.png'
      }
    }).catch(() => {});
    chrome.action.setTitle({ tabId, title: 'BiliSummary - 仅在B站视频页可用' }).catch(() => {});
  }
}

// 监听标签页 URL 变化
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    updateIconForTab(tabId, tab.url);
  }
});

// 监听标签页切换
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    updateIconForTab(tabId, tab.url);
  } catch {}
});

// ── 右键菜单 ──

// 创建/更新右键菜单项
function updateContextMenu() {
  chrome.storage.local.get(["bilisummary_settings"], (result) => {
    const settings = result.bilisummary_settings || {};
    const enabled = settings.floatIconEnabled !== false; // default true
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "toggle-float-icon",
        title: "浮动图标常驻",
        type: "checkbox",
        checked: enabled,
        contexts: ["action"],
      });
    });
  });
}

// 处理右键菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "toggle-float-icon") {
    const enabled = info.checked;
    // 保存到 storage
    chrome.storage.local.get(["bilisummary_settings"], (result) => {
      const settings = result.bilisummary_settings || {};
      settings.floatIconEnabled = enabled;
      chrome.storage.local.set({ bilisummary_settings: settings }, () => {
        // 通知所有 B站标签页更新
        chrome.tabs.query({ url: "*://*.bilibili.com/*" }, (tabs) => {
          tabs.forEach(t => {
            chrome.tabs.sendMessage(t.id, { type: "float-icon-toggle", enabled }).catch(() => {});
          });
        });
      });
    });
  }
});

// 消息：同步右键菜单状态

// 扩展安装/更新时，刷新所有标签页图标
chrome.runtime.onInstalled.addListener(async () => {
  updateContextMenu();
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url) {
        updateIconForTab(tab.id, tab.url);
      }
    }
  } catch {}
});

// ── 消息监听 ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'sync-float-icon-menu') {
    chrome.contextMenus.update('toggle-float-icon', { checked: message.enabled });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'fetch-video-meta') {
    fetchVideoMeta(message.bvid)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'fetch-subtitle-list') {
    fetchSubtitleList(message.bvid, message.cid, message.aid)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'fetch-subtitle-body') {
    fetchSubtitleBody(message.url)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── DeepSeek 文档整理 ──

  if (message.type === 'ds-check-login') {
    dsCheckLogin().then(result => sendResponse(result));
    return true;
  }

  if (message.type === 'ds-abort') {
    // 直连通道：中断 fetch
    if (dsAbortController) {
      dsAbortController.abort();
      dsAbortController = null;
    }
    // 标签页通道：发送 stop_stream 到 DeepSeek 标签页
    const processorIds = Object.keys(dsSseProcessors);
    if (processorIds.length > 0) {
      const processor = dsSseProcessors[processorIds[0]];
      const chatId = processor.getChatId();
      const msgId = processor.getMessageId();
      if (msgId) dsUpdateLastMessageId(msgId);
      chrome.tabs.query({ url: '*://chat.deepseek.com/*' }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'ds-abort-stop',
            chatId,
            messageId: msgId,
          }).catch(() => {});
        }
      });
    }
    dsSseProcessors = {};
    dsSenderTabs = {};
    return false;
  }

  if (message.type === 'ds-send') {
    const requestId = message.requestId || crypto.randomUUID();
    dsHandleSend(message.markdown, message.prompt, requestId, message.chatId, message.mode);
    sendResponse({ ok: true, requestId });
    return true;
  }

  if (message.type === 'ds-open-login') {
    // 用户主动点击登录，始终在前台打开
    chrome.tabs.query({ url: '*://chat.deepseek.com/*' }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true }).catch(() => {});
      } else {
        chrome.tabs.create({ url: 'https://chat.deepseek.com' }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'ds-open-chat') {
    const url = message.url || 'https://chat.deepseek.com';
    const isStreaming = Object.keys(dsSseProcessors).length > 0;
    chrome.tabs.query({ url: '*://chat.deepseek.com/*' }, (tabs) => {
      if (isStreaming) {
        // 流式处理中：新建后台标签页，避免中断 SSE 连接
        chrome.tabs.create({ url, active: false }).catch(() => {});
      } else if (tabs.length === 0) {
        chrome.tabs.create({ url });
      } else {
        // 空闲：复用已有标签页
        chrome.tabs.update(tabs[0].id, { url, active: true });
      }
    });
    return false;
  }

  // ── DeepSeek bridge → bilibili tab 转发
  if (message.type === 'DEEPSEEK_CHUNK') {
    const rid = message.requestId;
    if (!dsSseProcessors[rid]) dsSseProcessors[rid] = dsCreateSSEProcessor();
    const processor = dsSseProcessors[rid];
    const text = processor.processChunk(message.chunk);
    const chatId = processor.getChatId();
    const msgId = processor.getMessageId();
    if (msgId) dsUpdateLastMessageId(msgId);
    if (chatId) dsUpdateChatId(chatId);
    dsSendToBilibiliTab({ type: 'ds-chunk', text, requestId: rid, chatId });
    return false;
  }

  // ── 通用 AI API 通道 ──
  if (message.type === 'api-send') {
    (async () => {
      const cfg = {
        endpoint: (message.endpoint || '').trim(),
        apiKey: (message.apiKey || '').trim(),
        model: (message.model || '').trim(),
        stream: message.stream !== false,
      };
      apiStreamCompletion(message.messages, cfg, message.requestId);
    })();
    sendResponse({ ok: true, requestId: message.requestId });
    return true;
  }

  if (message.type === 'api-abort') {
    if (apiAbortController) {
      apiAbortController.abort();
      apiAbortController = null;
    }
    return false;
  }

  if (message.type === 'api-fetch-models') {
    (async () => {
      const cfg = {
        endpoint: (message.endpoint || '').trim(),
        apiKey: (message.apiKey || '').trim(),
      };
      try {
        const models = await apiFetchModels(cfg);
        sendResponse({ ok: true, models });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.type === 'DEEPSEEK_DONE') {
    const rid = message.requestId;
    if (dsSseProcessors[rid]) {
      const processor = dsSseProcessors[rid];
      const tail = processor.flush();
      const msgId = processor.getMessageId();
      if (msgId) dsUpdateLastMessageId(msgId);
      if (tail) dsSendToBilibiliTab({ type: 'ds-chunk', text: tail, requestId: rid });
      delete dsSseProcessors[rid];
    }
    dsSendToBilibiliTab({ type: 'ds-done', requestId: rid });
    delete dsSenderTabs[rid];
    return false;
  }

  if (message.type === 'DEEPSEEK_ERROR') {
    delete dsSseProcessors[message.requestId];
    dsSendToBilibiliTab({ type: 'ds-error', error: message.error, requestId: message.requestId });
    delete dsSenderTabs[message.requestId];
    return false;
  }
});

// 扩展图标点击 → 切换面板
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' }).catch(() => {});
});

/**
 * 获取视频元信息
 */
async function fetchVideoMeta(bvid) {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const payload = await fetchJson(url);
  if (payload.code !== 0) {
    throw new Error(payload?.message || '无法获取视频信息');
  }
  const data = payload.data || {};
  const pubdate = Number(data.pubdate || 0);
  const uploadDate = pubdate > 0 ? formatDate(pubdate * 1000) : '';
  const pages = Array.isArray(data.pages) ? data.pages : [];
  return {
    aid: data.aid ? String(data.aid) : '',
    title: String(data.title || ''),
    author: String(data.owner?.name || ''),
    description: String(data.desc || ''),
    uploadDate,
    defaultCid: data.cid ? String(data.cid) : '',
    defaultDuration: Number(data.duration || 0) || 0,
    pages: pages.map(item => ({
      cid: String(item.cid || ''),
      page: Number(item.page || 0) || 0,
      part: String(item.part || '').trim(),
      duration: Number(item.duration || 0) || 0
    }))
  };
}

/**
 * 获取字幕列表和章节
 * 完全遵循 Bilibili-Obsidian-Clipper 的双源策略：
 * 1. 主源：player/wbi/v2?aid=xxx&cid=xxx (用 aid 作为主标识)
 * 2. 回退：player/v2?bvid=xxx&cid=xxx
 */
async function fetchSubtitleList(bvid, cid, aid = '') {
  const requests = buildSubtitleInfoRequests({ bvid, cid, aid });

  for (const request of requests) {
    try {
      const payload = await fetchJson(request.url);
      if (payload.code !== 0) {
        console.warn(`[BiliSummary] ${request.source} failed:`, payload?.message);
        continue;
      }
      const data = payload.data || {};
      const subtitles = normalizeSubtitleTracks(
        (data.subtitle?.subtitles || []).map(item => ({
          id: item?.id === undefined || item?.id === null ? '' : String(item.id),
          lan: item?.lan || '',
          lanDoc: item?.lan_doc || '',
          subtitleUrl: normalizeSubtitleUrl(item?.subtitle_url || ''),
          source: request.source
        })).filter(item => item.subtitleUrl)
      );

      const chapters = normalizeChapters(
        (data.view_points || []).map(item => ({
          title: String(item?.content || item?.title || item?.label || '').trim(),
          from: normalizeChapterTime(item?.from ?? item?.start ?? item?.start_time),
          to: normalizeChapterTime(item?.to ?? item?.end ?? item?.end_time)
        }))
      );

      return { subtitles, chapters };
    } catch (err) {
      console.warn(`[BiliSummary] ${request.source} error:`, err.message);
      continue;
    }
  }

  // 所有源都失败
  return { subtitles: [], chapters: [] };
}

/**
 * 构建字幕 API 请求列表（双源策略）
 */
function buildSubtitleInfoRequests({ bvid, cid, aid }) {
  const safeBvid = encodeURIComponent(String(bvid || ''));
  const safeCid = encodeURIComponent(String(cid || ''));
  const safeAid = encodeURIComponent(String(aid || ''));
  const requests = [];

  // 主源：player/wbi/v2 用 aid 作为主标识
  if (aid) {
    requests.push({
      source: 'player-wbi-v2',
      url: `https://api.bilibili.com/x/player/wbi/v2?aid=${safeAid}&cid=${safeCid}&bvid=${safeBvid}`
    });
  }

  // 回退：player/v2 用 bvid 作为主标识
  requests.push({
    source: 'player-v2',
    url: `https://api.bilibili.com/x/player/v2?bvid=${safeBvid}&cid=${safeCid}` +
      (aid ? `&aid=${safeAid}` : '')
  });

  return requests;
}

/**
 * 获取字幕正文
 * CDN 域名 (hdslb.com) 响应头为 Access-Control-Allow-Origin: *
 * 不能带 credentials，否则 CORS 报错
 */
async function fetchSubtitleBody(url) {
  const normalizedUrl = normalizeSubtitleUrl(url);
  const isCdn = normalizedUrl.includes('hdslb.com');
  const resp = await fetch(normalizedUrl, {
    credentials: isCdn ? 'omit' : 'include',
    cache: 'no-store'
  });
  if (!resp.ok) {
    throw new Error(`字幕请求失败：${resp.status}`);
  }
  const data = await resp.json();
  return Array.isArray(data.body) ? data.body : [];
}

/**
 * 通用 JSON 请求
 */
async function fetchJson(url) {
  const resp = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!resp.ok) {
    throw new Error(`请求失败：${resp.status}`);
  }
  return resp.json();
}

/**
 * 标准化字幕 URL
 */
function normalizeSubtitleUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url.replace(/^\/+/, '')}`;
}

/**
 * 字幕语言优先级（数值越小越优先）
 * 中文 > 英文 > 其他
 */
function subtitlePriority(item) {
  const lan = String(item?.lan || '').toLowerCase();
  const label = String(item?.lanDoc || '').toLowerCase();

  if (lan === 'zh-cn' || lan === 'zh-hans') return 0;
  if (lan === 'zh') return 1;
  if (lan.includes('zh')) return 2;
  if (label.includes('中文')) return 3;

  if (lan === 'en' || lan === 'en-us' || lan === 'en-gb') return 10;
  if (lan.includes('en')) return 11;
  if (label.includes('英文') || label.includes('英语') || label.includes('english')) return 12;

  return 50;
}

/**
 * 提取 URL 的稳定部分（去掉 auth_key 等动态参数）
 */
function urlPathKey(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return String(url || '').split('?')[0];
  }
}

/**
 * 按语言优先级排序字幕轨道，保证每次顺序一致
 */
function normalizeSubtitleTracks(subtitles) {
  return [...(subtitles || [])].sort((a, b) => {
    const p = subtitlePriority(a) - subtitlePriority(b);
    if (p !== 0) return p;

    const lanA = String(a.lanDoc || a.lan || '').toLowerCase();
    const lanB = String(b.lanDoc || b.lan || '').toLowerCase();
    if (lanA < lanB) return -1;
    if (lanA > lanB) return 1;

    const idA = Number.parseInt(String(a.id || '0'), 10);
    const idB = Number.parseInt(String(b.id || '0'), 10);
    if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) return idA - idB;

    // 用 URL path 比较，忽略 auth_key 等动态查询参数
    return urlPathKey(a.subtitleUrl).localeCompare(urlPathKey(b.subtitleUrl));
  });
}

/**
 * 标准化章节时间
 */
function normalizeChapterTime(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num > 60 * 60 * 24 ? num / 1000 : num;
}

/**
 * 标准化章节列表
 */
function normalizeChapters(chapters) {
  const normalized = (chapters || [])
    .map(item => ({
      title: String(item?.title || '').trim(),
      from: Number(item?.from || 0) || 0,
      to: Number(item?.to || 0) || 0
    }))
    .filter(item => item.title && item.from >= 0)
    .sort((a, b) => a.from - b.from);

  // 去重
  const unique = [];
  const seen = new Set();
  for (const item of normalized) {
    const key = `${Math.floor(item.from * 10)}|${item.title.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return unique;
}

/**
 * 格式化日期
 */
function formatDate(timestamp) {
  const d = new Date(timestamp);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ════════════════════════════════════════════════════════════════
// 通道 A：通用 AI API（OpenAI 兼容协议）
// ════════════════════════════════════════════════════════════════
// 走 background fetch 绕过 content_scripts 的 CORS 限制。
// 兼容 OpenAI 风格：POST {messages[], model, stream?} -> SSE 或一次性 JSON

async function apiStreamCompletion(messages, cfg, requestId) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`,
  };
  const payload = {
    model: cfg.model,
    messages,
    stream: cfg.stream,
  };

  // 仅响应发起方的标签页
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const senderTabId = activeTabs[0]?.id;

  const forward = (msg) => {
    if (!senderTabId) return;
    chrome.tabs.sendMessage(senderTabId, { ...msg, requestId }).catch(() => {});
  };

  try {
    apiAbortController = new AbortController();
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: apiAbortController.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      forward({ type: 'api-error', error: `HTTP ${res.status} ${text.slice(0, 300)}` });
      return;
    }

    if (cfg.stream && res.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        while (true) {
          const idx = buffer.indexOf('\n\n');
          if (idx === -1) break;
          const eventStr = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          for (const line of eventStr.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            let parsed;
            try { parsed = JSON.parse(jsonStr); } catch { continue; }
            // 标准 OpenAI 风格
            const choice = parsed.choices?.[0];
            if (!choice) {
              // DeepSeek 自定义 chunk：content / reasoning 等字段
              if (parsed.content || parsed.reasoning) {
                if (parsed.reasoning) forward({ type: 'api-chunk', role: 'think', text: parsed.reasoning });
                if (parsed.content) forward({ type: 'api-chunk', role: 'response', text: parsed.content });
              }
              continue;
            }
            const delta = choice.delta || {};
            if (delta.content) {
              forward({ type: 'api-chunk', role: 'response', text: delta.content });
            }
            if (delta.reasoning_content) {
              forward({ type: 'api-chunk', role: 'think', text: delta.reasoning_content });
            }
          }
        }
      }
    } else {
      // 非流式：一次性返回完整文本
      let data;
      try { data = await res.json(); } catch {
        forward({ type: 'api-error', error: '解析响应 JSON 失败' });
        return;
      }
      const content = data.choices?.[0]?.message?.content
        || data.content
        || data?.response
        || '';
      if (!content) {
        forward({ type: 'api-error', error: `响应格式异常: ${JSON.stringify(data).slice(0, 200)}` });
        return;
      }
      forward({ type: 'api-chunk', role: 'response', text: content });
    }
    forward({ type: 'api-done' });
  } catch (err) {
    if (err.name === 'AbortError') {
      forward({ type: 'api-done' });
      return;
    }
    forward({ type: 'api-error', error: `请求异常: ${String(err)}` });
  } finally {
    apiAbortController = null;
  }
}

// 获取厂商模型列表：GET {base}/models 或 {base}/v1/models
async function apiFetchModels(cfg) {
  let base = cfg.endpoint.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
  const candidates = [
    `${base}/models`,
    `${base}/v1/models`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : null);
      if (!list) {
        if (Array.isArray(data) && data.length && data[0]?.id) return data.map(it => ({ id: it.id, name: it.name || it.id }));
        continue;
      }
      return list.map(it => ({ id: it.id, name: it.name || it.id }));
    } catch (e) {
      continue;
    }
  }
  throw new Error('无法从该接口获取模型列表；请检查 endpoint / apiKey 是否正确');
}

// ════════════════════════════════════════════════════════════════
// 通道 B：DeepSeek 浏览器端 SDK（chat.deepseek.com 注入脚本）
// ════════════════════════════════════════════════════════════════

const DS_URL = 'https://chat.deepseek.com';

const DS_DEFAULT_PROMPT = `你是一个视频内容总结助手，根据用户提供的字幕文本生成结构化、易读的视频总结笔记。

输出格式要求：

视频总结标题：基于视频主题提炼一个精炼、有吸引力的标题。

UP主信息：提取作者名称。

核心观点概述：用1-2句话概括视频的核心主旨或UP主最想传达的观点。

主要内容分点整理：按章节或主题分点整理。每个大点需有明确的小标题（如"1. 安装与登录"），小标题下使用简洁的要点或短句展开说明。保留所有技术名词、工具名、框架名、产品名。删除口语化内容、重复内容，修正错别字，合并连续字幕为连贯语句。

额外约束：

不要新增原文不存在的技术细节或扩展知识，仅整理原文信息。

每个知识点下可包含子要点（使用短横线"-"或编号），但总层级不超过两级。

待总结字幕：

{markdown}

直接输出整理后的内容，不要输出任何额外说明文字。`;

let dsInjectedTabs = new Set();
let dsChatId = null;
let dsSseProcessors = {};
let dsLastMessageId = null;
let dsSenderTabs = {};
let dsAbortController = null;
let apiAbortController = null;

// 持久化 DeepSeek chatId
function dsUpdateChatId(newChatId) {
  if (!newChatId) return;
  if (newChatId === dsChatId) return;
  dsChatId = newChatId;
  chrome.storage.local.set({ chatId: newChatId }).catch(() => {});
}

// 持久化 DeepSeek messageId（追问时作为 parentMessageId）
function dsUpdateLastMessageId(msgId) {
  if (!msgId) return;
  if (msgId === dsLastMessageId) return;
  dsLastMessageId = msgId;
  chrome.storage.local.set({ dsLastMessageId: msgId }).catch(() => {});
}

// 加载持久化的会话状态
let dsStorageLoaded = false;
async function dsEnsureStorageLoaded() {
  if (dsStorageLoaded) return;
  try {
    const stored = await chrome.storage.local.get(['chatId', 'dsLastMessageId']);
    if (stored.chatId) dsChatId = stored.chatId;
    if (stored.dsLastMessageId) dsLastMessageId = stored.dsLastMessageId;
  } catch {}
  dsStorageLoaded = true;
}
// 启动时异步加载
chrome.storage.local.get(['chatId', 'dsLastMessageId'], (stored) => {
  if (stored.chatId) dsChatId = stored.chatId;
  if (stored.dsLastMessageId) dsLastMessageId = stored.dsLastMessageId;
  dsStorageLoaded = true;
});

let dsEnsureTabLock = null;

async function dsEnsureTab() {
  // 互斥锁：防止并发调用导致重复创建标签页
  if (dsEnsureTabLock) return dsEnsureTabLock;

  dsEnsureTabLock = (async () => {
    // 优先使用已注入脚本的标签页
    for (const tabId of dsInjectedTabs) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.url?.includes('chat.deepseek.com')) return tab;
      } catch {}
    }
    const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' });
    if (tabs.length > 0 && tabs[0].id) return tabs[0];
    const tab = await chrome.tabs.create({ url: DS_URL, active: false });
    await dsWaitTabComplete(tab.id, 20000);
    return tab;
  })();

  try {
    return await dsEnsureTabLock;
  } finally {
    dsEnsureTabLock = null;
  }
}

async function dsWaitTabComplete(tabId, timeout) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
  } catch { return; }
  await new Promise((resolve) => {
    const listener = (tid, changeInfo) => {
      if (tid === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, timeout);
  });
}

async function dsInjectScripts(tabId) {
  if (dsInjectedTabs.has(tabId)) return;
  await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', files: ['libs/deepseek-bridge.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['libs/wasm-solver.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['libs/deepseek-api.js'] });
  dsInjectedTabs.add(tabId);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  dsInjectedTabs.delete(tabId);
  // 清理该标签页在 dsSenderTabs 中的条目
  for (const [rid, tid] of Object.entries(dsSenderTabs)) {
    if (tid === tabId) delete dsSenderTabs[rid];
  }
  // 流式处理中被关闭 → 通知前端
  if (Object.keys(dsSseProcessors).length > 0) {
    // 检查是否有关联的 processor 使用了这个标签页
    dsSendToBilibiliTab({ type: 'ds-error', error: 'DeepSeek 标签页已关闭，输出中断。请点击「开始总结」重试。', requestId: Object.keys(dsSseProcessors)[0] });
    dsSseProcessors = {};
  }
});

async function dsCheckLogin() {
  await dsEnsureStorageLoaded();
  try {
    // 第 1 步：快速 cookie 检测（无需创建标签页）
    let cookies;
    try { cookies = await chrome.cookies.getAll({ domain: '.deepseek.com' }); } catch { cookies = []; }
    const hasSessionCookie = cookies.some(c => ['ds_session_id', 'session_id', 'HWSID'].includes(c.name) && c.value);

    if (!hasSessionCookie) {
      dsAuthToken = null;
      return { loggedIn: false };
    }

    // 第 2 步：有 cookie → 尝试提取 token
    // 先尝试从已有标签页提取，失败则创建专用标签页重试
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await dsEnsureToken();
      if (token) {
        return { loggedIn: true };
      }
      // 已有标签页提取失败，创建专用标签页重试（给 SPA 足够时间恢复会话）
      if (attempt === 0) {
        const tab = await chrome.tabs.create({ url: DS_URL, active: false }).catch(() => null);
        if (tab?.id) {
          await dsWaitTabComplete(tab.id, 25000);
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: 'MAIN',
            func: () => {
              const keys = ['userToken', 'token', 'ds_token', 'auth_token', 'access_token', 'jwt'];
              for (const key of keys) {
                try {
                  const raw = localStorage.getItem(key);
                  if (raw && typeof raw === 'string' && raw.length > 10) {
                    try { const p = JSON.parse(raw); const t = p.token || p.value || p.access_token || p.jwt; if (t && typeof t === 'string' && t.length > 10) return t; } catch { return raw; }
                  }
                } catch {}
              }
              return null;
            },
          }).catch(() => ({ result: null }));
          if (results?.[0]?.result) {
            dsAuthToken = results[0].result;
            chrome.tabs.remove(tab.id).catch(() => {});
            return { loggedIn: true };
          }
          chrome.tabs.remove(tab.id).catch(() => {});
        }
      }
    }

    // 第 3 步：token 提取失败 → 未登录（无 token 无法认证 API 请求）
    return { loggedIn: false, reason: 'token_not_found' };
  } catch (e) {
    return { loggedIn: false, reason: String(e) };
  }
}

function dsSendToBilibiliTab(msg) {
  const tabId = msg.requestId ? dsSenderTabs[msg.requestId] : null;
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

async function dsHandleSend(markdown, prompt, requestId, senderChatId, mode) {
  await dsEnsureStorageLoaded();
  delete dsSenderTabs[requestId];

  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTabs[0]?.id) dsSenderTabs[requestId] = activeTabs[0].id;

  // 如果 deepseek.js 传来了本地 chatId（可能与后台不同步），优先使用并持久化
  if (senderChatId && senderChatId !== dsChatId) {
    dsChatId = senderChatId;
    chrome.storage.local.set({ chatId: dsChatId }).catch(() => {});
  }

  // 追问 vs 新总结：构造 fullPrompt
  let fullPrompt = prompt;
  let parentMessageId = null;
  if (!fullPrompt) {
    fullPrompt = markdown;
    parentMessageId = dsLastMessageId;
  } else {
    dsLastMessageId = null;
    try {
      const stored = await chrome.storage.local.get('bilisummary_settings');
      const savedSettings = stored.bilisummary_settings || {};
      let sysPrompt = savedSettings.deepseekPrompt;
      if (!sysPrompt) sysPrompt = DS_DEFAULT_PROMPT;
      if (sysPrompt.includes('{markdown}')) {
        fullPrompt = sysPrompt.replace('{markdown}', markdown);
      } else {
        fullPrompt = sysPrompt + '\n\n' + markdown;
      }
    } catch {
      fullPrompt = DS_DEFAULT_PROMPT.replace('{markdown}', markdown);
    }
  }

  // 优先走直连通道（无需标签页），失败则回退到标签页注入
  try {
    await dsDirectSend(fullPrompt, dsChatId, requestId, parentMessageId, mode);
    return; // 直连成功
  } catch (directErr) {
    if (!directErr.message || !directErr.message.startsWith('NEED_TAB_FALLBACK:')) {
      // 非 PoW 回退的异常已经由 dsDirectSend 内部处理并 forward error，不重复报错
      return;
    }
    // 不支持的 PoW 算法 → 回退到标签页注入
    console.warn('[BiliSummary] 直连通道不支持 PoW 算法，回退到标签页模式:', directErr.message);
  }

  // ── 回退：标签页注入模式 ──
  let tab;
  try {
    tab = await dsEnsureTab();
  } catch (e) {
    dsSendToBilibiliTab({ type: 'ds-error', error: `获取标签页失败: ${String(e)}`, requestId });
    return;
  }

  try {
    await dsInjectScripts(tab.id);
  } catch (e) {
    dsSendToBilibiliTab({ type: 'ds-error', error: `注入脚本失败: ${String(e)}`, requestId });
    return;
  }

  chrome.tabs.sendMessage(tab.id, {
    type: 'ds-inject-request',
    payload: { prompt: fullPrompt, chatId: dsChatId, requestId, parentMessageId, thinking_enabled: mode !== 'fast' }
  }).catch((e) => {
    if (String(e).includes('Receiving end does not exist')) {
      dsInjectedTabs.delete(tab.id);
      dsInjectScripts(tab.id).then(() => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'ds-inject-request',
          payload: { prompt: fullPrompt, chatId: dsChatId, requestId, parentMessageId }
        });
      });
    } else {
      dsSendToBilibiliTab({ type: 'ds-error', error: `发送请求失败: ${String(e)}`, requestId });
    }
  });
}

function dsCreateSSEProcessor() {
  let inThink = false;
  let chatId = null;
  let messageId = null;
  let dataLineBuf = '';

  function processChunk(chunk) {
    let text = '';
    try {
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') { dataLineBuf = ''; continue; }
          try {
            const data = JSON.parse(jsonStr);
            dataLineBuf = '';
            if (data.type === 'deepseek:chat_session_id') { chatId = data.chat_session_id; continue; }
            if (data.response_message_id != null) messageId = data.response_message_id;
            const result = processEvent(data);
            if (result) text += result;
          } catch {
            dataLineBuf = line;
          }
        } else {
          if (dataLineBuf) {
            dataLineBuf += '\n' + line;
            try {
              const jsonStr = dataLineBuf.slice(6).trim();
              const data = JSON.parse(jsonStr);
              dataLineBuf = '';
              if (data.type === 'deepseek:chat_session_id') { chatId = data.chat_session_id; continue; }
              if (data.response_message_id != null) messageId = data.response_message_id;
              const result = processEvent(data);
              if (result) text += result;
            } catch {}
          }
        }
      }
    } catch {}
    return text;
  }

  function processEvent(data) {
    if (data.o === 'SET' || data.o === 'BATCH') return null;
    const path = Array.isArray(data.p) ? data.p.join('/') : data.p;
    const resp = data.v?.response;

    if (resp?.fragments && Array.isArray(resp.fragments)) {
      const parts = [];
      for (const frag of resp.fragments) {
        const content = frag.content || '';
        if (!content) continue;
        if (frag.type === 'THINK' || frag.type === 'THINKING' || frag.type === 'reasoning') {
          if (!inThink) { inThink = true; parts.push('<think>'); }
          parts.push(content);
        } else {
          if (inThink) { inThink = false; parts.push('</think>'); }
          parts.push(content);
        }
      }
      return parts.length > 0 ? parts.join('') : null;
    }

    if (data.o === 'APPEND' && Array.isArray(data.v)) {
      const parts = [];
      for (const item of data.v) {
        const content = item.content || '';
        if (item.type === 'THINK' || item.type === 'THINKING' || item.type === 'reasoning') {
          if (!inThink) { inThink = true; parts.push('<think>'); }
          if (content) parts.push(content);
        } else if (item.type === 'RESPONSE' || item.type === 'TEXT' || item.type === 'text') {
          if (inThink) { inThink = false; parts.push('</think>'); }
          if (content) parts.push(content);
        } else {
          if (content) parts.push(content);
        }
      }
      return parts.length > 0 ? parts.join('') : null;
    }

    if (data.o === 'APPEND' && typeof data.v === 'string') {
      return data.v || null;
    }

    if (path?.includes('reasoning') && typeof data.v === 'string') {
      if (!data.v) return null;
      if (!inThink) { inThink = true; return `<think>${data.v}`; }
      return data.v;
    }

    if (data.type === 'thinking') {
      const content = typeof data.v === 'string' ? data.v : data.content || '';
      if (!content) return null;
      if (!inThink) { inThink = true; return `<think>${content}`; }
      return content;
    }

    const delta = data.choices?.[0]?.delta;
    if (delta) {
      const parts = [];
      if (delta.reasoning_content) {
        if (!inThink) { inThink = true; parts.push('<think>'); }
        parts.push(delta.reasoning_content);
      }
      if (delta.content) {
        if (inThink) { inThink = false; parts.push('</think>'); }
        parts.push(delta.content);
      }
      return parts.length > 0 ? parts.join('') : null;
    }

    if (typeof data.v === 'string') {
      if (!data.v) return null;
      if (!path && inThink) return data.v;
      if (inThink) { inThink = false; return `</think>${data.v}`; }
      return data.v;
    }

    if (data.type === 'text' && typeof data.content === 'string') {
      const content = data.content.trim();
      if (!content) return null;
      if (inThink) { inThink = false; return `</think>${content}`; }
      return content;
    }

    return null;
  }

  function flush() {
    if (inThink) { inThink = false; return '</think>'; }
    return '';
  }

  return { processChunk, flush, getChatId: () => chatId, getMessageId: () => messageId };
}

// ════════════════════════════════════════════════════════════════
// 通道 C：DeepSeek 直连通道（无需持久标签页）
// ════════════════════════════════════════════════════════════════

let dsAuthToken = null;

// 从 DeepSeek 标签页提取 token（临时打开后关闭，含重试）
async function dsEnsureToken() {
  if (dsAuthToken) return dsAuthToken;

  const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' });
  let tab = tabs.length > 0 ? tabs[0] : null;
  let needCleanup = false;

  if (!tab) {
    tab = await chrome.tabs.create({ url: DS_URL, active: false });
    await dsWaitTabComplete(tab.id, 20000);
    needCleanup = true;
  }

  // 重试提取 token（给 SPA 时间从 cookie 恢复会话）
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
          function tryGetToken(raw) {
            if (!raw || typeof raw !== 'string' || raw.length <= 10) return null;
            try {
              const parsed = JSON.parse(raw);
              if (typeof parsed === 'string' && parsed.length > 10) return parsed;
              if (typeof parsed === 'object' && parsed !== null) {
                const t = parsed.token || parsed.value || parsed.access_token || parsed.jwt;
                return (t && typeof t === 'string' && t.length > 10) ? t : null;
              }
            } catch { return raw; }
            return null;
          }
          const keys = ['userToken', 'token', 'ds_token', 'auth_token', 'access_token', 'jwt'];
          for (const key of keys) {
            const t = tryGetToken(localStorage.getItem(key));
            if (t) return t;
          }
          return null;
        },
      });
      dsAuthToken = results?.[0]?.result || null;
      if (dsAuthToken) break;
    } catch {}
    if (attempt < 4) await new Promise(r => setTimeout(r, 1500));
  }

  if (needCleanup) {
    chrome.tabs.remove(tab.id).catch(() => {});
  }

  return dsAuthToken;
}

// SHA-256 PoW 求解器（纯 JS，可在 Service Worker 中运行）
async function dsSolvePowSha256(salt, challenge, difficulty) {
  const encoder = new TextEncoder();
  const targetBits = difficulty > 64 ? Math.floor(Math.log2(difficulty)) : difficulty;
  for (let nonce = 0; nonce < 1000000; nonce++) {
    const data = encoder.encode(salt + challenge + nonce);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    const hex = Array.from(hashArray, (b) => b.toString(16).padStart(2, '0')).join('');
    let leadingZeros = 0;
    for (const ch of hex) {
      const bits = parseInt(ch, 16);
      if (bits === 0) {
        leadingZeros += 4;
      } else {
        leadingZeros += Math.clz32(bits) - 28;
        break;
      }
    }
    if (leadingZeros >= targetBits) return nonce;
  }
  return -1;
}

// 从 API 响应中解析 PoW 挑战
function dsParsePowChallenge(respJson) {
  const data = respJson.data;
  const bizData = data && typeof data === 'object' ? data.biz_data : undefined;
  let challenge = (bizData && bizData.challenge) || (data && data.challenge) || respJson.challenge;
  if ((!challenge || typeof challenge !== 'object') && bizData && bizData.algorithm && bizData.salt) {
    challenge = bizData;
  }
  if ((!challenge || typeof challenge !== 'object') && data && typeof data === 'object' && data.algorithm && data.salt) {
    challenge = data;
  }
  if (!challenge || typeof challenge !== 'object') return null;
  const c = challenge;
  if (
    typeof c.algorithm !== 'string' ||
    typeof c.challenge !== 'string' ||
    typeof c.difficulty !== 'number' ||
    typeof c.salt !== 'string' ||
    typeof c.signature !== 'string'
  ) return null;
  // 补充 expire_at（外层 data / biz_data / raw）
  if (c.expire_at === undefined) {
    const d = respJson.data;
    const biz = d && typeof d === 'object' ? d.biz_data : undefined;
    c.expire_at = (biz?.expire_at) ?? (d?.expire_at) ?? respJson.expire_at ?? 0;
  }
  return c;
}

// DeepSeekHashV1 PoW 求解器（临时标签页 + WASM，求解后立即关闭）
async function dsSolvePowDeepSeekHashV1(powChallenge) {
  const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' });
  let tab = tabs.length > 0 ? tabs[0] : null;
  let needCleanup = false;

  if (!tab) {
    tab = await chrome.tabs.create({ url: DS_URL, active: false });
    await dsWaitTabComplete(tab.id, 20000);
    needCleanup = true;
  }

  try {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN',
        files: ['libs/wasm-solver.js'],
      });
    } catch {}

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: 'MAIN',
      func: (pc) => {
        if (typeof window.solvePowDeepSeekHashV1 !== 'function') return -1;
        return window.solvePowDeepSeekHashV1(pc).catch(() => -1);
      },
      args: [powChallenge],
    });

    return results?.[0]?.result ?? -1;
  } finally {
    if (needCleanup) {
      chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

// DeepSeek API 直连（无需持久标签页）
async function dsDirectSend(prompt, chatId, requestId, parentMessageId, mode) {
  const forward = (msg) => dsSendToBilibiliTab({ ...msg, requestId });
  const thinkingEnabled = mode !== 'fast';

  try {
    // 1. 获取 token
    const token = await dsEnsureToken();
    if (!token) {
      forward({ type: 'ds-error', error: '未获取到 DeepSeek 认证 Token，请先登录 chat.deepseek.com' });
      return;
    }

    const headers = {
      'Content-Type': 'application/json',
      Accept: '*/*',
      Referer: 'https://chat.deepseek.com/',
      Origin: 'https://chat.deepseek.com',
      'x-client-platform': 'web',
      'x-client-version': '1.7.0',
      'x-app-version': '20241129.1',
      Authorization: `Bearer ${token}`,
    };

    // 2. 创建/复用会话
    let sessionId = chatId;
    let sessionInvalid = false;
    const processor = dsCreateSSEProcessor();

    for (let retry = 0; retry <= 1; retry++) {
      sessionInvalid = false;

      if (!sessionId) {
        const res = await fetch('https://chat.deepseek.com/api/v0/chat_session/create', {
          method: 'POST', headers, credentials: 'include',
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          forward({ type: 'ds-error', error: `创建会话失败: HTTP ${res.status}` });
          return;
        }
        const json = await res.json();
        const d = json.data;
        const biz = d && typeof d === 'object' ? d.biz_data : undefined;
        sessionId = (biz && biz.id) || (d && d.id) || (d && d.chat_session_id) || '';
        if (!sessionId) {
          forward({ type: 'ds-error', error: '创建会话失败: 返回格式异常' });
          return;
        }
        dsUpdateChatId(sessionId);
      }

      // 3. 获取 PoW 挑战
      const powRes = await fetch('https://chat.deepseek.com/api/v0/chat/create_pow_challenge', {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify({ target_path: '/api/v0/chat/completion' }),
      });
      if (!powRes.ok) {
        forward({ type: 'ds-error', error: `获取 PoW 挑战失败: HTTP ${powRes.status}` });
        return;
      }
      const powJson = await powRes.json();
      console.log('[BiliSummary] PoW response:', JSON.stringify(powJson).slice(0, 500));
      // 尝试多种方式解析 PoW 挑战
      let powChallenge = dsParsePowChallenge(powJson);
      if (!powChallenge && powJson.data) {
        // 直接使用 data 对象（部分 API 版本）
        const d = powJson.data;
        const biz = d.biz_data || d;
        if (biz.algorithm && biz.challenge !== undefined) {
          powChallenge = { ...biz };
          if (powChallenge.expire_at === undefined) powChallenge.expire_at = d.expire_at || 0;
        }
      }
      if (!powChallenge) {
        forward({ type: 'ds-error', error: 'PoW 挑战格式异常: ' + JSON.stringify(powJson).slice(0, 200) });
        return;
      }

      // 4. 求解 PoW（支持 SHA-256 和 DeepSeekHashV1）
      let answer;
      if (powChallenge.algorithm === 'sha256') {
        answer = await dsSolvePowSha256(powChallenge.salt, powChallenge.challenge, powChallenge.difficulty);
      } else if (powChallenge.algorithm === 'DeepSeekHashV1') {
        answer = await dsSolvePowDeepSeekHashV1(powChallenge);
      } else {
        throw new Error(`NEED_TAB_FALLBACK: ${powChallenge.algorithm}`);
      }

      if (!isFinite(answer) || answer < 0) {
        forward({ type: 'ds-error', error: 'PoW 求解失败' });
        return;
      }

      // 5. 发送消息
      dsAbortController = new AbortController();
      const powResponse = btoa(JSON.stringify({ ...powChallenge, answer, target_path: '/api/v0/chat/completion' }));

      const completionRes = await fetch('https://chat.deepseek.com/api/v0/chat/completion', {
        method: 'POST',
        headers: { ...headers, 'x-ds-pow-response': powResponse },
        credentials: 'include',
        signal: dsAbortController.signal,
        body: JSON.stringify({
          chat_session_id: sessionId,
          parent_message_id: parentMessageId || null,
          prompt,
          ref_file_ids: [],
          thinking_enabled: thinkingEnabled,
          search_enabled: false,
          preempt: false,
        }),
      });

      if (!completionRes.ok) {
        const text = await completionRes.text().catch(() => '');
        if (text.includes('invalid chat session id')) { sessionInvalid = true; }
        else {
          forward({ type: 'ds-error', error: `HTTP ${completionRes.status}: ${text.slice(0, 200)}` });
          return;
        }
      }

      // 6. 流式读取 SSE
      if (completionRes.ok && completionRes.body) {
        const reader = completionRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // 先发送 sessionId
        if (sessionId) {
          processor.processChunk(`data: ${JSON.stringify({ type: 'deepseek:chat_session_id', chat_session_id: sessionId })}\n\n`);
        }

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          while (buffer.includes('\n')) {
            const idx = buffer.indexOf('\n');
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (line.startsWith('data: ')) {
              const chunk = line + '\n\n';
              const text = processor.processChunk(chunk);
              const cId = processor.getChatId();
              const mId = processor.getMessageId();
              if (mId) dsUpdateLastMessageId(mId);
              if (cId) dsUpdateChatId(cId);
              if (text) forward({ type: 'ds-chunk', text, chatId: cId });
            }
          }
        }

        const tail = processor.flush();
        if (tail) forward({ type: 'ds-chunk', text: tail });
        forward({ type: 'ds-done' });
        break;
      }

      // 会话失效重试
      if (sessionInvalid && retry === 0) {
        sessionId = null;
        parentMessageId = null;
        continue;
      }
      break;
    }
  } catch (e) {
    if (e.message && e.message.startsWith('NEED_TAB_FALLBACK:')) {
      throw e; // 让调用方决定回退
    }
    // AbortError 是用户主动停止，不报错
    if (e.name !== 'AbortError') {
      forward({ type: 'ds-error', error: `直连异常: ${String(e)}` });
    }
  } finally {
    dsAbortController = null;
  }
}

