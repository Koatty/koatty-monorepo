# Phase A–F 二轮审查迁移说明（2026-09-30）

对应 `docs/phase-a-f-review-2026-09-29.md`。本文件描述工作区修复后的契约，不表示已经发布。验证与未完成的发布步骤见 `docs/phase-a-f-remediation-2026-09-30.md`。

## MCP 与审批

- 无 DTO 的工具只接收 `{}`；非空参数明确返回 JSON-RPC `InvalidParams`（-32602），不会静默清空。需要参数的工具必须声明 DTO。
- 审批超时统一为 `McpApprovalTimeoutError`（协议层 -32600），终态审计为 `denied`；取消为 `cancelled`。`onApproval` 是观察钩子，其异常不改变审批或审计。MCP Host 负责终态审计，参考应用在外围 Guard 使用 `audit: false` 避免重复；Host 仍审计外围 Guard 拒绝和预先取消。
- Guard 审批服务声明 `managesTimeout: true`，由该服务执行票据期限。其他注入后端仍由 Host 设置兜底超时，并在结束时中止 signal。不要为不能兑现期限的自定义后端声明此能力。
- `approve` / `reject` 统一返回 `Promise<boolean>`，所有调用都必须 `await`；不得以 Promise 的真假判断批准结果。
- `resume(id, context, { signal })` 必须提供原始 `tool / caller / sessionId / requestId / args` 上下文。参数对象按键排序后计算指纹；不匹配返回 `approval-context-mismatch`，不消费原票据。
- 共享存储仅保留绑定指纹、脱敏摘要及票据元数据，不保存原始 args。恢复时由持有原始请求的调用端重新提交绑定上下文。通知回调仍会收到本次内存中的请求供审批，通知系统应自行限制访问。
- 本地容量限制只计算未消费票据；消费墓碑保留到原始 `expiresAt` 防重放，后续请求清理过期记录。调用端必须使用全新的票据 ID，不得在过期后重用业务自定义 ID。共享存储仍需配置服务端 TTL/清理策略。
- 存储错误返回 `approval-backend-failed`，不冒充超时；服务尝试原子终态化票据。存储持续不可用时只能依靠不可变到期时间阻止后续审批，不能声称跨进程持久化已成功。
- `createdAt` 不接受未来时间；审批和 session 定时配置须为正值且不超过 2,147,483,647ms。
- HTTP adapter 默认最多 1000 个 active transports、5 分钟 session 闲置期限；可通过 `maxSessions` / `sessionTtlMs` 设置。过期会关闭 transport，长时间静默请求应配置更长上限或重新建立 session。
- Bearer 验证结果必须含非空字符串 `sub` 或 `client_id`。stateless progress 通过 SDK 请求级 `sendNotification` 发送。资源/提示词先认证后查询，不再泄露资源存在性。
- 未装饰的子类覆盖方法不会继承 MCP 暴露权限。需要暴露时重新使用 `@Tool/@Resource/@Prompt`。legacy 和 TC39 方法装饰器一致；这不代表第三方 class-validator 属性装饰器已经支持 TC39。

## LLM

- 开启预算后 `store` 和原子 `incrBy` 必填。默认单次 completion 预留上限为 1024 token，可用 `budget.defaultMaxTokens` 覆盖；不再把整个 scope 余额作为默认输出额度。
- 首个 chunk 之前立即失败退还预留；已输出且没有 usage 的中断保留本次有限预留。正常完成优先用 provider usage；本地估算不再提前截断流。
- provider 即使忽略 signal，等待 `next()` 也受取消/超时约束；无法强制停止第三方 SDK 的后台工作，adapter 仍应自行响应 signal。关闭 iterator 的失败不覆盖业务结果。
- 结算存储失败不覆盖原始响应/错误，记录 `budget_settlement_failed`。需要通过应用注入 logger 观测并对账；未确认结算的 scope 应按保守预留处理，不能盲目退款。
- 缓存键包含 client 实例、DTO 身份、有效 schema、路由及请求；`cacheKey` 是附加区分值。不同 client 不共享条目；坏缓存视为 miss 并重新请求。
- `streamWithTools` 与 `withTools` 均可解构调用；未授权工具在对外输出前拒绝，执行错误作为工具结果交回模型；轮次上限不会跳过白名单校验。

## Guard 与 Trace

