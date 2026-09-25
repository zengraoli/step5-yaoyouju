# T01 服务端项目骨架

阶段：S0 server
状态：已完成（v0.1，2026-09-26）

## 要做什么
NestJS + TypeScript + SQLite 项目骨架；按 `docs/system-design.md` 第 1 节划分模块（用户与授权、病程、报告、分析编排、安全规则、内容库、证据库、反馈与质量、模型与评测、后台管理与审计、功能开关）；统一响应格式与全局错误处理；错误码登记在 `server/docs/errors.md`；配置从环境变量读取，提供 `.env.example`。

## 完成标准
- `npm run dev` 能启动，`GET /health` 返回统一格式
- 相关构建、类型检查、测试全部通过
