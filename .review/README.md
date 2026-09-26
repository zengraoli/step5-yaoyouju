# 设计走查工具（T41）

按设计宽度对三端页面截图，用于与 `docs/design/` 设计稿逐页对照（记录见 `docs/design-review.md`）。

## 使用

```bash
# 前置：server(3200) + worker、app(5201)、web(5202)、admin(5203) 均已启动
python shoot.py      # 全量截图（37 页，含登录态注入）
python reshoot.py    # 重截依赖参数的页面（一页分析 / 原文对照 / 视频详情）
```

- `shoot.py`：用 Playwright Chromium 按设计宽度（App 375 / Web·Admin 1440）截图；
  需要登录的页面通过 `add_init_script` 在页面脚本执行前注入令牌（模拟真实登录态）。
- `reshoot.py`：一页分析等页面需要真实 task_id / analysis_id，脚本先调 API 生成再截图。
- `config.json`：早期版本的全量页面配置（已被 shoot.py 内置列表取代，保留作参考）。

截图产物输出到 `shots/`（约 37 张 PNG，不入库，可按需重新生成）。
