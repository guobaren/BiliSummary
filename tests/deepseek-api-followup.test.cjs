const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'libs', 'deepseek-api.js'),
  'utf8',
);

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function sseResponse() {
  const chunks = [
    new TextEncoder().encode('data: {"response_message_id":"answer-2","v":"已收到追问"}\n\n'),
  ];
  return {
    ...jsonResponse({}, 200),
    body: {
      getReader() {
        return {
          async read() {
            return chunks.length
              ? { done: false, value: chunks.shift() }
              : { done: true, value: undefined };
          },
        };
      },
    },
  };
}

async function runFollowUp() {
  const requests = [];
  let messageHandler;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const token = 'test-token-long-enough';

  const window = {
    location: { origin: 'https://chat.deepseek.com' },
    postMessage(message) {
      if (message.type === 'DEEPSEEK_DONE') resolveDone(message);
      if (message.type === 'DEEPSEEK_ERROR') {
        throw new Error(message.error);
      }
    },
    addEventListener(type, handler) {
      if (type === 'message') messageHandler = handler;
    },
    removeEventListener() {},
  };

  const context = {
    window,
    localStorage: {
      length: 1,
      getItem(key) { return key === 'userToken' ? token : null; },
      key(index) { return index === 0 ? 'userToken' : null; },
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/create_pow_challenge')) {
        return jsonResponse({
          data: {
            biz_data: {
              algorithm: 'sha256',
              challenge: 'challenge',
              difficulty: 0,
              salt: 'salt',
              signature: 'signature',
            },
          },
        });
      }
      if (url.endsWith('/chat/completion')) return sseResponse();
      throw new Error(`追问不应调用此地址: ${url}`);
    },
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    AbortController,
    setTimeout(callback, delay, ...args) {
      if (delay >= 5000) return { mockedLongTimer: true };
      return setTimeout(callback, delay, ...args);
    },
    clearTimeout(timer) {
      if (!timer?.mockedLongTimer) clearTimeout(timer);
    },
    console,
    btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
  };

  vm.runInNewContext(source, context, { filename: 'deepseek-api.js' });
  assert.equal(typeof messageHandler, 'function', '应注册页面消息监听器');

  messageHandler({
    source: window,
    origin: window.location.origin,
    data: {
      type: 'DEEPSEEK_SEND',
      prompt: '请进一步解释',
      chatId: 'existing-chat-id',
      requestId: 'follow-up-request',
      parentMessageId: 'answer-1',
      thinking_enabled: true,
    },
  });

  await Promise.race([
    done,
    new Promise((_, reject) => setTimeout(() => reject(new Error('等待追问完成超时')), 1000)),
  ]);

  assert.equal(
    requests.some((request) => request.url.endsWith('/chat_session/create')),
    false,
    '追问不得创建新会话',
  );
  const completion = requests.find((request) => request.url.endsWith('/chat/completion'));
  assert.ok(completion, '追问必须实际调用 completion 接口');
  const body = JSON.parse(completion.options.body);
  assert.equal(body.chat_session_id, 'existing-chat-id');
  assert.equal(body.parent_message_id, 'answer-1');
  assert.equal(body.prompt, '请进一步解释');
}

runFollowUp()
  .then(() => console.log('PASS: 追问复用原会话并把问题发送到 completion 接口'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
