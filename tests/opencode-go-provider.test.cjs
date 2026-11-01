const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function createChrome(stored) {
  const state = {
    stored: stored || {},
    sentMessages: [],
    runtimeListener: null,
  };
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) { state.runtimeListener = listener; },
        removeListener(listener) { if (state.runtimeListener === listener) state.runtimeListener = null; },
      },
      sendMessage(message, callback) {
        state.sentMessages.push(message);
        if (callback) callback({ ok: true });
      },
    },
    storage: {
      local: {
        get(keys, callback) {
          const result = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const key of list) {
            if (Object.prototype.hasOwnProperty.call(state.stored, key)) result[key] = state.stored[key];
          }
          callback(result);
        },
        set(value, callback) { if (callback) callback(); },
        remove() {},
      },
    },
  };
  return { chrome, state };
}

function createContext(chrome) {
  return {
    window: { BiliSummary: { DEFAULT_PROMPT: '默认提示词' } },
    chrome,
    crypto: { randomUUID: () => 'request-id-1' },
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    console,
    URL,
  };
}

async function loadSettings(context, chrome, saved) {
  const ctx = vm.createContext(context);
  vm.runInContext(read('js/providers.js'), ctx, { filename: 'providers.js' });
  vm.runInContext(read('js/state.js'), ctx, { filename: 'state.js' });
  vm.runInContext(read('js/settings.js'), ctx, { filename: 'settings.js' });
  await context.window.BiliSummary.settings.load();
  return context.window.BiliSummary.state.settings;
}

async function testDefaultConfig() {
  const { chrome } = createChrome({});
  const context = createContext(chrome);
  const settings = await loadSettings(context, chrome, null);

  assert.equal(settings.aiChannel, 'api', '默认应使用 API 通道');
  assert.equal(settings.apiProvider, 'opencode-go', '默认服务商应为 OpenCode Go');
  assert.equal(
    settings.apiCfg.endpoint,
    'https://opencode.ai/inference/go/openai/v1/chat/completions',
    '默认 Endpoint 应为 OpenCode Go 的 OpenAI 兼容接口',
  );
  assert.equal(settings.apiCfg.model, 'deepseek-v4.1-flash', '默认模型应为 DeepSeek V4.1 Flash');
  assert.equal(settings.apiCfg.provider, 'opencode-go');

  const provider = context.window.BiliSummary.AI_PROVIDERS.get('opencode-go');
  assert.equal(
    provider.models.map(item => item.id).join(','),
    'deepseek-v4.1-flash',
    'OpenCode Go 预设只提供 DeepSeek V4.1 Flash',
  );
  assert.equal(provider.lockEndpoint, true, 'OpenCode Go 的 Endpoint 应为固定值');
}

async function testLegacyConfigMigration() {
  const legacy = {
    bilisummary_settings: {
      aiChannel: 'browser',
      apiCfg: {
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        apiKey: 'test-key-legacy',
        model: 'deepseek-v4-flash',
        stream: true,
      },
    },
  };
  const { chrome } = createChrome(legacy);
  const context = createContext(chrome);
  const settings = await loadSettings(context, chrome, legacy);

  assert.equal(settings.aiChannel, 'browser', '旧配置的通道选择应保留');
  assert.equal(settings.apiProvider, 'custom', '无法识别的旧 Endpoint 应回退为自定义接口');
  assert.equal(settings.apiCfg.endpoint, 'https://api.deepseek.com/v1/chat/completions', '旧 Endpoint 不应被覆盖');
  assert.equal(settings.apiCfg.model, 'deepseek-v4-flash', '旧模型不应被覆盖');
  assert.equal(settings.apiCfg.apiKey, 'test-key-legacy', '旧 API Key 不应被覆盖');
  assert.equal(settings.apiKeys.custom, 'test-key-legacy', '旧 Key 应归入自定义接口名下');
}

async function testOpenCodeConfigIsPinned() {
  const saved = {
    bilisummary_settings: {
      aiChannel: 'api',
      apiProvider: 'opencode-go',
      apiCfg: {
        provider: 'opencode-go',
        endpoint: 'https://example.com/wrong',
        apiKey: 'test-key-opencode',
        model: 'glm-5.3',
        stream: true,
      },
    },
  };
  const { chrome } = createChrome(saved);
  const context = createContext(chrome);
  const settings = await loadSettings(context, chrome, saved);

  assert.equal(settings.apiCfg.endpoint, 'https://opencode.ai/inference/go/openai/v1/chat/completions', 'OpenCode Go 应固定 Endpoint');
  assert.equal(settings.apiCfg.apiKey, 'test-key-opencode', 'API Key 应保留');
  assert.equal(settings.apiKeys['opencode-go'], 'test-key-opencode', 'OpenCode Go 的 Key 应按服务商保存');
}

