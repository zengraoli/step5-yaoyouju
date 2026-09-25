# 错误码登记表（server）

全局统一返回 `{"code": 0, "data": ..., "message": "ok"}`；出错时 `code` 非 0，`message` 为中文。
错误码在 `src/common/api-error.ts` 的 `ErrorCode` 枚举中登记，新增错误码必须同步更新本表。

| code | 常量 | HTTP 状态 | 中文 message | 使用场景 |
|-|-|-|-|-|
| 0 | — | 200 | ok | 成功 |
| 40000 | BAD_REQUEST | 400 | 请求参数不正确 | 参数校验失败、请求体不合法 |
| 40100 | UNAUTHORIZED | 401 | 请先登录 | 未携带或携带无效登录态 |
| 40300 | FORBIDDEN | 403 | 没有权限执行该操作 | 角色权限不足、访问他人数据 |
| 40310 | CONSENT_REQUIRED | 403 | 需要先同意健康信息处理才能使用该功能 | 未同意「健康信息处理」访问分析等敏感功能 |
| 40400 | NOT_FOUND | 404 | 请求的内容不存在 | 资源不存在或已删除 |
| 40900 | CONFLICT | 409 | 当前状态不允许该操作 | 状态机不允许的流转、重复提交 |
| 40910 | SAFETY_SEEK_CARE | 409 | 检测到需要及时就医的信号，请尽快就医 | 安全规则命中红旗，需提示就医 |
| 40911 | SAFETY_STOP_PERSONAL | 409 | 已停止个性化分析，请及时就医 | 安全规则要求停止个性化分析 |
| 50300 | SERVICE_UNAVAILABLE | 503 | 服务暂时不可用，请稍后再试 | 模型 / 检索 / 来源校验失败 |
| 50000 | INTERNAL | 500 | 服务器内部错误 | 未预期异常 |

## 安全事件规则码（rule_code）

安全规则引擎命中时写 `SAFETY_EVENT`，规则码登记如下（T04 细化）：

| rule_code | 严重度 | 动作 |
|-|-|-|
| RED_FLAG_SEEK_CARE | high | 提示就医 + 停止个性化分析 |
| OUT_OF_SCOPE | medium | 明确不答，转为复诊问题 |
