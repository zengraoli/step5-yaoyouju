# 腰有据 · 服务端（server）

API 服务 + AI 任务 Worker。NestJS + TypeScript + SQLite（Node 24 内置 `node:sqlite`，无原生依赖，Windows 可直接运行）。

## 启动

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run dev               # API 服务，默认端口 3200（GET /health）
npm run worker            # AI 任务 Worker（另开一个终端，轮询消费任务表）
npm run smoke             # 端到端冒烟测试（需先启动 API；脚本自行启动 Worker 子进程）
npm run seed              # 写入演示种子数据（仅在库为空时写入）
```

- **API 服务**：开发 `npm run dev`（端口 3200）；生产 `npm run build` 后 `npm start`。
- **AI 任务 Worker**：开发 `npm run worker`；生产 `npm run start:worker`（`npm run build` 后）。Worker 为独立进程，轮询消费 `analysis_task` 表。
- **冒烟测试** `npm run smoke`：用独立测试手机号 `13700008888` 依次跑通 登录 → 同意 → 关键变化确认 → 录入报告 → 结构化核对 → 生成一页分析（含 Worker 消费）→ 原文对照 → 记录今天 → 生成复诊摘要，并另跑红旗命中分支（应返回 `40910/40911` + 就医提示且不建任务）；全部通过输出 `SMOKE OK`。**运行前需先在另一终端 `npm run dev`**（脚本先探测 `/health`，未运行则给出明确提示并以非 0 退出；Worker 由脚本自行以子进程启动、结束后关闭）。
- **接口文档（OpenAPI / Swagger）**：启动 API 后访问 `http://127.0.0.1:3200/api-docs`（标题「腰有据服务端 API」）。文档主要展示路径与参数；实际响应由全局拦截器统一包装为 `{ code, data, message }`。

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
| ADMIN_TOKEN_SECRET | 空 | 后台令牌签名密钥（HMAC-SHA256；未设置时用派生密钥，仅限本地演示） |
| AUDIT_ANCHOR_KEY | 空 | 审计链头锚点校验和密钥（HMAC-SHA256；未设置时在 `DB_DIR/.audit-anchor-key` 生成随机密钥文件，生产必须显式配置） |
| WORKER_POLL_INTERVAL_MS | 1500 | Worker 轮询间隔 |

## 演示账号

- 用户端：任意 11 位手机号 + 验证码 `123456`（取 `.env` 的 `DEMO_SMS_CODE`）；种子数据含 2 个演示用户（见 `npm run seed`）。
- 后台：5 个角色各一个账号，**无自助注册**，账号由超级管理线下开通：

  | 账号 | 角色 | 权限（最小必要，见 `src/modules/admin/admin.constants.ts`） |
  |-|-|-|
  | editor01 | 运营编辑 | content.draft / content.submit（发布由临床审核 / 超级管理做） |
  | clinician01 | 临床审核 | content.review / content.publish / content.offline |
  | tech01 | 技术 | model.manage / eval.manage / switch.manage / evidence.manage |
  | compliance01 | 合规 | feedback.view / feedback.handle / audit.view / consent.view / audit.export / dual_control.manage |
  | super01 | 超级管理 | 全部权限（`*`） |

  登录口令取 `.env` 的 `ADMIN_DEMO_PASSWORD`，TOTP 取 `.env` 的 `ADMIN_TOTP_DEMO_CODE`（默认演示值见 `.env.example`，仓库不保存明文）。
  连续输错 5 次锁定 30 分钟；后台令牌 30 分钟有效（`Authorization: Bearer <admin token>`），与用户端令牌互不通用。

## 后台接口（/admin，需后台令牌；越权返回 40300 并写审计）

