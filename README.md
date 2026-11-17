# BiliSummary — B站视频字幕抓取 + AI 总结

[![GitHub release](https://img.shields.io/github/v/release/guobaren/BiliSummary?style=flat-square\&label=version)](https://github.com/guobaren/BiliSummary/releases)
[![License](https://img.shields.io/github/license/guobaren/BiliSummary?style=flat-square)](LICENSE)

BiliSummary 是一个 Chrome 扩展，在 B 站视频页抓取字幕并接入 AI 生成结构化总结。

## 功能

- **浮窗入口** — 安装后网页右上角常驻图标浮窗，点击即可弹出主窗体
- **字幕抓取** — 自动获取 B 站视频字幕，支持多语言切换（中文优先）
- **章节支持** — 展示视频章节，点击跳转
- **字幕同步** — 播放时高亮当前字幕，支持自动滚动
- **AI 总结** — 三种用法可选：
  - **OpenCode Go（默认）**：内置 OpenCode Go 套餐预设，默认模型 DeepSeek V4.1 Flash，填入 OpenCode API Key 即可使用
  - **DeepSeek 浏览器 SDK**：登录 chat.deepseek.com 后使用，浏览器端直连 API，支持快速/专家模式切换
  - **自定义接口**：配置 Endpoint/API Key，兼容 OpenAI / Anthropic / Google / 本地 LLM 等
- **会话清理** — 扫描并批量删除 DeepSeek 中由插件生成的聊天记录
- **自动总结** — 打开面板时若 AI 通道就绪，自动开始总结（可在设置中关闭）
- **流式输出** — AI 思考过程和总结结果实时显示
- **追问功能** — 总结完成后可继续追问
- **SRT 导出** — 下载字幕为 .srt 文件
- **夜间模式** — 日/夜两套配色全局切换
- **自定义提示词** — 全屏编辑 AI 提示词，支持恢复默认

## 安装

### Chrome / Edge

1. 在 [Releases](https://github.com/guobaren/BiliSummary/releases) 下载最新 `bilisummary-v*-chrome.zip`
2. 解压到本地目录
3. 打开扩展管理页：`chrome://extensions/` 或 `edge://extensions/`
4. 开启"开发者模式"
5. 点击"加载已解压的扩展程序"，选择解压后的目录

### 从源码安装

```bash
git clone https://github.com/guobaren/BiliSummary.git
```

然后按步骤 3-6 加载扩展。

## 使用方法

1. 打开 B 站视频页，点击工具栏图标打开面板
2. 面板自动获取字幕（支持多语言切换）
3. 切换到 AI 总结标签页，确保 AI 通道已就绪（默认 OpenCode Go：填入 OpenCode API Key 即可）
4. 面板打开后自动开始总结（可在设置中关闭），也可手动点击「开始总结」
5. 完成后可追问

### AI 通道配置

**OpenCode Go（默认）：**

- 扩展默认使用 OpenCode Go 套餐，模型固定为 `deepseek-v4.1-flash`（DeepSeek V4.1 Flash）
- 打开 [OpenCode Console](https://opencode.ai/console) 订阅 Go 套餐并创建 API Key，粘贴到设置页「AI 接口配置」即可
- 默认 Endpoint：`https://opencode.ai/inference/go/openai/v1/chat/completions`（已内置，无需修改）
- 请求会携带 `x-opencode-session` 会话标识并按需请求 usage，设置页可查看本次计入的套餐额度
- DeepSeek 模型需要在 OpenCode Console 的 Privacy 设置中把 Regions 选为 Global 才能在部分网络环境下调用

**DeepSeek 浏览器 SDK：**

- 需要先登录 [chat.deepseek.com](https://chat.deepseek.com)
- 扩展自动检测登录状态，无需手动配置
- 首次使用会打开 DeepSeek 标签页提取认证信息
- 支持**快速模式**与**专家模式**切换：快速模式响应更快，专家模式启用深度思考（可在设置页 DeepSeek 选项下切换）

**自定义接口：**

- 在设置页「服务商」下拉中选择「自定义接口（OpenAI 兼容）」
- 填写 Endpoint（如 `https://api.deepseek.com/v1/chat/completions`）
- 填写 API Key 和模型名
- 支持 OpenAI、Anthropic、Google Gemini、本地 LLM 等兼容接口
- 点击「测试连接 / 获取模型」可校验 Key 并拉取模型列表
- 切换服务商时会为每个服务商分别保存 API Key，避免把上一个服务商的 Key 发给新服务商

### 面板功能

| 标签页   | 功能                                   |
| ----- | ------------------------------------ |
| AI 总结 | AI 总结、流式输出、追问                        |
| 字幕    | 字幕列表、复制、跳转、高亮同步                      |
| 设置    | 字幕语言、字体大小、行高、夜间模式、AI 通道、API 配置、提示词管理、DeepSeek 快速/专家模式 |

## 项目结构

```
BiliSummary/
├── manifest.json        # 扩展配置 (Manifest V3)
├── background.js        # Service Worker - API 代理、DeepSeek 直连通道、右键菜单
├── content.js           # 入口脚本 - 面板注入、路由监听
├── js/
│   ├── providers.js     # AI 服务商预设（默认 OpenCode Go）
│   ├── state.js         # 全局状态管理
│   ├── settings.js      # 设置持久化（含旧配置迁移）
│   ├── panel.js         # 面板 UI - 字幕/AI总结/设置三标签页
│   ├── subtitle.js      # 字幕获取、渲染、高亮同步
│   ├── chapter.js       # 章节获取、渲染
│   ├── deepseek.js      # DeepSeek 浏览器 SDK 通信模块
│   ├── api-ai.js        # 通用 API 通道模块
│   └── export.js        # SRT 导出
├── css/panel.css        # 面板样式（含暗色主题）
├── libs/
│   ├── deepseek-api.js    # DeepSeek MAIN world - PoW、completion、SSE
│   ├── deepseek-bridge.js # DeepSeek ISOLATED world - 消息桥接
│   └── wasm-solver.js     # PoW WASM 求解器
└── icons/
```

## 技术要点

- **Manifest V3** Chrome 扩展
- **双 AI 通道**：OpenCode Go / 通用 OpenAI 兼容 API（默认）与 DeepSeek 浏览器 SDK（直连 API + PoW 求解）
- **服务商预设**：`js/providers.js` 统一描述 Endpoint / 模型 / 鉴权头，OpenCode Go 固定 DeepSeek V4.1 Flash
- **OpenCode 协议适配**：请求携带 `x-opencode-session` 稳定会话 ID；流式请求开启 `stream_options.include_usage` 并解析 Go 套餐额度
- **双源字幕 API**：优先 `player/wbi/v2`（aid），回退 `player/v2`（bvid）
- **字幕语言排序**：中文 > 英文 > 其他，稳定排序
- **SPA 路由监听**：MutationObserver 检测 URL 变化
- **请求竞态控制**：fetchRunId 机制防止过期请求污染状态
- **SSE 流式解析**：支持多种 DeepSeek SSE 格式
- **PoW 求解**：WASM 求解 DeepSeekHashV1 挑战

## 兼容性

- Chrome 88+ (Manifest V3)
- Edge 88+ (Manifest V3)

## 常见问题

### OpenCode Go 报 401 / 403 / 429

- **401**：API Key 无效，请到 [OpenCode Console](https://opencode.ai/console) 重新创建并粘贴到设置页
- **403**：Key 无权访问该模型。请确认已订阅 OpenCode Go，且没有把免费模型当成套餐模型调用（免费模型仅限 OpenCode 客户端）
- **429**：OpenCode Go 的 5 小时 / 每周 / 每月额度已用尽，可在 Console 查看用量或开启 Extra Usage

另外，DeepSeek 模型需要把 Console 的 Privacy → Regions 设为 Global，部分网络环境下才能正常调用。

### 为什么 OpenCode Go 只有一个模型可选？

OpenCode Go 套餐仅提供 DeepSeek V4.1 Flash，因此预设把模型固定为 `deepseek-v4.1-flash`；Endpoint 也由预设固定，不需要手动填写。如果想用其他服务商，把「服务商」切换到「自定义接口」即可。

### API 请求返回 HTML 而非 JSON（如 `<!doctype` 错误）

这通常是因为请求头中的 `x-client-version` 版本号与 DeepSeek 当前线上版本不匹配，导致请求被重定向或拒绝。

插件会优先从 DeepSeek 页面动态读取版本号（通过 `window.__CLIENT_VERSION__`），读取失败时回退到硬编码默认值。如果控制台出现 `[BiliSummary] 未能动态读取 clientVersion` 警告，说明当前默认值可能已过时。

**解决方法：**
1. 打开 `chat.deepseek.com`，按 F12 打开开发者工具
2. 在 Network 标签页中筛选 `api/v0`，查看任意请求的 `x-client-version` 请求头获取当前版本号
3. 在插件设置中检查 API 配置是否正确

## 许可证

[MIT](LICENSE)

## 致谢

本工具基于 [hyglgithub/BiViNote](https://github.com/hyglgithub/BiViNote) 项目库开发，在原作基础上进行了功能重构和扩展。

## 免责声明

本工具仅在用户已登录 B 站、且有访问权限的前提下获取字幕数据。所有数据通过用户自己的浏览器获取，不经过任何第三方服务器。本工具不存储、不分发任何 B 站内容。使用本工具产生的所有后果由用户自行承担。
