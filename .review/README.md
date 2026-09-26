# 设计走查与验收复验工具

## 文件

| 脚本 | 用途 |
|-|-|
| `shoot.py` | 设计走查全量截图（37 页，含登录态注入） |
| `reshoot.py` | 重截依赖参数的页面（一页分析 / 原文对照 / 视频详情） |
| `final_check.py` | 验收复验：逐页检查控制台错误 / 失败请求 / 4xx（ASCII 输出） |
| `final_shots.py` | 验收复验截图（输出到 `final/`，不入库） |
| `config.json` | 早期页面配置（已被 shoot.py 内置列表取代，保留作参考） |

## 使用

```bash
# 前置：server(3200) + worker、app(5201)、web(5202)、admin(5203) 均已启动
python final_check.py    # 复验 B05 / B10 / B09 / A08–A12 / A15 是否还有控制台报错
python shoot.py          # 全量设计走查截图
```

截图产物输出到 `shots/` 与 `final/`（不入库，可按需重新生成）。
