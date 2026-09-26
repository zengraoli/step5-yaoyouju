# 腰有据 · 用户端 Web

Vue 3 + Vite + TypeScript + Pinia + Vue Router。设计稿见 `docs/design/web/`（W01–W08），
设计规范见 `docs/design/README.md`（与 App、后台三端一致）。

## 启动

```bash
npm install
npm run dev        # 开发服务，默认端口 5202（http://127.0.0.1:5202）
npm run build      # 类型检查 + 构建
npm run typecheck  # 仅类型检查
```

依赖本地 server（默认 `http://127.0.0.1:3200`，见 `server/README.md`）。

## 页面

| 路由 | 页面 |
|-|-|
| `/login` | W01 登录与授权（双勾选、就医提示不被登录阻断） |
| `/dashboard` | W02 当前情况（待确认项 / 最新一页分析 / 复诊与最近记录） |
| `/analysis` | W03 一页分析 + 原文对照（右侧原文随点击的解释高亮） |
| `/qa` | W04 问与解释（越界不答、一键加入复诊问题） |
| `/timeline` | W05 病程与记录（14 天图 + 时间线 + 记录今天常驻表单） |
| `/followup` | W06 复诊准备（六段编辑、问题清单排序、A4 打印预览、导出 / 打印 / 复制） |
| `/contents` | W07 审核内容库（卡片网格 + 详情抽屉） |
| `/account` | W08 账户与数据（同意记录可查可撤回、导出 / 删除、反馈工单进度） |
| `/emergency` | 就医提示（公开页，无需登录，网络异常有静态兜底） |

## 目录结构

```
src/
├── api/          request 封装（统一 {code,data,message}、Bearer token）、auth、contents、
│                 episodes、reports、analyses、followup、qa、feedback、safety
├── stores/       auth（登录态，token 持久化到 localStorage）
├── theme/        tokens.css（主题变量，与 App / 后台三端一致）、global.css
├── components/   StatusTag / AppButton / AppNotice / AppCard / AppInput / BrandLogo
├── layouts/      DefaultLayout（顶部导航 + 内容区 + 底部说明）
├── router/       路由与登录态守卫
└── views/        login、dashboard、analysis、qa、timeline、followup、contents、account、emergency
```

## 演示账号

- 用户端：任意 11 位手机号 + 验证码 `123456`；种子演示用户 `13800001234` / `13900005678`。
- 就医提示页（/emergency）无需登录即可访问。

## 已知问题

- 登录成功提示使用浏览器原生 `alert`（演示实现），后续替换为站内 toast；
- 问与解释的"历史会话"仅展示最近会话列表，暂不支持回溯到某一轮；
- 视频播放为占位（示意动画），未接入真实媒体文件。
