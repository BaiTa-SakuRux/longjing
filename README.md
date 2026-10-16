# 龙鲸X（LongjingX）

自用 SSH 运维工作台 + AI 助手。管理多台 Linux 服务器的多标签终端、文件面板，并可将 AI 对话接入自定义 API 或本机 ZCode / DeepSeek Harness 登录。

## 功能

- **多标签 SSH 终端**：密码 / 密钥认证，首次连接指纹确认（TOFU），断线重连
- **AI 助手**：三种后端任选——自定义 OpenAI 兼容 API、本机 ZCode 登录、本机 DeepSeek Harness（dsh）登录；流式输出、思考过程展示；AI 建议的命令渲染为一键执行按钮（执行必须人工确认）
- **文件面板**：本机 ↔ 远程双栏浏览、上传 / 下载（进度与取消）、在线编辑远端文本并保存回写
- **项目分组**：主机按项目分组、可折叠，支持导入 / 导出 JSON

## 安全模型

- AI 仅产出建议；**任何命令写入终端前都必须人工点击确认**
- 终端输出进入 AI 上下文前做了隔离标注，防提示注入
- 主机密码与 API Key 明文存储于本机 SQLite（`data/longjing.db`），**不上传任何服务器**；请自行评估本机磁盘安全

## 环境要求

- Node.js 18+ / pnpm
- Rust toolchain（MSVC）与 WebView2（Windows）

## 开发

```bash
pnpm install
pnpm tauri dev
```

## 打包

```bash
pnpm tauri build
```

## 许可

见 LICENSE。
