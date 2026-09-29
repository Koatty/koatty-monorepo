# Phase F 迁移指南：LLM 调用抽象 —— `koatty_llm@1.0.0`（F-2）

> 2026-09-29 审计修复已变更部分初版契约；以 [审计修复迁移](phase-f-audit-fixes.md) 为准（鉴权、预算、审批 CAS、追踪生命周期）。


适用版本：新增包 `koatty_llm@1.0.0`（新增包无需通过 changeset 递增版本）。
方案来源：`docs/koatty-hardening-and-ai-evolution-plan.md` §9（Phase F，本次交付 F-2；F-1 见 `docs/migration/phase-f-mcp-host.md`，F-3 ～ F-5 未包含）。

本次交付**无破坏性变更**：`koatty_llm` 是新增可选包，不安装它不会进入任何新代码路径；既有包没有为了 F-2 修改行为（仅新增包自身的实现与测试）。四个可替换点是常量与构造参数，不是全局开关。

---

## 1. 新增包 `koatty_llm`（F-2）

```bash
pnpm add koatty_llm
```

**定位**：只做"可靠地调用模型"——厂商抽象、路由与容错、预算、取消、结构化输出、工具循环、结果缓存。**不含** Agent 编排 DSL/多智能体框架，请勿把它当作工作流引擎使用。

```ts
const llm = createLlmClient({
  providers: [createOpenAiCompatibleProvider({ name: 'openai', baseUrl, apiKey }), /* ... */],
  routes: { default: { model: 'default', provider: 'openai', providerModel: 'gpt-4o-mini', fallbacks: ['local'] } },
  reliability: { attempts: 2, backoffMs: 200, timeoutMs: 60_000, breakerThreshold: 5 },
  budget: { maxTokens: 200_000, scope: 'tenant', store: redisStore },
  cache: cacheableService,          // 可选：任意 koatty_cacheable 兼容服务
});
```

### 需要留意的语义（易误用点）

- **重试只针对 429/5xx**：4xx（除 429）与校验失败立即抛出，不做无意义重试；`attempts` 是"每个路由的总尝试次数"，不是"额外重试次数"。
- **熔断按 provider + model**：达到 `breakerThreshold` 连续失败后该组合直接跳过并进入不可用错误，不会每次调用都打满超时；恢复用 `resetBreakers()`（建议挂在管理接口上，不要自动无限重试）。
- **预算原子预留后结算、超限即中止**：请求前检查 scope 已用额度，调用后按 `usage` 记账。超额抛 `LlmBudgetError`（带 `scope`/`used`/`max`），**不会**静默截断输出；`BudgetStore` 需实现 `get`/`set`/原子 `incrBy`，多实例部署务必用共享存储，否则每个实例各有一份额度。
- **取消**：把请求的 `ctx.signal` 透传到 `stream({ signal })`。信号同时传给 provider 请求与分块检查，因此 SSE 取消在**一个网络往返内**生效并抛 `LlmAbortError`；不要用 `Promise.race` 模拟超时。
- **结构化输出**：`schema` 是发给厂商的 JSON Schema，`dto` 是 `koatty_validation` 的 DTO；只有 dto 时自动生成 schema，模型返回的 JSON 会用既有 class-validator 元数据校验。失败抛 `LlmValidationError`（`issues`、`raw` 供排查），`validationRetries`（默认 1）会带纠正提示再问一次。
- **工具循环在进程内执行**：`withTools({ tools, registry, invoke })` 只负责"模型要工具 → 你的 invoker 执行 → 结果回灌"。权限、审批、审计仍由工具宿主（`koatty_mcp` 的 `requireApproval` / `auth` / `audit`）负责 —— **不要**在 LLM 层绕过审批直接执行高危工具。`maxRounds` 是硬上限，未知工具名直接拒绝。
- **缓存仅精确匹配、仅非流式**：`complete()` 命中缓存时结果带 `cached: true`；`stream()` 不缓存。语义缓存不在 v1 范围内，`cache: false` 可单次绕过。
- **成本估算来自路由价格**：未配置 `pricePer1kPrompt`/`pricePer1kCompletion` 时 `cost` 为 `undefined`，不要把它当作账单依据。

### 错误分类（迁移时按此分支）

| 错误 | 处置建议 |
|---|---|
| `LlmAbortError` | 调用方主动取消，直接向上传播（不要再重试） |
| `LlmTimeoutError` | 可重试（已由 `attempts` 覆盖） |
| `LlmBudgetError` | 业务/配额问题：提示用户或切换模型，**不要**自动提高额度 |
| `LlmValidationError` | 提示词或 DTO 不匹配；查看 `issues` 修正，不要盲目循环重问 |
| `LlmUnavailableError` | 全部路由/尝试失败，`attempts` 记录次数，并透出最后一次失败的 `code`/`retryable`：据此区分"配置错误（不重试）"与"上游抖动（可稍后重试）" |

## 2. 与 `koatty_mcp`(F-1) 的衔接

- `ctx.signal` 由 MCP 适配层写入，直接透传给 `llm.stream()` 即可满足"客户端断连 1 秒内停止"的验收要求（回归用例覆盖取消 ≤1s）。
- MCP 工具的 `inputSchema` 与 LLM 的 `dto` 都源自 `@Validated({ types: [Dto] })`：**同一份声明**同时约束模型输出与工具入参，改一处即可，不要重复定义 schema。
- 工具执行仍走 MCP 宿主的鉴权/审批/审计链路；`koatty_llm` 只回灌结果。

## 3. 依赖与验证

- `koatty_validation` 是硬依赖；`koatty_store`、`koatty_cacheable` 是可选 peer（用自研 Redis/DB 客户端时只要能提供 `get`/`set`（可选 `incrBy`）与缓存服务接口即可）。
- 本地验证（无需网络，测试用脚本化 `fetch` double）：

  ```bash
  cd packages/koatty-llm
  npx jest test/regression/F-02 --coverage=false   # 19 例
  npx tsc -p tsconfig.json --noEmit
  ```

## 4. 发布状态与剩余工作

- 已交付：**F-1**（`koatty_mcp@1.0.0`）、**F-2**（`koatty_llm@1.0.0`）+ 配套 `koatty_validation@4.1.0`、`koatty_core@2.6.0`。
- 未交付（Phase F 其余条目，见方案 §9）：F-3 `koatty_guard`、F-4 GenAI 可观测性（`gen_ai.*`）、F-5 参考应用 `packages/koatty/examples/mcp-order-service`。
- Phase F 验收门中"客户端取消 1 秒内生效"已由 F-2 回归用例覆盖；"MCP → 工具 → LLM 完整链路"仍需 F-5 参考应用端到端验证。
