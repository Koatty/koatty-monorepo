# Phase F 全面审计报告（2026-09-29）

> 本文是修复前审计记录。后续修复与实测结果见 [修复报告](phase-f-repair-2026-09-29.md)。


**结论：不通过 Phase F 完成验收，不建议按当前状态发布 AI Runtime 1.0。**

F-1～F-5 已有实现与测试，但方案中“代码与自动回归全部完成，仅剩真实客户端人工验收”的结论不成立。本次确认 23 项问题（14 项 P1、9 项 P2），包括真实 HTTP 不可连续调用、安全控制失效、SSE 断连不取消、预算与工具边界缺失，以及测试无法证明所声称的交付结果。

本次是审计，没有修复生产代码，也没有修改原方案勾选状态。既有 `packages/koatty-ai` dirty 修改保持不动。报告中的凭据、订单和工具名复现数据均为本地合成 fixture，不使用真实业务或供应商。

## 1. 范围与证据边界

- 对照方案 §2 ADR-101/102/104/106、§9 F-1～F-5、Phase F 验收门、§12.1 质量门。
- 通读 MCP、LLM、Guard、Trace GenAI、参考应用的实现、测试、迁移指南，以及容器/校验/SSE 的关联执行路径。
- 主仓库 HEAD：`3d6713385a87475c1a8d2fd86c37095716a64300`。
- `packages/koatty` HEAD：`3b7ff4abc1f1665b9e3ab6f0cb55f8ab25c1cd79`。
- `koatty-container` HEAD：`b920c42c3fdd4e9814f2ec6ff4e91132c15bc7ed`。
- `koatty-validation` HEAD：`64d1fa95d59e45836ae492c2a2b476b4cd877d09`。
- 执行环境：本机 Node `v22.23.1`，已有 pnpm 工作区依赖；核心关联依赖使用当前 checkout 中已有 dist；本次另行构建了四个 Phase F 受影响包。
- **已执行**：源码回归、类型检查、包构建、lint、行覆盖率统计、官方 SDK 的本地内存协议调用、真实 loopback HTTP、真实 Koatty callback 的 SSE 断连、TypeScript 实际 TC39 emit 的懒发现复现。
- **未执行**：全仓库完整回归、真实供应商、真实 Redis/多进程审批、Inspector/两个主流客户端、Docker/Kubernetes、隔离 tarball 安装、发布操作、MCP p99 基准。共享审批缺陷用两个 service 实例共享同一个 KV fixture 复现，足以证明当前实现没有跨实例读写决定，但不是 Redis 验收。

## 2. 独立验证结果

| 检查 | 结果 | 说明 |
|---|---|---|
| F-01 MCP | 19/19 通过 | 主要为内存协议；HTTP 只测 Origin 拒绝和路径让行 |
| F-02 LLM | 19/19 通过 | 脚本化供应商/fetch |
| F-03 Guard | 18/18 通过 | 服务级测试；未真正装配 `@Around` |
| F-04 GenAI | 6/6 通过 | 手动创建与记录 span |
| F-05 参考应用 | 11/11 通过 | 内存 MCP、脚本化供应商、模拟 ctx |
| Phase F 前置条件相关测试 | 55/55 通过 | SEC-01、SEC-02、SEC-03、ARCH-02、ARCH-06，共 7 个 suite |
| MCP/LLM/Guard/Trace `tsc --noEmit` | 通过 | 不表示协议与业务语义正确 |
| 参考应用 `tsc --noEmit` | 通过 | 依赖本仓库 paths 映射 |
| 四包 lint | 0 error，有 warning | MCP 6 条 warning，Trace 有既有 warning |
| 四包 build | 通过 | 包含 JS、声明、postBuild；有文档 warning |

Phase F 原有测试总计 **73/73**，相关前置测试 **55/55**。下列缺陷是在这些测试全绿之后，用独立负向输入和真实传输发现的。

覆盖率按各包自身 F 回归采集，不是全仓库合并覆盖率，也不把独立审计脚本计入覆盖率：

| 范围 | 行覆盖率 | 分支覆盖率 |
|---|---:|---:|
| `koatty-mcp/src/**/*.ts` | **68.99%** | 46.20% |
| `koatty-llm/src/**/*.ts` | 88.84% | 67.03% |
| `koatty-guard/src/**/*.ts` | 94.11% | 83.80% |
| `koatty-trace/src/genai/**/*.ts` | 98.64% | 82.22% |

