# 🐋 龙鲸X（LongjingX）

> 自用 SSH 运维工作台 + AI 助手：多标签终端、文件管理、AI 命令助手，装进一个 12 MB 的绿色可执行文件。

## ✨ 特性

### 多标签 SSH 终端
- 密码 / 私钥（ed25519、RSA）双认证
- 首次连接 TOFU 指纹确认，防中间人
- 断线自动检测，一键重连
- 终端外观可调（字号、光标闪烁、回滚行数），保存即时生效

### 🤖 AI 助手（三种后端任选，免配置 Key）
- **自定义 API**：任意 OpenAI 兼容端点（GLM、DeepSeek、自建网关…）
- **ZCode 接入**：复用本机 ZCode 桌面版登录，保留其完整代理能力（本机工具执行）
- **DeepSeek 接入**：复用本机 DeepSeek Harness（dsh）登录，流式输出 + 思考过程展示
- 「读取终端」：把 SSH 会话最近输出喂给 AI，基于真实远程数据作答
- **环境感知**：自动告知 AI 当前连接的主机，避免答非所问
- AI 建议的命令渲染为一键执行按钮——**执行必须人工点击确认**
- 终端输出进入 AI 上下文前做隔离标注，防提示注入

### 🔒 隐私加密
- 默认：**系统级加密**（Windows DPAPI / 凭据管理器保护密钥），零使用成本
- 可选主密码：**AES-256-GCM + PBKDF2（SHA256，31 万轮）**，每次启动解锁一次
- 设置 / 更改 / 清除主密码时自动重加密全部敏感信息
- 主密码未解锁时，敏感字段不离开应用

### 📂 文件面板
- 本机 ↔ 远程双栏浏览
- 上传 / 下载带实时进度，可中途取消（自动清理半成品）
- 远端文本在线编辑（CodeMirror），保存回写

### 🗂 项目分组
- 主机按项目分组、可折叠，连接状态一目了然
- JSON 导入 / 导出，迁移备份方便

## 🔧 技术栈

Tauri 2 · Rust（russh、ring）· React 19 · TypeScript · xterm.js 6 · Tailwind CSS 4

## 🚀 快速开始

环境要求：Node.js 18+、pnpm、Rust toolchain（MSVC）、WebView2（Windows 10/11 自带）

```bash
pnpm install
pnpm tauri dev     # 开发模式
pnpm tauri build   # 打包（绿色 exe + NSIS 安装包 + MSI）
```

## 📦 AI 后端接入说明

| 后端 | 说明 |
|---|---|
| 自定义 API | 填 Base URL + API Key + 模型名，支持「获取模型列表」 |
| ZCode | 留空路径自动探测（`*/ZCode/resources/glm/zcode.cjs`） |
| DeepSeek | 留空路径自动探测（`%LOCALAPPDATA%\Programs\DeepSeek Harness\...`） |

接入 ZCode / dsh 时，会话历史保存在对应应用内，可在其官方界面中续接。

## ⚠️ 安全说明

- 主机密码与 API Key 存储于本机 SQLite（`data\longjing.db`），**不上传任何服务器**
- 已启用系统级 / 主密码加密，但请自行评估本机磁盘安全
- 「导出主机」功能生成**含明文密码**的 JSON，仅用于本机迁移，请妥善保管
- AI 后端为 ZCode 时，其代理能力作用于**本机**（非 SSH 远程服务器），可在设置中调整权限模式

## 📄 许可

[GPL-3.0](LICENSE)