| 方法 | 路径 | 说明 | 权限 |
|-|-|-|-|
| POST | /admin/auth/login | 账号 + 口令 + TOTP 登录（公开，失败写审计） | — |
| POST | /admin/auth/logout | 登出（写审计） | 已登录 |
| GET | /admin/auth/me | 当前后台账号（角色、权限） | 已登录 |
| GET | /admin/roles | 角色与权限矩阵（B10） | 已登录 |
| GET | /admin/audit | 审计日志筛选（操作人 / 动作 / 时间范围）+ 分页 | audit.view |
| GET | /admin/audit/verify | 哈希链校验 | audit.view |
| POST | /admin/audit/export-request | 审计导出申请（状态待审批） | audit.export |
| POST | /admin/audit/export-approve | 导出审批（不能审批本人提交的申请） | audit.export |
| GET | /admin/authorizations | 单条授权记录（T12 authorize-view） | consent.view |
| GET / PUT | /admin/dual-control/settings | 双人确认开关（写审计） | dual_control.manage |

## 常用命令

```bash
npm run dev        # 开发运行 API（监听变更，端口 3200）
npm run build      # 构建
npm run typecheck  # 类型检查
npm test           # 单元测试（jest；冒烟脚本不计入）
npm run smoke      # 端到端冒烟测试（需先 npm run dev）
```

## 验收 / 回归脚本（都先启动 server，必要时再启动 worker）

| 脚本 | 覆盖内容 | 运行方式 |
|-|-|-|
| `scripts/redflag-cases.mjs` | 约 97 条红旗说法 / 否定或日常说法 / 正常报告，**每条用新病程**走 `/analyses` 统计命中率与误判率 | `node scripts/redflag-cases.mjs` |
| `scripts/redflag-extra.mjs` | 另一批自编红旗与否定说法（同样每条新病程） | `node scripts/redflag-extra.mjs` |
| `scripts/rf-quickcheck.ts` | 纯函数快速核对（无需启动 server）：上面两批 + 第五轮反馈原句 | `npx tsx scripts/rf-quickcheck.ts` |
| `scripts/round5-newcases.ts` | 第五轮自编 41 条说法（纯函数） | `npx tsx scripts/round5-newcases.ts` |
| `scripts/round7-feedback.ts` | 第七轮反馈的 61 条说法（10 条病历 / 报告写法 + 27 条换种说法 + 12 条误判 + 14 条越界，纯函数） | `npx tsx scripts/round7-feedback.ts` |
| `scripts/round8-cases.ts` | 第八轮独立新编 100 条（60 应触发 + 40 不触发，纯函数逐条核对） | `npx tsx scripts/round8-cases.ts` |
| `scripts/round8-api.mjs` | 上述 100 条用「新用户 + 新病程」走真实 `/analyses` 统计命中率与误判率（先 `gen-round8-data.ts` 生成数据） | 先启动 server | `node scripts/round8-api.mjs` |
| `scripts/scope-variants.ts` | 越界提问变体（「这个情况是不是应该做手术」等）抽查（纯函数） | `npx tsx scripts/scope-variants.ts` |
| `scripts/round4-verify.mjs` | 第四轮接口级复查（删除账户、令牌吊销、双人确认、审计链、权限矩阵） | `node scripts/round4-verify.mjs` |
| `scripts/acceptance-check.mjs` / `admin-check.mjs` / `browser-check.mjs` / `browser-flow.mjs` | 三端联调、后台五角色走查、浏览器全流程 | 见脚本头部注释 |
| `scripts/integration.mjs` | 三端联调（`npm run integration`） | 需 server + worker |

安全规则的自编说法语料（应命中 / 应不命中 / 正常报告）集中在
`src/modules/safety/safety.corpus.ts`，由 `safety.spec.ts` 逐条断言；
纯函数脚本与接口脚本的结果应当一致。

## 已知问题

- 大模型为本地模拟实现（模板 + 证据片段），不调用任何外部服务。
- OCR 为模拟实现，返回示例文本；主路径是粘贴文字。
- 任务队列用 SQLite 任务表替代 Redis Streams，单机演示够用，不做多 Worker 并发保证。
- 冒烟测试使用独立测试手机号 `13700008888`，其产生的数据仅归属该测试用户（不影响种子演示用户），默认保留以便复查，可重复运行。
