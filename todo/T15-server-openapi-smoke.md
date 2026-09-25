# T15 接口文档与冒烟脚本

阶段：S0 server
状态：待完成

## 要做什么
OpenAPI 文档页；`npm run smoke` 依次跑通：登录 → 同意 → 关键变化确认 → 录入报告 → 核对 → 生成分析（含 Worker）→ 原文对照 → 记录今天 → 生成复诊摘要；另跑红旗命中分支；server/README.md 写明启动方式（API 与 Worker）和全部默认账号。

## 完成标准
- `npm run smoke` 全部通过
- 相关构建、类型检查、测试全部通过
