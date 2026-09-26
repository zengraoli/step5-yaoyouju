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
- 密码：取 server `.env` 中 `ADMIN_DEMO_PASSWORD`（默认演示值见 `.env.example`）
- TOTP：取 server `.env` 中 `ADMIN_TOTP_DEMO_CODE`（默认演示值见 `.env.example`）
- 连续失败 5 次锁定 30 分钟；会话 30 分钟无操作过期

## 目录结构

```
src/
├── api/          request 封装（Bearer admin token）、auth
├── stores/       auth（后台登录态、角色与权限）
├── theme/        tokens.css（主题变量，与用户端三端一致）、global.css
├── components/   StatusTag / AppButton / AppNotice / AppCard
├── layouts/      AdminLayout（侧边栏按角色显示菜单 + 顶栏）
├── router/       路由与登录态守卫（meta.permission 标记所需权限）
└── views/        login、dashboard、contents、evidence、feedback、safety、models、users、audit、cases
```

## 已知问题

- 仪表盘 / 内容库 / 证据库 / 举报反馈 / 安全开关 / 模型评测 / 用户权限 / 审计日志 / 案例投稿为占位页，将按 B02–B12 设计稿在后续任务中实现；
- 权限过滤目前只过滤侧边栏菜单与路由元数据，细粒度权限校验依赖服务端（越权请求返回 403）。
