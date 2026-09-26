# 腰有据 · 用户端 Web

Vue 3 + Vite + TypeScript + Pinia + Vue Router。设计稿见 `docs/design/web/`（W01–W08）。

## 启动

```bash
npm install
npm run dev        # 开发服务，默认端口 5202（http://127.0.0.1:5202）
npm run build      # 类型检查 + 构建
npm run typecheck  # 仅类型检查
```

依赖本地 server（默认 `http://127.0.0.1:3200`，见 `server/README.md`）；接口地址可在页面左下角「设置」中切换（存储在 localStorage 键 `yyj_web_api_base_url`）。

## 目录结构

```
src/
├── api/          request 封装（统一 {code,data,message}、Bearer token）、auth、safety
├── stores/       auth（登录态，token 持久化到 localStorage）
├── theme/        tokens.css（主题变量，与 App / 后台三端一致）、global.css
├── components/   StatusTag / AppButton / AppNotice / AppCard / AppInput / BrandLogo
├── layouts/      DefaultLayout（顶部导航 + 内容区 + 底部说明）
├── router/       路由与登录态守卫（公开页：登录 / 就医提示 / 404）
└── views/        login、emergency、home、dashboard、qa、timeline、followup、account
```

## 主题变量

颜色 / 字号 / 圆角 / 间距全部定义在 `src/theme/tokens.css`（CSS 自定义属性），
与 `docs/design/README.md` 设计规范及 App 端、后台保持一致；状态标签语义三端一致。

## 演示账号

- 用户端：任意 11 位手机号 + 验证码 `123456`。
- 就医提示页（/emergency）无需登录即可访问。

## 已知问题

- 首页 / 当前情况 / 问与解释 / 病程 / 复诊准备 / 账户页为占位页，将按 W02–W08 设计稿在后续任务中实现；
- 登录成功提示使用浏览器 alert（演示实现），后续替换为站内 toast；
- 验证码倒计时在页面刷新后重置（演示实现）。