async function testResetRestoresOpenCodeDefault() {
  const saved = {
    bilisummary_settings: {
      aiChannel: 'api',
      apiProvider: 'custom',
      apiKeys: { custom: 'test-key-custom' },
      apiCfg: {
        provider: 'custom',
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        apiKey: 'test-key-custom',
        model: 'deepseek-chat',
        stream: true,
      },
    },
  };
  const { chrome } = createChrome(saved);
  const context = createContext(chrome);
  const settings = await loadSettings(context, chrome, saved);
  assert.equal(settings.apiProvider, 'custom');

  context.window.BiliSummary.settings.resetDefaults();
  assert.equal(settings.apiProvider, 'opencode-go', '恢复默认应回到 OpenCode Go');
  assert.equal(settings.apiCfg.endpoint, 'https://opencode.ai/inference/go/openai/v1/chat/completions');
  assert.equal(settings.apiCfg.model, 'deepseek-v4.1-flash');
  assert.equal(settings.apiCfg.apiKey, '', '未保存过 OpenCode Key 时不应串用其他服务商的 Key');
  assert.equal(settings.apiKeys.custom, 'test-key-custom', '其他服务商的 Key 应保留在各自名下');
}

function testRequestBuilder() {
  const context = { window: {}, console, URL, crypto: { randomUUID: () => 'session-uuid' } };
  const ctx = vm.createContext(context);
  vm.runInContext(read('js/providers.js'), ctx, { filename: 'providers.js' });
  const providers = context.window.BiliSummary.AI_PROVIDERS;

  const request = providers.buildChatRequest({
    providerId: 'opencode-go',
    endpoint: 'https://opencode.ai/inference/go',
    apiKey: 'test-key-opencode',
    model: 'deepseek-v4.1-flash',
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    sessionId: 'bilisummary-session',
  });

  assert.equal(request.url, 'https://opencode.ai/inference/go/openai/v1/chat/completions', 'OpenCode 基础地址应被补全为 chat/completions');
  assert.equal(request.headers.Authorization, 'Bearer test-key-opencode');
  assert.equal(request.headers['x-opencode-session'], 'bilisummary-session', '应携带 OpenCode 会话头');
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.equal(request.payload.stream_options.include_usage, true, '应请求最终 usage 以展示 Go 额度');
  assert.equal(request.payload.model, 'deepseek-v4.1-flash');
  assert.equal(request.payload.stream, true);

  const custom = providers.buildChatRequest({
    providerId: 'custom',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: 'test-key-custom',
    model: 'deepseek-chat',
    messages: [],
    stream: true,
  });
  assert.equal(custom.url, 'https://api.deepseek.com/v1/chat/completions', '自定义接口的 Endpoint 应原样使用');
  assert.equal(custom.headers['x-opencode-session'], undefined, '自定义接口不应携带 OpenCode 会话头');
  assert.equal(custom.payload.stream_options, undefined, '自定义接口不应强制 include_usage');

  const legacy = providers.buildChatRequest({
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: 'test-key-openai',
    model: 'gpt-4o',
    messages: [],
    stream: false,
  });
  assert.equal(legacy.provider.id, 'custom', '未指定 provider 时按 Endpoint 回退为自定义接口');
  assert.equal(legacy.url, 'https://api.openai.com/v1/chat/completions');
}

function testModelListUrlsAndUsage() {
  const context = { window: {}, console, URL };
  const ctx = vm.createContext(context);
  vm.runInContext(read('js/providers.js'), ctx, { filename: 'providers.js' });
  const providers = context.window.BiliSummary.AI_PROVIDERS;

  const urls = providers.modelListUrls('https://opencode.ai/inference/go/openai/v1/chat/completions', 'opencode-go');
  assert.equal(urls[0], 'https://opencode.ai/inference/go/v1/models', '应优先使用 OpenCode Go 的模型列表地址');
  assert.ok(urls.includes('https://opencode.ai/inference/go/openai/v1/models'), '应保留按 OpenAI 路径推导的候选地址');

  const usage = providers.parseUsage({
    prompt_tokens: 410,
    completion_tokens: 310,
    cost: 0,
    opencode: {
      billing_source: 'go',
      allowance: 0.0041,
      tokens: { input: 410, output: 310, cache_read: 8000 },
    },
  });
  assert.equal(usage.inputTokens, 410);
  assert.equal(usage.outputTokens, 310);
  assert.equal(usage.allowance, 0.0041);
  assert.equal(usage.cacheRead, 8000);
  assert.equal(providers.isGoBilling(usage.billingSource), true, '应识别 Go 套餐计费来源');
}

