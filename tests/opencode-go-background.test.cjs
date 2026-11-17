const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const encoder = new TextEncoder();

function sseResponse(chunks) {
  let index = 0;
  return {
    ok: true,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'text/event-stream; charset=utf-8' : null;
      },
    },
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: encoder.encode(chunks[index++]) };
          },
        };
      },
    },
  };
}

async function waitFor(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('等待超时');
}

async function run() {
  const forwarded = [];
  const fetchCalls = [];
  let onMessageListener = null;
  let unauthorized = false;

  const context = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    AbortController,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => 'request-uuid' },
    chrome: {
      runtime: {
        lastError: null,
        onMessage: {
          addListener(listener) { onMessageListener = listener; },
          removeListener() {},
        },
        onInstalled: { addListener() {} },
      },
      tabs: {
        onUpdated: { addListener() {}, removeListener() {} },
        onActivated: { addListener() {} },
        onRemoved: { addListener() {} },
        async query() { return [{ id: 42 }]; },
        async sendMessage(tabId, message) { forwarded.push({ tabId, message }); },
        async get() { return { id: 42, url: 'https://www.bilibili.com/video/BV1xx' }; },
      },
      contextMenus: {
        onClicked: { addListener() {} },
        removeAll(callback) { if (callback) callback(); },
        create() {},
      },
      action: {
        onClicked: { addListener() {} },
        async setIcon() {},
        async setTitle() {},
      },
      storage: {
        local: {
          get(keys, callback) { if (callback) callback({}); },
          set(value, callback) { if (callback) callback(); },
        },
      },
      scripting: { async executeScript() { return []; } },
    },
    async fetch(url, options) {
      fetchCalls.push({ url, options });
      if (unauthorized) {
        return {
          ok: false,
          status: 401,
          async text() { return '{"error":"invalid api key"}'; },
        };
      }
      if (String(url).includes('/models')) {
        return {
          ok: true,
          headers: { get(name) { return String(name).toLowerCase() === 'content-type' ? 'application/json' : null; } },
          async json() {
            return { data: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }] };
          },
        };
      }
      return sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"这是总结"}}]}\n\ndata: {"choi',
        'ces":[],"usage":{"prompt_tokens":410,"completion_tokens":310,"cost":0,"opencode":{"billing_source":"go","allowance":0.0041}}}\n\n',
        'data: [DONE]\n\n',
      ]);
    },
  };

  // 模拟 Service Worker 的 importScripts：在同一上下文中执行共享脚本
  context.importScripts = (...files) => {
    for (const file of files) {
      vm.runInContext(read(file), ctx, { filename: file });
    }
  };

  const ctx = vm.createContext(context);
  vm.runInContext(read('background.js'), ctx, { filename: 'background.js' });

  assert.equal(typeof onMessageListener, 'function', 'background 应注册消息监听器');

  onMessageListener(
    {
      type: 'api-send',
      requestId: 'rid-1',
      provider: 'opencode-go',
      endpoint: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
      apiKey: 'test-key-opencode',
      model: 'deepseek-v4.1-flash',
      stream: true,
      sessionId: 'bilisummary-session-1',
      messages: [{ role: 'user', content: '总结一下' }],
    },
    {},
    () => {},
  );

  await waitFor(() => forwarded.some(item => item.message.type === 'api-done'));

  assert.equal(fetchCalls.length, 1, '应发起一次 API 请求');
  const request = fetchCalls[0];
  assert.equal(request.url, 'https://opencode.ai/inference/go/openai/v1/chat/completions');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key-opencode', '应携带 Bearer API Key');
  assert.equal(request.options.headers['x-opencode-session'], 'bilisummary-session-1', '应携带 OpenCode 会话头');

  const body = JSON.parse(request.options.body);
  assert.equal(body.model, 'deepseek-v4.1-flash');
  assert.equal(body.stream, true);
  assert.equal(body.stream_options.include_usage, true, '流式请求应要求返回 usage');

  const tabId = forwarded[0].tabId;
  assert.equal(tabId, 42, '消息应回传到发起请求的标签页');

  const chunks = forwarded.filter(item => item.message.type === 'api-chunk');
  assert.equal(chunks.length, 2, '应分别转发思考与正文 chunk');
  assert.equal(chunks[0].message.role, 'think');
  assert.equal(chunks[0].message.text, '思考中');
  assert.equal(chunks[1].message.role, 'response');
  assert.equal(chunks[1].message.text, '这是总结');

  const usage = forwarded.find(item => item.message.type === 'api-usage');
  assert.ok(usage, '应转发 usage 供面板显示 Go 额度');
  assert.equal(usage.message.usage.opencode.billing_source, 'go');
  assert.equal(usage.message.usage.opencode.allowance, 0.0041);

  assert.ok(forwarded.some(item => item.message.type === 'api-done'), '应转发完成信号');
  assert.equal(forwarded.some(item => item.message.type === 'api-error'), false, '正常流程不应产生错误');

  // 模型列表：应命中 OpenCode Go 的 /inference/go/v1/models
  let modelsResponse = null;
  onMessageListener(
    {
      type: 'api-fetch-models',
      endpoint: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
      apiKey: 'test-key-opencode',
      provider: 'opencode-go',
    },
    {},
    (response) => { modelsResponse = response; },
  );
  await waitFor(() => modelsResponse !== null);

  assert.equal(modelsResponse.ok, true, '模型列表请求应成功');
  assert.equal(modelsResponse.models[0].id, 'deepseek-v4.1-flash');
  const modelsCall = fetchCalls.find(call => String(call.url).includes('/models'));
  assert.ok(modelsCall, '应请求模型列表地址');
  assert.equal(modelsCall.url, 'https://opencode.ai/inference/go/v1/models', '应使用 OpenCode Go 的模型列表地址');
  assert.equal(modelsCall.options.headers.Authorization, 'Bearer test-key-opencode');
  assert.ok(modelsCall.options.headers['x-opencode-session'], '模型列表请求也应携带会话头');

  // 401：应给出 OpenCode 专属排障提示
  unauthorized = true;
  onMessageListener(
    {
      type: 'api-send',
      requestId: 'rid-2',
      provider: 'opencode-go',
      endpoint: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
      apiKey: 'test-key-wrong',
      model: 'deepseek-v4.1-flash',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    },
    {},
    () => {},
  );
  await waitFor(() => forwarded.some(item => item.message.type === 'api-error' && item.message.requestId === 'rid-2'));
  const errorMessage = forwarded.find(item => item.message.type === 'api-error' && item.message.requestId === 'rid-2').message.error;
  assert.match(errorMessage, /HTTP 401/, '应包含状态码');
  assert.match(errorMessage, /OpenCode Console/, '应提示到 OpenCode Console 重新创建 Key');
}

run()
  .then(() => console.log('PASS: background 按 OpenCode Go 协议发送请求并转发用量'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