MCP 新包整体低于方案要求的新代码行覆盖率 80%。高覆盖率的 LLM/Guard 仍存在缺陷，说明缺的是行为断言，而不只是执行行数。

## 3. 已确认问题

### F-A01 · P1 · HTTP 每次连接同一个 Server，第二个请求失败

**位置**：`packages/koatty-mcp/src/transport/http.ts:92-100,127-135,149-157`。

无状态模式每个 POST 创建 transport，然后执行同一个 `host.server.connect(transport)`，没有关闭/替换既有连接；有状态模式第二个新 session 也复用同一 Server。已安装 SDK 的 `shared/protocol.js:219-222` 明确拒绝重复连接。

**真实 HTTP 复现**：首次 initialize 为 200；第二次 tools/list 为 500，异常为 `Already connected to a transport...`。500 是审计 HTTP harness 对异常的映射；缺陷本体是适配器抛出异常，标准客户端 initialize 后的请求无法正常继续。无状态 transport 也不在 `close()` 的 sessions 清理范围内。

**修复与验收**：按请求/会话创建独立协议 Server，并复用只读注册信息或宿主服务；覆盖 initialize→initialized→list→call、两个 session、并发、关闭与重连。不能简单对共享 Server 每次 close 后再 connect，这会破坏并发请求。

### F-A02 · P1 · `/ask` 未复用 SSE 执行链，断开连接不取消供应商

**位置**：`packages/koatty/examples/mcp-order-service/src/controller/AskController.ts:38-65`；对照 `packages/koatty-router/src/sse/index.ts:49-139`。

控制器直接 `res.write`，没有调用 `streamSSE`、创建断连信号、处理背压，也没有接管响应/设置成功状态/正确结束原生响应。普通 HTTP 的 `ctx.signal` 只是可选类型声明，Serve 并未为其自动赋值。既有 `streamSSE` 才负责监听 close/aborted 并向 producer 传入信号。

**真实 Koatty HTTP 复现**：将该控制器挂在 `Koatty.callback()`；读到首个 chunk 后销毁客户端连接。结果 `status=404`、`signalSupplied=false`、`aborted=false`，断连 1050ms 后 producer 仍在执行。原测试 `F-05:382` 手动 abort 一个注入到 fake ctx 的控制器，不能覆盖真实断连。

**修复与验收**：通过已有 `streamSSE(ctx, signal => ...)` 连接 LLM，补真实 socket 断连 ≤1s、200、终止事件、背压与异常结束测试；重新打开该验收门。

### F-A03 · P1 · 工具循环执行模型返回的任意工具名

**位置**：`packages/koatty-llm/src/client.ts:477-515`。

只在准备请求时检查声明的 `options.tools`；模型返回 tool call 后直接 `options.invoke(call.name, call.args)`，没有检查其属于本次开放集合。

**复现**：本次只开放 `read`，模型返回 `delete_all`，invoker 实际收到并执行 `delete_all`。这是调用范围绕过；若 invoker 接的是整个 MCP registry，宿主 scope/approval 并不能替代本轮最小权限集合，尤其是同一用户本身拥有更宽权限时。

**修复与验收**：对每个返回的 call 校验本次 allowlist；未知/未开放工具不得到达 invoker，正常读工具仍可执行。不能只依赖“没有把写工具告诉模型”。

### F-A04 · P1 · 流式预算不记账，重试消耗与并发超支也未受控

**位置**：`packages/koatty-llm/src/client.ts:230-270,305,409-445,452-453`。

`stream()` 只走 `streamRouted()` 的前置 `get` 检查，完全不调用 `chargeBudget()`；结构化输出失败的请求也在 charge 前 continue/throw。没有根据余额限制 maxTokens 或做共享额度预留；无原子 incrBy 时 get/set 会丢并发更新，记账后端异常还被吞掉。

**复现**：上限 1 token，同一 scope 连续两次 stream，每次 usage=20，最终 store 仍为 0，两个请求都成功；provider 收到的 maxTokens 未设置。

**修复与验收**：流式/非流式/失败/结构化重试统一计量；定义并落实超限中止与分布式原子预留/结算，拒绝无有效计数器的静默假预算；补并发、失败、断流、后端失败测试。

### F-A05 · P1 · 已输出部分内容仍重试，拼接出混合回答

