# 腰有据 · 服务端（server）

API 服务 + AI 任务 Worker。NestJS + TypeScript + SQLite（Node 24 内置 `node:sqlite`，无原生依赖，Windows 可直接运行）。

## 启动

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run dev               # API 服务，默认端口 3200（GET /health）
npm run worker            # AI 任务 Worker（另开一个终端，轮询消费任务表）
npm run seed              # 写入演示种子数据
```

生产模式：`npm run build` 后 `npm start` 与 `npm run start:worker`。

## 配置

从环境变量读取（见 `.env.example`）：

| 变量 | 默认 | 说明 |
|-|-|-|
| PORT | 3200 | API 端口 |
| DB_DIR | ./data | SQLite 文件目录（app.db / identity.db） |
| IDENTITY_ENCRYPTION_KEY | 空 | 身份隔离库字段加密密钥（AES-256-GCM，base64） |
| DEMO_SMS_CODE | 123456 | 演示短信验证码 |
| ADMIN_TOTP_DEMO_CODE | 123456 | 后台 TOTP 演示固定码 |
| ADMIN_DEMO_PASSWORD | 123456 | 后台演示账号登录密码（演示固定值） |
| WORKER_POLL_INTERVAL_MS | 1500 | Worker 轮询间隔 |

## 演示账号

- 用户端：任意 11 位手机号 + 验证码 `123456`；种子数据含 2 个演示用户（见 `npm run seed`）。
- 后台：5 个角色各一个账号（editor01 / clinician01 / tech01 / compliance01 / super01），TOTP 固定码 `123456`；登录密码取 `.env` 中 `ADMIN_DEMO_PASSWORD`（默认演示值见 `.env.example`）。

## 常用命令

```bash
npm run build      # 构建
npm run typecheck  # 类型检查
npm test           # 单元测试
```

## 已知问题

- 大模型为本地模拟实现（模板 + 证据片段），不调用任何外部服务。
- OCR 为模拟实现，返回示例文本；主路径是粘贴文字。
- 任务队列用 SQLite 任务表替代 Redis Streams，单机演示够用，不做多 Worker 并发保证。
