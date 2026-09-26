# 腰有据 · 腰痛理解与复诊助手（演示实现）

> 演示项目，所有用户、报告、病程和医学内容均为虚构示例数据；产品不作诊断、不给用药或手术建议。

帮助腰痛用户看懂检查报告、整理病程、准备复诊：录入当前变化与报告后，系统生成"一页理性分析"
（已知 / 解释 / 未知 / 下一步 / 视频）并整理成复诊摘要。需求见 `docs/brief.md`，系统设计见
`docs/system-design.md`，设计稿见 `docs/design/`（38 页），设计走查记录见 `docs/design-review.md`。

- 提交作者 `step-5-preview`：模型自己的提交
- 提交作者 `host`：主持者的初始化或人工介入

## 仓库结构

| 目录 | 内容 | 技术栈 |
|-|-|-|
| `server/` | API 服务与 AI 任务 Worker | Node.js 24 + TypeScript + NestJS + SQLite（`node:sqlite`） |
| `app/` | 用户端 App | uni-app（Vue 3 + Vite + TypeScript），H5 构建验收 |
| `web/` | 用户端 Web | Vue 3 + Vite + TypeScript + Pinia + Vue Router |
| `admin/` | 后台管理系统 | Vue 3 + Vite + TypeScript + Pinia + Vue Router |
| `docs/` | 需求、系统设计、设计稿、设计走查 | — |
| `todo/` | 任务明细（已完成任务移至 `todo/completed/`） | — |

## 快速开始（从零启动）

端口约定：server `3200`、app `5201`、web `5202`、admin `5203`。启动前确认端口空闲。

```bash
# 1. 服务端（API + 数据库 + 种子数据）
cd server
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run dev                 # API：http://127.0.0.1:3200（首次启动自动建表并写入演示数据）

# 2. AI 任务 Worker（另开一个终端；不启动时分析任务保持排队）
cd server
npm run worker

# 3. 用户端 App（H5）
cd app
npm install
npm run dev:h5              # http://127.0.0.1:5201

# 4. 用户端 Web
cd web
npm install
npm run dev                 # http://127.0.0.1:5202

# 5. 后台管理系统
cd admin
npm install
npm run dev                 # http://127.0.0.1:5203
```

验证：`cd server && npm run smoke`（端到端冒烟：登录 → 同意 → 关键变化 → 录入报告 →
核对 → 生成分析 → 记录今天 → 复诊摘要）、`npm run integration`（三端联调：反馈举报进后台、
开关关闭回退、内容下线定位引用，需 server + worker 已启动）。

## 默认账号

| 端 | 账号 | 说明 |
|-|-|-|
| 用户端（App / Web） | 任意 11 位手机号 | 验证码固定 `123456`；种子数据含 2 个演示用户（`13800001234` 张岚、`13900005678` 李成），带病程、报告与分析 |
| 后台 | `editor01` / `clinician01` / `tech01` / `compliance01` / `super01` | 五个角色各一个；口令取 `server/.env` 的 `ADMIN_DEMO_PASSWORD`，TOTP 取 `ADMIN_TOTP_DEMO_CODE`（默认演示值见 `.env.example`）；连续失败 5 次锁定 30 分钟 |

重置演示数据：停止 server 后删除 `server/data/*.db`，重启即按当前种子重新播种。

## 演示实现与原设计的差异

| 原设计 | 本项目 |
|-|-|
| PostgreSQL 业务库 | SQLite 文件 `server/data/app.db` |
| 身份隔离库（字段加密） | 独立 SQLite `server/data/identity.db`；手机号 / 姓名 AES-256-GCM 加密 + 盲索引查找，密钥从环境变量读取 |
| Redis Streams 任务队列 | SQLite 任务表；Worker 为独立进程 `npm run worker` 轮询消费 |
| pgvector 向量库 | 证据片段表 + 本地检索（关键词 + 本地计算的 16 维向量，余弦相似度） |
| 大模型服务商 | 可替换适配层接口；默认本地模拟实现（模板 + 证据片段），不调用外部服务 |
| OCR | 模拟实现，返回示例文本；主路径是粘贴文字 |
| 短信 | 验证码固定 `123456`，只写日志（手机号脱敏） |
| 后台 TOTP | 演示固定码（`ADMIN_TOTP_DEMO_CODE`，默认 `123456`） |
| 对象存储 / 视频 CDN | 本地文件与本地占位图，不引用外部资源 |
| 复诊摘要导出 PDF | 文本复制必做；PDF / 图片通过浏览器打印生成 |
| 口令哈希 | sha256('yaoyouju:' + 口令) 演示算法（生产应使用 bcrypt / scrypt） |

## 产品红线（所有端遵守）

1. 不作诊断，不给用药、手术建议；越界问题明确不答，可转为复诊问题。
2. 缺失信息显示"尚未确认"，不默认为阴性或"无"；报告未描述显示"报告未提及"，不显示"已排除"。
3. 命中红旗信号立即显示就医提示，不被登录、付费、上传或长问卷阻断，并停止个性化分析。
4. 每条解释都能看到来源；系统生成内容带版本号，不标为事实来源。
5. 反馈与举报不自动进入训练或内容库。
6. 示例数据全部为虚构演示数据。

## 已知问题

1. **大模型为本地模拟实现**：分析按模板与证据片段生成，表达多样性有限；检索为关键词 +
   本地向量，未做中文分词与语义向量。
2. **后台登录态 30 分钟过期**：过期后操作会跳转登录页（演示短会话），重新登录即可。
3. **Worker 为单进程轮询**：未启动 Worker 时分析任务保持排队（属预期）；多 Worker 并发
   不做任务抢占保证。
4. **案例投稿为二期预留**：发布受「案例卡片」功能开关控制（默认关闭），界面与数据为演示。
5. **小程序端未适配**：App 以 H5 构建验收；Android 打包可选，未在真机验证。
6. **导出 PDF / 图片由浏览器打印生成**：不同浏览器的打印分页与页脚可能有差异。
7. **联调脚本会改动演示数据**：`npm run integration` 会将一条已发布内容下线；重复运行请
   按上文方式重置演示数据。
8. **审计日志按月分区归档为设计预留**：当前实现为单表 + 哈希链校验，未接对象存储归档。

## 开发约定

见 `AGENTS.md`：任务在 `todo/` 下一个任务一个文件，按编号顺序完成；完成后标记状态、移至
`todo/completed/`、提交并推送；提交信息一行（版本号 + 不超过 30 字中文说明）。
