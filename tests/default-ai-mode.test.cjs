const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

async function run() {
  let runtimeListener;
  let sentMessage;
  const window = { BiliSummary: { DEFAULT_PROMPT: '默认提示词' } };
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) { runtimeListener = listener; },
      },
      sendMessage(message, callback) {
        sentMessage = message;
        if (callback) callback({ loggedIn: true });
      },
    },
    storage: {
      local: {
        get(keys, callback) { callback({}); },
        set(value, callback) { if (callback) callback(); },
        remove() {},
      },
    },
  };
  const context = {
    window,
    chrome,
    crypto: { randomUUID: () => 'request-id' },
    setTimeout() { return 1; },
    console,
  };

  vm.runInNewContext(read('js/state.js'), context, { filename: 'state.js' });
  assert.equal(window.BiliSummary.state.settings.aiMode, 'fast', '运行时初始模式应为快速');

  vm.runInNewContext(read('js/settings.js'), context, { filename: 'settings.js' });
  await window.BiliSummary.settings.load();
  assert.equal(window.BiliSummary.state.settings.aiMode, 'fast', '无保存配置时应加载快速模式');

  vm.runInNewContext(read('js/deepseek.js'), context, { filename: 'deepseek.js' });
  assert.equal(typeof runtimeListener, 'function', 'DeepSeek 模块应注册响应监听器');
  window.BiliSummary.deepseek.sendMarkdown('测试内容', '测试提示词');
  assert.equal(sentMessage.type, 'ds-send');
  assert.equal(sentMessage.mode, 'fast', '未显式指定模式时发送层应回退到快速模式');
}

run()
  .then(() => console.log('PASS: 默认 AI 模式为快速模式'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