- 凭据键使用去除 `_`/`-` 后的精确匹配，保护 password/pwd、secret、token/accessToken/refreshToken、apiKey/accessKey/privateKey、credential、session、cookie 等；保留 `total_tokens`、`maxTokens`、`nextPageToken`、`tokenizer`。Bearer、含口令的 URL、PEM 私钥也会脱敏。
- 内容检查遍历对象键、Map、Set 和 UTF-8 Buffer；NFKC、零宽字符清理和常见同形字规范化覆盖已知绕过。它仍是启发式辅助控制，不能保证识别所有 Unicode 混淆或恶意提示，scope 和人工审批仍是执行权限边界。
- Buffer/Map/Set/Array 审计摘要仅记录类型和大小，避免把大 Buffer 展开成数百万个键。
- Guard 拒绝只写一条 `rejected` 审计，错误字段使用稳定错误码；自定义审计 masker 异常仅输出占位符，不改变业务结果。
- GenAI error span 设置 OTel ERROR；内容 masker 失败保留非内容属性和失败标记，不回退原文。非有限/负数 token 或成本不进入聚合指标。

## DTO、静态 schema 与环境

- validation 用 class-transformer 的显式转换及设计类型恢复嵌套 DTO、Date；不启用全局隐式 primitive 转换。数组元素使用 `@Type(() => ChildDto)` 与 `@ValidateNested({ each: true })`；不合法 Date 和字段类型仍拒绝。
- JSON Schema 不等同运行时验证器。数字字符串、IP、手机号、布尔字符串、Date、URL/Email/UUID 选项、比较器转换与对象身份等无法完整表达的规则明确标记 `x-koatty-unresolved`；CLI 的相应条目进入 `unresolved`，不再把只有 type 的结果称为完全解决。
- TypeScript `?` 不会替代 `@IsOptional`；ValidateIf 与嵌套转换在静态 schema 中保留不确定性。TC39 没有设计类型，DTO 应继续使用 legacy class-validator 声明并从 TC39 服务方法显式传 `types: [Dto]`。全量 TC39 DTO、Bun、TS7 迁移属于独立方案，未在此轮实现。
- 环境优先级为 `KOATTY_ENV || NODE_ENV`；production/prod、development/dev、test 按完整名称匹配，latest 不会命中 test。Swagger/TypeORM 默认策略复用 `resolveProfileName`，显式 app security 优先。
- `resolveProfile` 拒绝非法画像、未知字段、原型键、错误类型/枚举及非有限数值，不再静默接受非法配置。
- `legacyDefaults` **只回退 `LEGACY_DEFAULTS` 明确列出的画像字段**。它不是全框架兼容模式，不回退 TLS1.2 下限、Swagger/ORM 独立开关、凭据脱敏、CLI 沙箱及缺陷修复。此处收窄此前“一键恢复所有旧行为”的文档承诺，不添加新的安全降级。
- `/metrics` 默认只信任回环地址。私网来源需显式 `allowCidrs` 或 ops token；若反向代理在回环地址或其网段已被放行，必须在代理侧限制路由或使用 token，不能将代理地址等同最终调用方身份。X-Forwarded-For 不参与信任判断。
- 未提供 security profile 时 WebSocket 也默认检查 Origin；CLI writeInside 拒绝硬链接，prettier/eslint 路径前传 `--`。

## 示例与发布

参考应用流中途失败发送安全 `error` SSE 并记录固定错误，不发送 done 或泄露 provider 原始错误。EPIPE/ECONNRESET/断连不视为业务故障。beginDrain 后 readyz 为 503、healthz 仍为 200；close 等待连接自然结束，5 秒后强制收尾。示例纳入 diff coverage，主 koatty 包的发布 files 不包含 examples。嵌套 workspace 必须完整 checkout 子模块，不能以缺失示例的安装结果代替 CI 验收。

取消 `.changeset/*.md` 忽略规则；新包以 0.0.0 为开发基线，由 major changeset 生成首次 1.0.0。trace 基线 2.4.0、validation 基线 4.0.0。完整 changeset 集合中已有 validation major，最终目标为 5.0.0；MCP/LLM peer 对齐该目标。HTTP3 的 serve 为 peer（兼容 3.5/4.x）与 workspace 开发依赖，不再作为普通运行时 dependency 打入第二份。锁文件由 pnpm 生成。

本轮不执行 changeset version、git add/commit/push 或 npm publish；嵌套模板子模块仍需人工按“最内层子模块 → koatty-ai → 根仓库指针”顺序提交，随后才可推送与发布。
