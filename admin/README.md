# 腰有据 · 后台管理系统

Vue 3 + Vite + TypeScript + Pinia + Vue Router。设计稿见 `docs/design/admin/`（B01–B12）。

## 启动

```bash
npm install
npm run dev        # 开发服务，默认端口 5203（http://127.0.0.1:5203）
npm run build      # 类型检查 + 构建
npm run typecheck  # 仅类型检查
```

依赖本地 server（默认 `http://127.0.0.1:3200`，见 `server/README.md`）。

## 演示账号

- 账号：`editor01` / `clinician01` / `tech01` / `compliance01` / `super01`（五个角色各一个）
- 口令：取 server `.env` 中 `ADMIN_DEMO_PASSWORD`（默认演示值见 `.env.example`）
- TOTP：取 server `.env` 中 `ADMIN_TOTP_DEMO_CODE`（默认演示值见 `.env.example`）
- 连续失败 5 次锁定 30 分钟；会话 30 分钟无操作过期（需重新登录）

## 页面与权限

| 路由 | 页面 | 所需权限（最小必要） |
|-|-|-|
| `/login` | B01 后台登录（含 MFA） | — |
| `/dashboard` | B02 仪表盘 | 登录即可 |
| `/contents` `/contents/:id` | B03 内容库列表 / B04 编辑与审核详情 | 登录即可查看；编辑 / 审核 / 发布 / 下线分别需要 `content.draft` / `content.review` / `content.publish` / `content.offline` |
| `/evidence` | B05 医学证据库 | 查看登录即可；写入 / 停用需要 `evidence.manage` |
| `/feedback` | B06 举报与反馈队列 | 查看登录即可；单条授权与处置需要 `feedback.handle` |
| `/safety` | B07 安全事件与应急开关 | 查看登录即可；变更开关需要 `switch.manage` |
| `/models` | B08 模型发布管理 | `model.manage` / `eval.manage` |
| `/users` | B10 用户与权限 | 查看登录即可；邀请 / 停用 / 重置 MFA 仅超级管理员 |
| `/audit` | B11 审计日志 | `audit.view`（导出申请与审批另需 `audit.export`） |
| `/cases` | B12 案例投稿审核（二期预留） | `case.manage`；发布受「案例卡片」开关控制 |

## 目录结构

```
src/
├── api/          request 封装（Bearer admin token）、auth、contents、feedback、safety、models、audit
├── stores/       auth（后台登录态、角色与权限）
├── theme/        tokens.css（主题变量，与用户端三端一致）、global.css
├── components/   StatusTag / AppButton / AppNotice / AppCard
├── layouts/      AdminLayout（侧边栏按角色显示菜单 + 顶栏；刷新后按令牌恢复身份）
├── router/       路由与登录态守卫（meta.permission 标记所需权限）
└── views/        login、dashboard、contents（含 ContentDetailView）、evidence、feedback、
                  safety、models、users、audit、cases
```

## 已知问题

- 提示与确认使用浏览器原生 `alert` / `confirm` / `prompt`（演示实现），后续替换为站内组件；
- 细粒度权限目前只过滤侧边栏菜单与路由元数据，越权请求由服务端 `PermissionGuard` 拒绝（403）；
- 邀请成员、新建内容草稿等表单为占位（toast 提示），状态机核心流程已可用；
- 事故记录由审计日志派生（下线 / 回滚 / 开关变更），未建独立事故工单流。