async function testApiChannelSendsProviderAndSession() {
  const { chrome, state } = createChrome({});
  const context = createContext(chrome);
  const ctx = vm.createContext(context);
  vm.runInContext(read('js/providers.js'), ctx, { filename: 'providers.js' });
  vm.runInContext(read('js/state.js'), ctx, { filename: 'state.js' });
  vm.runInContext(read('js/settings.js'), ctx, { filename: 'settings.js' });
  vm.runInContext(read('js/api-ai.js'), ctx, { filename: 'api-ai.js' });
  await context.window.BiliSummary.settings.load();

  const api = context.window.BiliSummary.apiAI;
  const sessionId = api.newSession();
  assert.match(sessionId, /^bilisummary-/, '会话 ID 应有可识别前缀');

  const usageEvents = [];
  api.onUsage((usage) => usageEvents.push(usage));

  const sent = api.sendToApi([{ role: 'user', content: 'hi' }], {
    provider: 'opencode-go',
    endpoint: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
    apiKey: 'test-key-opencode',
    model: 'deepseek-v4.1-flash',
    stream: true,
  });

  const message = state.sentMessages.find(item => item.type === 'api-send');
  assert.ok(message, '应通过 background 发送 api-send');
  assert.equal(message.provider, 'opencode-go', '请求应显式携带服务商');
  assert.equal(message.sessionId, sessionId, '请求应携带稳定的 OpenCode 会话 ID');
  assert.equal(message.requestId, 'request-id-1');

  assert.equal(typeof state.runtimeListener, 'function', 'API 通道应注册响应监听器');
  state.runtimeListener({
    type: 'api-usage',
    requestId: 'request-id-1',
    usage: { prompt_tokens: 10, completion_tokens: 5, opencode: { billing_source: 'go', allowance: 0.001 } },
  });
  assert.equal(usageEvents.length, 1, 'usage 事件应转发到面板');
  assert.equal(usageEvents[0].opencode.billing_source, 'go');

  state.runtimeListener({ type: 'api-chunk', requestId: 'request-id-1', role: 'response', text: '你好' });
  state.runtimeListener({ type: 'api-done', requestId: 'request-id-1' });
  await sent;
  assert.equal(api.getState(), 'done', '收到 api-done 后状态应为 done');
}

function testPanelUsageAndProviderTag() {
  const hooks = {};
  const context = { window: { BiliSummary: { __testHooks: hooks } }, console, URL };
  const ctx = vm.createContext(context);
  vm.runInContext(read('js/providers.js'), ctx, { filename: 'providers.js' });
  vm.runInContext(read('js/panel.js'), ctx, { filename: 'panel.js' });

  context.window.BiliSummary.state = {
    settings: {
      aiChannel: 'api',
      apiProvider: 'opencode-go',
      apiCfg: {
        provider: 'opencode-go',
        endpoint: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
        model: 'deepseek-v4.1-flash',
      },
    },
  };
  const provider = hooks.getApiProvider();
  assert.equal(provider.id, 'opencode-go');

  const text = hooks.formatApiUsage({
    prompt_tokens: 410,
    completion_tokens: 310,
    cost: 0,
    opencode: { billing_source: 'go', allowance: 0.0041 },
  });
  assert.match(text, /OpenCode Go 额度/, '应标注 Go 套餐额度');
  assert.match(text, /\$0\.0041/, '应展示本次计入的额度');
  assert.match(text, /输入 410/, '应展示输入 tokens');

  const html = hooks.buildSettingHTML();
  for (const id of ['bn-api-provider', 'bn-api-provider-hint', 'bn-api-endpoint', 'bn-api-key',
    'bn-api-model-select', 'bn-api-model-input', 'bn-api-fetch-models', 'bn-api-status',
    'bn-api-stream', 'bn-api-key-link', 'bn-api-usage']) {
    assert.ok(html.includes(`id="${id}"`), `设置页应包含 #${id}`);
  }
  assert.match(html, /OpenCode Go 套餐（仅提供 DeepSeek V4.1 Flash）/, '设置页应说明默认套餐与模型');
}

async function run() {
  await testDefaultConfig();
  await testLegacyConfigMigration();
  await testOpenCodeConfigIsPinned();
  await testResetRestoresOpenCodeDefault();
  testRequestBuilder();
  testModelListUrlsAndUsage();
  await testApiChannelSendsProviderAndSession();
  testPanelUsageAndProviderTag();
}

run()
  .then(() => console.log('PASS: OpenCode Go 默认配置、请求头、额度与旧配置迁移'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