**位置**：`packages/koatty-llm/src/client.ts:325-346`。

catch 只判断 retryable，没有记录是否已经向消费者 yield。代码注释声称部分输出不可透明重试，但实现未落实。

**复现**：第一次先输出 `partial` 后报 503，第二次再输出 `partial`；消费者最终得到 `partialpartial`，没有重置/分段语义。对工具 chunks 同样可能造成重复的调用候选。

**修复与验收**：首个可见 chunk 后禁止透明 retry/fallback，或引入明确且由上层处理的重开协议；测试首 chunk 前可重试、之后不得拼接。

### F-A06 · P2 · 消费者提前退出时，底层迭代器与网络请求未释放

**位置**：`packages/koatty-llm/src/client.ts:274-282,347-350`；`src/providers.ts:47-79`。

`attempt()` 手工调用 iterator.next，却无 finally/iterator.return；外层 finally 只清定时器/事件监听，没有 abort；readSse 也没有 cancel/releaseLock 路径。

**复现**：消费首个 chunk 后 break，provider 的 finally 未执行，传入 signal 也未 aborted。

**修复与验收**：统一关闭 iterator、取消 reader/HTTP 请求；补 break、consumer 抛错、取消、自然结束各路径且清理恰好一次。

### F-A07 · P1 · MCP 丢失应用 strict 安全画像

**位置**：`packages/koatty-mcp/src/server.ts:99-103`。

`strict` 只读另一个独立开关 `options.security.strict === true`，完全不读取 `app.security.name`。因此生产 strict 应用如未重复设置该 MCP 开关，`destructiveHint` 默认审批不起作用，违反 F-3 的默认策略及 ADR-102。

**复现**：`app.security.name='strict'`、destructive tool 未声明 requireApproval、无审批后端，调用仍返回 `executed`。

**修复与验收**：从应用已解析画像继承，局部显式覆盖需有清晰语义；覆盖 strict 默认拒绝、显式 requireApproval:false 例外、standard 行为。

### F-A08 · P1 · 配置鉴权后，缺凭据请求仍可调用无 scopes 工具

**位置**：`packages/koatty-mcp/src/server.ts:107-112,284-291`；`src/security.ts:148-150`；HTTP middleware 未设统一认证门。

配置 auth 后，缺 key 返回 null；空 scopes 被视为可调用。缺凭据的调用可以执行普通工具/资源，discovery 甚至不调用 auth。与“不配置 auth 时允许匿名”的显式模式不同，配置了 auth 也无法保护整个端点。

**官方 SDK 内存协议复现**：host 配置 API key，客户端不提供 key，`tools/call destroy` 成功。非法 key 会拒绝、完全不传 key 反而成功。

**修复与验收**：认证与 scope 分开，已启用 auth 时首先要求有效主体；确需公开的资源应有显式公共策略。补无 key、错误 key、有效 key、scope 缺失矩阵及 HTTP 认证响应。Bearer audience 当前也是可选项，应明确强制受众校验的入口契约。

### F-A09 · P1 · Origin 只比较 hostname，且宿主白名单配置未传给适配器

**位置**：`packages/koatty-mcp/src/security.ts:168-186`；`src/transport/http.ts:77-79`；`src/types.ts` 的 `McpSecurityOptions.allowedOrigins`。

白名单与请求都被降成 hostname，忽略 scheme/port。宿主 `security.allowedOrigins` 无消费者，adapter 单独读自己的 options.allowedOrigins；参考应用只传 host。

**复现**：只允许 `https://example.com:443`，却接受 `http://example.com:9999`。这把不同 origin 放入同一信任范围；按迁移指南在宿主上配置正常远端 origin 也不会生效。

**修复与验收**：精确比较规范化 origin，单一配置来源；测试协议/端口不同的拒绝和宿主配置向 HTTP 的透传。

### F-A10 · P1 · 已取消的工具调用仍执行副作用

**位置**：`packages/koatty-mcp/src/server.ts:173-213`；`src/approval.ts:112-143`。

signal 仅在执行时放入 ctx，完成后用于选择 audit 状态；审批等待不感知取消，实际调用前也不检查 aborted。取消后审批通过仍能执行写操作。

**复现**：传入已经 aborted 的 signal，审批返回 true，destructive handler 仍执行，事后才记 cancelled。

**修复与验收**：入口、校验后、审批后、业务入口前检查信号；取消审批等待并回收票据；取消发生于批准前后均不得启动尚未开始的副作用。

