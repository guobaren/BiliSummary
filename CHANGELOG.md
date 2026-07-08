# Changelog

## [1.0.0] - 2026-07-09

### Added
- 新增通用 AI API 通道（OpenAI 兼容协议），支持自定义 Endpoint/API Key/模型
- 新增 background.js Service Worker，接管 CORS 代理和 DeepSeek 直连通信
- 新增右键菜单（浮动图标常驻开关）
- 新增内容安全策略支持 WASM 运行

### Changed
- 重构面板 UI：精简为三标签页（AI 总结 / 字幕 / 设置）
- 移除截图功能及相关模块（capture.js、crop-viewer.js、cropper.js、jszip）
- 移除视频信息页
- 简化导出模块：仅保留 SRT 导出
- 优化 subtitle/chapter/export 模块，移除截图相关代码
- 锁定 host_permissions 为 B 站域名

### Fixed
- 修复 API 通道"停止"按钮无效（真实 abort 底层 fetch）
- 修复 DEEPSEEK_CHUNK 消息重复处理导致的双倍输出
- 修复 dsSenderTabId 并发竞态（改为 Map 结构）
- 修复 PoW 标签页每次总结时重复创建的问题
- 修复登录检测不准确（cookie 存在时创建专用标签页重试 token 提取）
- 修复登录按钮无法打开登录页（忽略流式状态，始终前台打开）
- 修复连接检测轮询永不停止（改用固定 30s 超时）
- 修复 DeepSeek 登出后仍显示已登录（开始总结前重新检测）
- 修复 deepseek-api.js sendDeepSeekMessage 缩进混乱
- 修复 panel 创建时 Footer 按钮初始出现在错误标签页
