# 腰有据 · 腰痛理解与复诊助手（演示实现）

> 演示项目，所有用户、报告、病程和医学内容均为虚构示例数据；产品不作诊断。

本仓库由 Step 5 Preview（阶跃星辰）通过 Step Code 编程助手，按 38 页 UI 设计稿和系统设计完成。需求见 `docs/brief.md`，任务见 `todo/`。

- 提交作者 `step-5-preview`：模型自己的提交
- 提交作者 `host`：主持者的初始化或人工介入

| 目录 | 内容 | 技术栈 |
|-|-|-|
| `server/` | API 服务与 AI 任务 Worker | Node.js + TypeScript + NestJS + SQLite |
| `app/` | 用户端 App | uni-app（H5 / Android） |
| `web/` | 用户端 Web | Vue 3 + Vite |
| `admin/` | 后台管理系统 | Vue 3 + Vite |