### F-A11 · P1 · 审批票据 ID 重用可复用旧批准

**位置**：`packages/koatty-guard/src/approval.ts:70,96-112,116-120`。

请求结束只删 pending，不删 decisions，也不拒绝重复 ID/绑定参数。下一次同 ID 的请求直接读取历史批准。决定表还会无限增长。

**复现**：id=`reused` 的 amount=1 获准并结束；同 ID、amount=999 的新请求无需再次 approve 就返回 approved:true。该复现依赖应用提供/重用 ID，并不声称客户端能指定 MCP 自动生成的票据 ID。

**修复与验收**：票据唯一且不可重放，绑定 caller/tool/参数指纹/有效期；原子 settle，决定不可挪用；覆盖同 ID 不同参数、到期、重复决定与清理。

### F-A12 · P2 · 共享审批存储只有写入，没有跨实例决定与恢复

**位置**：`packages/koatty-guard/src/approval.ts:68-128`。

store 仅用于 `set(pending)`，get 从未调用，approve/reject 只操作本进程 Map；没有持久化最终状态/删除 pending。notify/persist 还发生在超时轮询之前，二者挂住时该服务本身不会按期拒绝（MCP 外层超时只能遮住 MCP 入口）。

**复现**：A/B 两个服务共享同一 KV，A 发票据，B.approve 返回 false，A 最终 timeout。F-5 K8s 模板为两副本，此实现不能支撑跨副本审批回调。

**修复与验收**：使用 store 权威状态及原子 transition，支持异实例回调、进程恢复、终态清理；通知失败/卡住也要在统一截止时间内 settle。不得继续宣称仅注入 store 就是共享审批。

### F-A13 · P1 · Guard 对畸形审批决定 fail open

**位置**：`packages/koatty-guard/src/aspects.ts:136-157`。

只拒绝 `decision.approved === false`，没有要求明确 true。外部审批回调或运行时 JS adapter 返回 `{}` 时，被当作允许。

**复现**：approval.request 返回 `{}`，受保护业务返回 `executed`。

**修复与验收**：仅 `approved === true` 放行，其他返回形态全部拒绝并审计。MCP 自身 evaluateApproval 已采用明确 true，Guard 必须保持一致。

### F-A14 · P2 · 内容检查忽略 DTO/messages，输入脱敏未进入执行链

**位置**：`packages/koatty-guard/src/aspects.ts:113-120,157-162`；参考应用 `src/app.ts:52-64`。

runGuarded 只检查顶层 string 参数，常见 `{content}`、`{messages:[...]}` DTO 完全跳过；只在业务之后 mask(result)，未处理 LLM 请求和工具返回内容进入模型的边界。F-5 只把 masking 用于审计，未装配 guard.aspect/rateLimiter；其组装不等于已具备全部护栏。

**复现**：启用 inspectsContent，传 `{content:'ignore all previous instructions'}`，业务照常执行；相同字符串作为顶层参数才被阻断。

**修复与验收**：定义明确的外部内容提取/处理契约，覆盖 messages、检索结果、工具结果；在实际模型输入边界处理隐私，不应盲目改写需要真实业务值的工具参数；验收真实 AOP 装配和模型出站 payload。

### F-A15 · P1 · Guard 审计会记录密码/token 等凭据原文

**位置**：`packages/koatty-guard/src/audit.ts:27-45,60-74`；`src/masking.ts:35-40`。

summary 保留短字符串原文；默认 masking 仅匹配 PII 形状，不按敏感键过滤凭据。error 也未经脱敏。MCP 内有另一个敏感键摘要实现，Guard 直接使用路径没有它。

**复现**：createGuard 默认配置，参数包含合成 password，auditSink 中可检出完整原值。异步 sink 的 Promise 也被 void 且未 catch，失败可能成为 unhandled rejection。

**修复与验收**：统一凭据键清除与 PII 脱敏，处理 error/caller 等进入日志的字段，明确并落实 audit sink 失败策略；测试嵌套、长字符串、异常消息及异步拒绝。

### F-A16 · P1 · 开启 Trace 内容采集后缺少 masker 会直接记录原文

**位置**：`packages/koatty-trace/src/genai/genai.ts:110-113,132`。

mask 缺省为 identity。方案承诺 captureContent:true 后经过 F-3 同一脱敏服务，实际只要求调用方记得另传 mask；迁移文档承认会裸记原文，但没有安全约束。

