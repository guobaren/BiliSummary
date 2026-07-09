# Changelog

## [1.1.2] - 2026-07-09

### Added
- 新增 DeepSeek 会话扫描与批量删除：扫描最近聊天记录，一键清除插件生成的会话
- 新增「打开后自动总结」设置开关：面板打开时若 AI 通道就绪自动开始总结

### Changed
- 扫描数量上限统一为 SCAN_LIMIT 常量（40 条）

## [1.1.1] - 2026-07-09

### Changed
- 更新 README 与 docs 落地页，新增 DeepSeek 快速/专家模式功能描述

## [1.1.0] - 2026-07-09

### Added
- 新增内容分类提示词模板：根据观点/故事/教程/测评/资讯自动适配总结格式
- 新增并发请求防护（dsPendingRequest），重复点击自动丢弃
- 新增 SSE 错误检测，模型繁忙等业务错误直接展示给用户
- 新增 DEEPSEEK_CHUNK 调试追踪日志及 __trace__ 消息拦截
- 新增标签页版本检测机制，旧代码版本自动重载
- 新增临时标签页自动关闭：请求完成后清理 DeepSeek 标签页

### Changed
- 重构总结提示词，按 5 种内容类型分别定义结构化输出格式
- dsHandleSend 由直连优先改为纯标签页注入模式
- deepseek-api.js 每次创建全新会话而非复用旧会话
- 重新设计会话 ID 提取逻辑：使用 biz_data.chat_session.id
- 移除注入防重防护标记（改用 message handler 引用管理）
- 更新 DeepSeek 页面版本号至 2.2.0 / 20250601.1

### Fixed
- 修复直连模式下偶发的 PoW 循环问题
- 修复 ds-done 过滤条件导致的部分请求无响应
- 修复 dsHandleSend 中 dsSenderTabs 设置时序（改为 sender.tab.id）
- 修复 storage.local 中 chatId 残留导致下次总结使用过期会话

## [1.0.1] - 2026-07-09

### Changed
- 更新项目品牌命名，统一使用 BiliSummary
- 重写 README 与 docs 落地页，聚焦当前“字幕抓取 + AI 总结”流程
- 精简展示页布局，改为单页概览并同步最新界面截图

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
