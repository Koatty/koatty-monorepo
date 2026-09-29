# Phase F 迁移指南：AI 运行时能力 —— `koatty_mcp@1.0.0`（F-1）

> 2026-09-29 审计修复已变更部分初版契约；以 [审计修复迁移](phase-f-audit-fixes.md) 为准（鉴权、预算、审批 CAS、追踪生命周期）。


适用版本：新增包 `koatty_mcp@1.0.0`；配套 `koatty_validation` 4.0.0 → 4.1.0（minor，增量）、`koatty_core` 2.5.0 → 2.6.0（minor，增量）。
方案来源：`docs/koatty-hardening-and-ai-evolution-plan.md` §9（Phase F，本次交付 F-1；F-2 见 `docs/migration/phase-f-llm-client.md`；F-3 ～ F-5 未包含）。

本次交付**无破坏性变更**：`koatty_validation` 与 `koatty_core` 的改动均为增量，非 MCP 请求与既有 `@Validated` 语义不变。`koatty_mcp` 是可选包，不安装它就不会进入任何新代码路径。

---

## 1. 新增包 `koatty_mcp`（F-1）

```bash
pnpm add koatty_mcp @modelcontextprotocol/sdk
```

- **定位**：把 `@Service` 组件的方法以 `@Tool` / `@Resource` / `@Prompt` 声明为 MCP 对象，协议状态机交给官方 `@modelcontextprotocol/sdk`，Koatty 只负责装饰器、IoC 集成与传输适配。
- **输入 schema 来自既有声明**：工具的 `inputSchema` 由 `@Validated({ async: false, types: [Dto] })` 中的 DTO 推导（class-validator 元数据 → JSON Schema）。**不要**期望它解析任意装饰器组合：无法静态映射的约束会出现在 `x-koatty-unresolved` 数组里，而不是被静默丢弃。
- **参数校验走同一条路径**：MCP 调用参数经 `koatty_validation` 白名单校验，DTO 未声明字段被剥离；非法参数返回 JSON-RPC `-32602`，不是未处理异常或 500。
- **每次调用一个请求作用域**：适配层进入/退出容器请求作用域，并在既有 Core ALS 上下文上补齐 `principal`、`mcpSessionId`、`mcpRequestId`、`mcpToolName`、`signal`、`progress()`。**没有**并行的 ToolContext 存储 —— 在工具方法里用 `this.app.getCurrentContext()` 读这些字段即可。
- **handler 实例从容器解析**（`container.get(identifier, type)`），因此 Singleton / Prototype / Request 作用域按组件声明生效；解析不到即报错，不会隐式 `new`。
- **鉴权默认关闭**：不传 `security.auth` 时，带 HTTP 头的调用方身份为 `anonymous`；stdio 调用方由 `stdioIdentity` 决定。要在 HTTP 与 stdio 上一致地保护工具，请显式配置：

  ```ts
  security: {
    auth: createApiKeyAuth({ keys: { 'svc-key': ['order:refund'] } }), // 或 createBearerAuth(...)
    strict: true,                       // destructiveHint 且未显式 requireApproval:false ⇒ 需要审批
    allowedOrigins: ['https://app.example.com'],
    approvalTimeoutMs: 5 * 60 * 1000,
  }
  ```

- **fail closed 的审批门**：`requireApproval: true` 的工具（或 strict 画像下的 `destructiveHint` 工具）在没有配置审批后端时**永不执行**，返回 JSON-RPC 错误并写入 `pending-approval` 审计记录。生产环境不要为了"能跑通"而删掉审批后端。
- **协议安全**：校验 `Origin` 头（默认仅放行 loopback，可用 `security.allowedOrigins` 扩展）以防 DNS rebinding；本地模式默认绑定 `127.0.0.1`（`MCP_DEFAULT_HOST`），对外暴露必须显式决定。
- **审计默认关闭**：不传 `audit` 就没有任何调用记录。审计摘要经过脱敏（`summarizeArguments` + 可选 `redact`），但**不要把密钥/令牌放进工具参数**：脱敏是兜底，不是许可。
- **挂载方式**：HTTP 传输是普通 Koa 中间件，挂到既有 HTTP 服务上，不新增 serve 协议枚举：

  ```ts
  const adapter = createMcpHttpAdapter({ host });   // path 默认 /mcp
  app.use(adapter.middleware);
  ```

---

## 2. `koatty_validation` 4.1.0：DTO 类型桥接元数据

`@Validated({ types: [Dto] })` 现在会额外写入 `PARAM_DTO_KEY` 元数据（`{ partial, types: string[], dtoTypes: Function[] }`）：

```ts
import { PARAM_DTO_KEY } from 'koatty_validation';
const bridged = IOCContainer.getPropertyData(PARAM_DTO_KEY, prototype, methodName);
```

- **增量改动**：`PARAM_CHECK_KEY`（路由参数注入使用）语义完全不变，老代码零影响。
- **异步 `@Validated({ async: true })`**：DTO 桥接同样写入，MCP schema 与 HTTP 校验取自同一份声明。
- 若你自定义了元数据扫描工具，需要同步感知这个新键；无需删除或迁移既有键。

## 3. `koatty_core` 2.6.0：`KoattyContext` 协议字段

新增**可选**字段与 `KoattyPrincipal` 类型：`principal`、`mcpSessionId`、`mcpRequestId`、`mcpToolName`、`signal`、`progress`。

- 非 MCP 请求这些字段保持 `undefined`，不需要迁移。
- 如果你实现了自定义 Context，请确保不覆盖未知字段（此前的实现已按 `KoattyContext` 结构透传，通常无需改动）。
- `signal` 用于把客户端断开/取消传递到下游（例如后续 F-2 的 LLM 流式调用）；`progress()` 用于上报进度。

---

## 4. 发布状态与剩余工作

- 已交付：**F-1**（`koatty_mcp@1.0.0`）+ 配套 `koatty_validation@4.1.0`、`koatty_core@2.6.0`；**F-2**（`koatty_llm@1.0.0`，迁移说明见 `docs/migration/phase-f-llm-client.md`）。回归测试：`packages/koatty-mcp/test/regression/F-01.mcp-host.test.ts`（19 例）、`packages/koatty-llm/test/regression/F-02.llm-client.test.ts`（19 例）。
- 未交付（Phase F 其余条目，见方案 §9）：F-3 `koatty_guard`（审批后端/提示注入检测/限流等切面服务）、F-4 GenAI 可观测性（`gen_ai.*`）、F-5 参考应用 `packages/koatty/examples/mcp-order-service`。
- Phase F 验收门中“客户端断开后 LLM 流式请求 1 秒内被取消”已由 F-2 回归用例覆盖；“MCP → 工具 → LLM 完整链路”仍需 F-5 参考应用端到端验证。