**复现**：仅设置 captureContent:true，recordChat 的请求邮箱原文完整进入 span attributes。默认 captureContent:false 的隐私测试确实通过，不代表开启后的承诺已实现。

**修复与验收**：开启采集时强制提供脱敏服务，或提供安全默认实现；缺失/异常必须 fail closed，补未传 mask 与 masker 抛错测试。

### F-A17 · P1 · 缓存命中绕过当前 DTO 校验契约

**位置**：`packages/koatty-llm/src/client.ts:188-198,456-465`。

cache key 不包含 dto/partial，命中后直接返回，不执行当前请求的输出校验。无 DTO 的一次结果可以被后续有 DTO 的调用复用。

**复现**：先缓存 `{"port":123}`，后对相同 messages 指定要求字符串端口等字段的 DTO；返回 cached:true，provider 仅调用一次，也未抛校验错误。

**修复与验收**：缓存键包含完整输出契约或命中后重新校验；覆盖无 DTO→有 DTO、不同 DTO、partial 变化。对于跨配置共享 cache，还应纳入实际路由/供应商的隔离维度。

### F-A18 · P2 · TC39 懒组件在实例化前无法发现 Tool/Resource/Prompt

**位置**：`packages/koatty-mcp/src/decorators.ts:27-30`；`src/registry.ts:223-235`。

TC39 元数据只在实例 initializer 中写入，而 registry 构造时扫描类原型，没有确保懒组件初始化，也没有构造后刷新 registry。Request/Prototype 组件不能依赖先构造单例来碰巧使发现生效。

**实际 TS emit 复现**：experimentalDecorators:false 编译带 @Tool 的类，放入独立 Container 后，实例化前 registry 工具数=0；new 一次后=1。本复现验证类发现边界；未声称已经覆盖所有真实 bootstrap 组合。

**修复与验收**：类级可读取元数据桥接，不能靠提前实例化 Request bean；补 Legacy/TC39 × Singleton/Prototype/Request 的真实发现与调用矩阵。既有 Phase F 回归没有这组覆盖。

### F-A19 · P2 · 新的 DTO→Schema 转换器与运行时校验不一致

**位置**：`packages/koatty-mcp/src/schema.ts:31-32,43,96,144,204,219`。

IsPort/IsDecimal/IsCurrency 要求字符串却映射为数字；IsJSON 要求 JSON 字符串却映射为 object；嵌套 DTO 把整份 schema 填到 properties 中。ValidateIf 被跳过、部分规则被标“已处理”却未生成约束，partial 也未传入 schema 生成器。

**复现**：运行时 `{port:'3000',json:'{}'}` 校验错误数=0；生成的 schema 分别要求 integer/object，客户端按 schema 生成值后又会被运行时拒绝。

**修复与验收**：落实 F-1 与 E-1 共享转换规则的约定，对 schema 与 validator 做双向契约测试；无法转换的规则标 unresolved，不得伪造已完整支持。

### F-A20 · P2 · 流式调用忽略 tools，参考应用没有工具问答闭环

**位置**：`packages/koatty-llm/src/client.ts:452-453`；参考应用 `src/app.ts:52-59`、`src/agent/SupportAgent.ts:43-48,70-78`。

stream() 无条件把 tools 设为 undefined；complete() 丢弃字符串工具名；只有 withTools 能解析 registry，而参考应用既未向 agent 传 toolRuntime，也未在流式接口调用该循环。

**复现**：stream 传完整工具定义，provider 收到 tools=null。示例声明只给模型两种读工具，实际模型一个也收不到；不能完成依赖订单数据的工具问答。

**修复与验收**：明确 raw stream 与工具执行 API 的契约，实现/接通方案承诺的名称解析路径；用 provider 真正请求 order_query、业务执行、结果回灌、最终 SSE 回答的集成测试验收。

### F-A21 · P2 · 同 traceId 测试不能证明 MCP→工具→LLM 父子链路

**位置**：`packages/koatty-trace/src/genai/genai.ts:197-198,225-226`；参考应用 `src/tracing.ts:52-59`；`test/regression/F-05.reference-app.test.ts:316-350`。

recordToolCall 在业务完成后的 audit 中才瞬时 start/end；LLM 也完成后才记 span，因此工具 span 无法成为运行中 LLM 调用的 parent。F-05 先调 MCP 工具，再单独调 agent.stream，两者共用人工创建 requestContext，只断言 traceId 相同，实际是兄弟 span，且不是一次工具内调用 LLM。

