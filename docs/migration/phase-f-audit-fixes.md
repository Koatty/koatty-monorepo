# Phase F 审计修复迁移（2026-09-29）

对应 `phase-f-audit-2026-09-29.md` 的 F-A01～F-A23。版本号未应用、未发布；以下行为以本工作区修复后的源码为准。

## MCP 宿主

- HTTP 为每个连接创建 SDK Server；stateful 会话绑定认证主体，stateless 在响应结束时释放。停止应用时调用 `adapter.close()`。
- 配置 `security.auth` 后，发现、读取和无 scope 工具也必须认证。进程内测试/可信 stdio 可以通过 `createServer({ headers: {}, principal })` 或 `startStdioServer(host, { identity })` 显式绑定身份；不得从外部请求体接受 principal。
- 未显式指定 strict 时继承 `app.security.name === 'strict'`。显式 Origin 白名单比较 scheme、host、port；默认仍仅允许本地 Origin。最低 Node 版本为 18.17（使用 AbortSignal.any），本次执行环境为 Node 22。
- API key 主体 ID 改为完整 SHA-256 摘要，不再含密钥前缀；依赖旧 ID 的限流/审计关联应迁移。可选 identityHeader 只能在可信、会覆盖该头的网关后启用。
- 参数化资源通过 `resources/templates/list` 发现；`resources/list` 仅列固定 URI。
- 已取消请求不进入审批/业务，审批后再次检查取消。进程内 invoker 同样应传 signal。
- TC39 Tool/Validated 方法元数据在类定义时可见，Request/Prototype 无需为发现而实例化。

## 预算、工具与缓存

- 启用预算必须提供原子的 `store.incrBy` 和每次调用的 `budgetScope`；只有 get/set 的旧存储现在拒绝初始化。多实例必须共享同一个原子计数器。
- 每次实际 provider 尝试（包括流式、fallback、结构化纠正重试）先预留输入估算 + 最大输出额度，再按 usage 结算。并发预留超限回滚且不调用 provider。存储故障不会放行。
- 未收到 usage 的中断保留本次预留额度，避免断连逃费。输入 token 默认是估算，应注入供应商 tokenizer 的 `estimatePromptTokens`；这不是供应商账单上限保证。provider 报告超额时终止并记录实际量。
- 一旦有 chunk 对外可见，本次流不再透明重试。提前 break 会 abort provider 并关闭 iterator/reader。
- `stream` 解析 tools；要执行工具使用 `streamWithTools` / `withTools`。批次工具名必须在本次显式 tools 白名单内，注册但未暴露的工具也拒绝；invoker 第三个可选参数携带 signal。
- 缓存命中仍做 DTO 校验；缓存键包含有效工具、schema、partial、路由和自定义键。DTO 自动生成请求 schema；自定义 JSON Schema 是 provider 约束，本地完整校验仍需 DTO，不声称支持任意 JSON Schema 验证器。
- `responseModel`、chunk 的 provider/model 表示实际响应路由；工具多轮结果累计 usage/cost。

## 审批与 Guard

- 票据默认 UUID，指定 ID 也只能使用一次。绑定工具、调用方、会话、请求与参数；不同请求不得复用旧票据。
- 共享审批 store 必须提供原子 `compareAndSet(key, expected, next)`，expected=null 表示仅不存在时创建。不能使用 get+set 模拟 CAS。回调实例通过 approve/reject 更新同一状态；请求实例轮询并原子消费决定。可用 resume 恢复持久化等待，但不自动重执行业务。
- 只有 `{ approved: true }` 放行；通知悬挂不延迟截止时间。取消和超时拒绝，终态保留 tombstone 防重放。默认内存后端仅单进程，最多保留 10000 个 ticket；达到上限 fail closed。生产需提供持久 CAS 后端和保留策略，本次没有真实 Redis/进程重启验收。
- Guard 内容检查递归进入对象/数组；示例对每轮出站 message（含工具结果和纠正消息）检查、限流和脱敏。规则检查只覆盖已知注入模式，权限/scope/审批仍是强边界。
- 默认审计脱敏凭据键、嵌套字段与调用方 PII；错误只记录分类，sink 异常不会改变业务结果。

## Schema、追踪与参考应用

- 运行时 DTO schema 集中在 koatty_validation；CLI E1 使用无运行时副作用的 `koatty_validation/schema-rules` 共享规则，不导入目标应用。port/JSON 是字符串；可选支持 null；each、partial、nested 修正，不能忠实映射的规则保留 unresolved。
- captureContent=true 必须显式提供 masker，失败不会回退原文。新增 beginChat/beginTool，在执行前开始 span、执行后结束；LLM observeAttempt 覆盖实际尝试与失败，显式 context 保持父子关系。旧 record API 仍适用于完成事件，不能独自证明 live span 链路。
- 示例已加入 pnpm workspace 与默认 test，提供 build/start、main.ts、healthz/readyz 和审批管理端点；SSE 使用 streamSSE。readyz 只说明本地初始化，不代表远端 provider 可用。
- 示例使用内存订单、审批、限流，Kubernetes 模板改为单副本；Docker 使用仓库根目录上下文。多副本生产需替换共享业务存储/审批后端。远端供应商、Docker/Kubernetes、Inspector 和第三方客户端仍需独立部署验收。
