# Plan: 移除 DeepSeek 可见标签页

## Context

当前浏览器 SDK 通道需要打开一个 `chat.deepseek.com` 标签页来：
1. 读取 localStorage 获取认证 token
2. 注入 WASM 求解 PoW 挑战
3. 在 MAIN world 中调用 DeepSeek API（绕过 CORS）

用户希望看不到这个标签页。改造方案：token 提取完即关闭标签页，API 调用改由 `background.js` service worker 直连。

## 核心思路

```
旧流程: 开标签页 → 注入脚本 → 标签页内 PoW + API 调用 → SSE 流 (标签页常驻)
新流程: 开标签页 → 提取 token → 关闭标签页 → 后台 PoW + API 调用 → SSE 流 (零标签页)
```

## 修改文件

### 1. `background.js` — 新增「通道 C：DeepSeek 直连通道」

新增函数：
- `dsEnsureToken()` — 找现有或临时创建 DeepSeek 标签页，executeScript 提取 token，关闭标签页
- `dsSolvePowSha256(salt, challenge, difficulty)` — 纯 JS SHA-256 PoW 求解器（`crypto.subtle.digest("SHA-256")`在 SW 中可用）
- `dsParsePowChallenge(json)` — 从 API 响应中解析 PoW 挑战对象
- `dsDirectSend(prompt, chatId, requestId, parentMessageId)` — 完整直连 API 调用

`dsDirectSend` 流程：
1. 调用 `dsEnsureToken()` 获取 token
2. 使用/创建 `chat_session_id`
3. 获取 PoW 挑战 → SHA-256 纯 JS 求解（DeepSeekHashV1 回退到标签页注入）
4. `fetch('https://chat.deepseek.com/api/v0/chat/completion', ...)` 发消息
5. 流式读取 SSE → 复用 `dsCreateSSEProcessor()` 解析 think/response 标记
6. 通过 `dsSendToBilibiliTab()` 转发到内容脚本

修改 `dsHandleSend()`：
- 默认走 `dsDirectSend()` 直连路径
- 捕获错误时回退到现有标签页注入方式

### 2. `background.js` — 修改 `dsCheckLogin()`

- 改为也调用 `dsEnsureToken()` 提取 token，不依赖持久标签页
- token 存在 → 已登录（不需要标签页保持打开）

### 3. 不变的文件

- `libs/deepseek-api.js` — 保留不动，作为 DeepSeekHashV1 PoW 回退路径
- `libs/deepseek-bridge.js` — 保留不动
- `libs/wasm-solver.js` — 保留不动
- `js/deepseek.js`、`js/panel.js` — 无需修改

## 验证

1. 打开扩展面板 → 不应再看到 `chat.deepseek.com` 标签页出现在标签栏
2. 点击「开始总结」→ 输出正常流动
3. 追问 → 多轮对话正常
4. 检查是否有残留标签页（DevTools → Application → Service Workers 无异常）