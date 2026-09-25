# 腰有据 · 用户端 App（uni-app）

腰痛理解与复诊助手的用户端 App：uni-app（Vue 3 + Vite + TypeScript），**以 H5 构建验收**，Android 打包可选。

产品红线（所有端一致）：不作诊断、不给用药 / 手术建议；缺失信息显示「尚未确认」，不默认为阴性；命中红旗信号立即显示就医提示，不被登录、付费、上传或长问卷阻断；每条解释可见来源；系统生成内容带版本号，不标为事实来源。

## 启动命令

```bash
# 安装依赖（Node 24，首次约 1 分钟）
npm install

# 开发（H5，端口固定 5201，见 AGENTS.md 本机运行约定）
npm run dev:h5
# 浏览器打开 http://127.0.0.1:5201

# 构建（H5，产物在 dist/build/h5）
npm run build:h5

# 类型检查（TypeScript 严格模式）
npm run typecheck
```

> 后端默认指向 `http://127.0.0.1:3200`（本地 server，启动方式见 `server/README.md`）。
> 后端未启动时，首页「接口与登录态自检」会显示接口异常，就医提示页展示静态兜底内容（产品红线：该页始终可达）。
> API 基础地址可在「我的」页切换（`src/api/request.ts` 的 `setBaseUrl`）。

## 目录结构

```
app/
├── index.html                 # H5 入口 HTML
├── package.json               # name: yaoyouju-app；脚本 dev:h5 / build:h5 / typecheck
├── vite.config.ts             # vite 配置；server.port = 5201（strictPort，避免占用其他项目端口）
├── tsconfig.json              # TypeScript 严格模式
├── shims-uni.d.ts             # uni-app 类型声明（官方 preset 提供）
└── src/
    ├── main.ts                # 入口：createSSRApp + Pinia + 主题 CSS 变量
    ├── App.vue                # 应用实例：恢复登录态、前台刷新；引入全局样式
    ├── manifest.json          # 应用配置（h5.title / router.base / devServer.port）
    ├── pages.json             # 页面与 tabBar 配置（五个入口 + 就医提示页）
    ├── uni.scss               # 全局 SCSS 变量（uni-app 注入到每个组件，勿写 CSS 规则）
    ├── theme/
    │   ├── tokens.css         # CSS 自定义属性（--color-primary 等，运行时 / 内联 style 使用）
    │   └── global.scss        # 全局基础样式（页面背景 / 字体栈 / 行高 / 页面容器）
    ├── api/                   # 接口封装
    │   ├── request.ts         # 统一请求：baseURL 可配置、Bearer token、{code,data,message}
    │   ├── auth.ts            # sms-code / login / me / consents / grant / revoke
    │   ├── safety.ts          # emergency-notice（就医提示，公开）
    │   └── switches.ts        # switches（功能开关，公开）
    ├── stores/
    │   └── auth.ts            # 登录态（Pinia）：token 持久化到 uni.storage
    ├── components/            # 通用组件（自绘 SVG 图标，不加载外部资源）
    │   ├── AppIcon.vue        # SVG 图标集（24×24 线性图标，currentColor 着色）
    │   ├── AppButton.vue      # 按钮：主 / 次 / 柔和 / 危险·就医；disabled、loading；44×44；圆角 10
    │   ├── AppChip.vue        # 芯片：已选 / 未选 / 跳过
    │   ├── StatusTag.vue      # 状态标签（三端语义一致）
    │   ├── AppNotice.vue      # 提示条：信息 / 提醒 / 就医提示（不阻断）
    │   ├── AppCard.vue        # 卡片：圆角 12、surface 底色、border 描边
    │   ├── TabBar.vue         # 底部五个入口（自绘 SVG 图标，当前项 primary）
    │   └── EmergencyEntry.vue # 就医提示入口（红色，任意页面可引入，无需登录）
    └── pages/
        ├── index/index.vue    # 当前情况（首页占位演示：主题 + 组件 + 接口自检）
        ├── qa/index.vue       # 问与解释（占位，T21 实现）
        ├── timeline/index.vue # 病程（占位，T22 实现）
        ├── followup/index.vue # 复诊准备（占位，T23 实现）
        ├── mine/index.vue     # 我的（占位，T25 实现）
        └── emergency/notice.vue # 就医提示页（接口内容 + 网络异常静态兜底）
```

## 主题变量

设计规范见 `docs/design/README.md`，双轨落地：

- **SCSS 变量**：`src/uni.scss`（uni-app 自动注入每个组件，直接使用 `$color-primary` 等）。
  注意：uni-app 会把 uni.scss 内容原样注入每个组件的样式，因此其中**不要**用相对路径 `@import` 其他文件。
- **CSS 自定义属性**：`src/theme/tokens.css`（`--color-primary` 等，供内联 style / 运行时读取）。

颜色、字号、圆角、间距全部走变量，页面与组件中不散落硬编码（唯一例外：`pages.json` / `manifest.json` 这类配置文件中的原生 tabBar 配色）。

## 通用组件

| 组件 | 说明 |
|-|-|
| AppButton | 主按钮 / 次按钮 / 柔和 / 危险·就医；`disabled`、`loading`；最小点击区域 44×44；圆角 10 |
| AppChip | 已选 / 未选 / 跳过（跳过不视为阴性） |
| StatusTag | 已确认、尚未确认、有冲突、未经核实、报告原文、自述、系统生成、已审核 v2、已下线·更正中、不作诊断 |
| AppNotice | 信息提示 / 提醒 / 就医提示（就医提示带图标，仅提示不阻断） |
| AppCard | 圆角 12，surface 底色 + border 描边，支持标题与 extra 插槽 |
| TabBar | 底部五个入口：当前情况 / 问与解释 / 病程 / 复诊准备 / 我的；自绘 SVG 图标，当前项 primary 色 |
| EmergencyEntry | 红色就医提示入口，任意页面引入，点击跳转 `pages/emergency/notice` |

## 接口与登录态

- `src/api/request.ts`：baseURL 可配置（默认 `http://127.0.0.1:3200`），自动携带 `Authorization: Bearer <token>`，统一处理 `{code, data, message}`；`code` 非 0 时 `Promise.reject` 中文 `message`；网络失败 reject「网络连接失败，请检查网络后重试」。
- `src/stores/auth.ts`（Pinia）：token、用户信息、登录 / 登出、同意状态；token 持久化到 `uni.storage`（键 `yyj_token`）；同意「健康信息处理」需单独勾选，可查可撤回。
- 就医提示（`/safety/emergency-notice`）与功能开关（`/switches`）为公开接口，不携带用户数据。

## 已知问题

1. 原生 tabBar 为文字标签：uni-app 原生 tabBar 只支持图片图标，自绘 SVG 图标由 `components/TabBar.vue` 承载（用于非 tab 页，如就医提示页）。若后续需要主入口也带 SVG 图标，需改用自定义 tabBar 方案。
2. `sass` 使用 `@import` 语法（Dart Sass 已标记弃用，未来版本需迁移 `@use`）；当前构建仅有弃用警告，不影响产物。
3. 小程序端（mp-weixin 等）未适配：SVG 内联与部分 CSS（`env(safe-area-inset-bottom)`）需按平台调整，本任务只以 H5 验收。
4. 登录页（A01）在 T17 实现；当前首页占位页可查看登录态，但暂未提供登录入口。
5. 就医提示页的动作按钮（拨打 120 / 查找医院 / 联系主治医生）在演示环境中只弹出提示，不真正拨号或跳转。