此外，没有生产调用点把审批决定送进 recordApproval；stream 失败/取消不记 chat 结果，LLM withTools 只返回最后一轮 usage，fallback 结果 model/cost 仍按请求逻辑模型取值。F-4 的端到端成本/审批指标仍未闭合。

**修复与验收**：围绕真实执行阶段创建/激活/结束 span，补 parentSpanId 与时间范围断言，覆盖错误、取消、审批、工具多轮和 fallback 的实际模型/token/成本。重新打开完整链路验收门。

### F-A22 · P2 · stdio helper 忽略公开 identity 参数

**位置**：`packages/koatty-mcp/src/transport/stdio.ts:14-36`。

StdioOptions.identity 从未读取；README 指导 `startStdioServer(host,{identity})`，但 host 只使用 createMcpHost 时传入的 stdioIdentity。

**复现**：传 id=operator、scopes=['write']，同一内存 transport 上的 SDK 客户端调用 scoped tool 仍被判为 anonymous，返回 -32600。

**修复与验收**：只保留一个有效身份入口，或显式接通参数；补经 startStdioServer 进入的 scoped call。无身份默认拒绝应保留。

### F-A23 · P2 · F-5 未进入 CI，完成状态与交付范围存在偏差

**位置**：`.github/workflows/ci.yml`；`packages/koatty/package.json:15`、`jest.config.js:21`；参考应用 package/README/deploy；方案 §9 验收门。

- F-5 位于嵌套 examples，非根 workspace；koatty 的默认 testMatch 仅匹配 test/；CI 只跑默认 test，没有执行 test:example。11 例集成测试不会成为 CI 发布阻断门。
- 参考应用没有独立启动入口/build/start；Dockerfile 是宿主应用模板，不是本例可直接构建的交付物。README 挂载片段含未定义变量/需用户补写的路由，未给出可直接运行的完整应用。
- 原方案要求 Inspector **及至少两个主流客户端**，当前说明缩减为 Inspector + 一个所谓“第二个客户端”；验收范围也被缩小。
- F-1/F-2 迁移文档仍写 F-3～F-5 未交付，与总方案冲突；F-3 文档声称 guard.audit 可直接作 MCP audit，实际 target/tool/status 契约不一致，参考应用自身也另写了 bridge。
- MCP 覆盖率未达 80%，无新增装饰器完整双模式门，无 MCP p99 <5ms 的证据。

**修复与验收**：CI 显式执行 F-5 与真实传输/双模式回归；交付可启动样例、可构建镜像及实际探针；按原要求保留三类客户端验收，并同步方案、迁移指南与发布状态。

## 4. 逐项方案结论

| 项目 | 当前可确认交付 | 不能确认完成的部分 |
|---|---|---|
| F-1 MCP | Legacy 元数据、内存协议发现、DTO 简单校验、显式 scope/approval 拒绝 | HTTP、多 session、安全画像/鉴权/Origin、取消、TC39 懒发现、stdio 参数、复杂 schema |
| F-2 LLM | 两个 fetch 适配器、简单路由/重试、非流式 DTO 校验、单工具循环 | 流式预算、工具范围、已输出重试、提前退出清理、缓存契约、名称工具流式接通 |
| F-3 Guard | 纯服务的 PII 规则、顶层字符串检测、单实例审批/限流 | 请求内容边界、凭据审计、畸形审批 fail closed、审批防重放/共享恢复、真实 AOP 集成 |
| F-4 GenAI | 常量集中、手工 span 记录、默认不采集原文、内存计数 | 开启内容后的强制脱敏、真实父子链、审批指标、失败/取消/多轮和 fallback 的完整计量 |
| F-5 参考应用 | 可 import 的组装模块、11 个离线回归、部署模板 | 可启动可部署应用、真实 HTTP/SSE、订单工具问答闭环、完整 Trace、CI 门 |

五条原验收门应调整为：

1. Inspector + 至少两个主流 MCP 客户端：保持未完成，且先修复 HTTP。
2. 参数白名单/JSON-RPC 错误：简单 DTO 已验证；复杂 schema、无 DTO 参数边界仍需补验收，不可扩大成所有工具已正确。
3. scope/审批阻断：显式配置的现有用例通过；strict 继承、无凭据、取消与防重放缺陷修复前不可整体关闭。
4. SSE 断连 ≤1s：**重新打开**，真实 socket 复现失败。
5. MCP→工具→LLM 完整 Trace：**重新打开**，当前测试未建立该调用关系。

## 5. 修复顺序与关闭条件

1. **先关闭执行与安全 P1**：F-A01～05、07～11、13、15～17。所有修复先补能失败的回归，原 73 例保持通过。
2. **接通真实运行路径**：SSE 使用既有能力，工具问答通过 MCP invoker，Guard 在实际 AOP/出站内容边界生效，Trace 围绕实际生命周期创建。
3. **补协议与持久化**：多会话、stdio、Origin、复杂 DTO、TC39/request scope、跨实例审批/恢复。资源模板目前写入 resources/list，未注册 resources/templates/list；需一并验证官方 SDK 的模板发现路径。
4. **最后重建交付证据**：把真实 HTTP、socket 断连、两种装饰器模式、F-5、覆盖率门接入 CI；提供真正可启动/部署的示例；再做客户端、真实 provider、发布包与性能验收。

主框架 5.0.0 清理与 Phase F AI 组件代码范围可以分开交付；本报告没有把尚未执行主框架 major 清理误列为 AI 代码缺陷。阻止本次验收的是已声明完成能力的可复现问题。

## 6. 本次命令与复现记录

全部命令从仓库根目录执行：

```bash
pnpm --filter koatty_mcp --filter koatty_llm --filter koatty_guard --filter koatty_trace exec jest --runInBand --coverage=false --testPathPattern='F-0'
pnpm --filter koatty exec jest --config examples/mcp-order-service/jest.config.js --runInBand --coverage=false
pnpm --filter koatty_container --filter koatty_validation --filter koatty_router exec jest --runInBand --coverage=false --testPathPattern='SEC-01|SEC-02|SEC-03|ARCH-02|ARCH-06'
pnpm --filter koatty_mcp --filter koatty_llm --filter koatty_guard --filter koatty_trace exec tsc --noEmit
pnpm exec tsc -p packages/koatty/examples/mcp-order-service/tsconfig.json --noEmit
pnpm --filter koatty_mcp --filter koatty_llm --filter koatty_guard --filter koatty_trace run lint
pnpm --filter koatty_mcp --filter koatty_llm --filter koatty_guard --filter koatty_trace run build
pnpm --filter koatty_mcp --filter koatty_llm --filter koatty_guard exec jest --runInBand --coverage --coverageReporters=text --coverageReporters=json-summary --collectCoverageFrom='src/**/*.ts'
pnpm --filter koatty_trace exec jest --runInBand --coverage --coverageReporters=json-summary --collectCoverageFrom='src/genai/**/*.ts' --testPathPattern=F-04
node /tmp/koatty-phase-f-audit.cjs
node /tmp/koatty-phase-f-sse.cjs
```

最后两个为本机临时审计复现脚本，未加入生产源码或常规回归；退出 0 表示复现脚本运行完成，**不是缺陷测试通过**。修复时应将相应安全期望改成会在当前版本失败的正式 test/regression 用例。临时文件可能被系统清理。

独立复现输出摘录（不含任何真实凭据）：

```text
stream-budget-tools: used=0, providerTools=null, providerMaxTokens=null
tool-allowlist: advertised=[read], invoked=[delete_all]
partial-retry: tries=2, text=partialpartial
early-break: finalized=false, aborted=false
cross-instance-approval: secondApprove=false, decision=approval-timeout
approval-replay: approved=true
guard-object-and-secret: executed=true, leaked=true
malformed-approval: executed
strict-profile: executed
origin: accepted=true
configured-auth-without-key: content=executed
stdio-identity: anonymous / missing scope write
already-cancelled-tool: executed
tc39-lazy-discovery: beforeInstance=0, afterInstance=1
dto-schema: port=integer, json=object, validRuntimeErrors=0
cached-dto-validation: cached=true, cacheCalls=1
trace-unmasked: containsRawEmail=true
http-second-request: firstStatus=200, secondStatus=500, Already connected to a transport
real-koatty-sse: status=404, signalSupplied=false, aborted=false, producerStillRunning=true
```

原始日志均留在本机 `/tmp/koatty-phase-f-*.log`，测试生成的 coverage/dist 没有加入版本控制。
