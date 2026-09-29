# Phase F 迁移指南：AI 护栏 —— `koatty_guard@1.0.0`（F-3）

> 2026-09-29 审计修复已变更部分初版契约；以 [审计修复迁移](phase-f-audit-fixes.md) 为准（鉴权、预算、审批 CAS、追踪生命周期）。


适用版本：新增包 `koatty_guard@1.0.0`（首次发布，未改动任何既有包的行为）。
方案来源：`docs/koatty-hardening-and-ai-evolution-plan.md` §9（Phase F，F-3）。

本次交付**无破坏性变更**：`koatty_guard` 是可选包，不安装它就不会进入任何新代码路径。它复用既有
`@Aspect` / `@Before` / `@Around` 实现（SEC-01 已修复的 AOP 语义），**没有**引入新的 `Guard` 基类、注解或注册体系。

---

## 1. 新增包 `koatty_guard`（F-3）

```bash
pnpm add koatty_guard
```

一个入口：`createGuard()` 返回全部服务 + 唯一的切面。

```ts
import { createGuard } from 'koatty_guard';

const guard = createGuard({
  app,
  rateLimit: 60,                    // 每个「调用方 + 工具」每窗口的调用上限
  windowMs: 60_000,
  approvalTimeoutMs: 5 * 60 * 1000, // 沉默即拒绝
  requiresApproval: (tool) => tool === 'order_refund',
  inspectsContent: (target) => target === 'llm.ask',
  auditSink: (record) => logger.info('guard-audit', record),
});
```

### 组合约束（重要）

- **不要叠加多个 `@Around` 切面**：既有 AOP 管线对每个方法只应用一个 `Around`。本包因此用**一个**
  `GuardAspect` 顺序调用各服务（限流 → 内容检查 → 审批 → 业务 → 脱敏 → 审计），而不是新建装饰器栈。
  如果你的应用已有自己的 `@Around`，请让它调用 `guard.aspect.runGuarded(target, args, handler)`，
  而不是再加一个 `@Around`。
- **规则型注入检测只是次要控制**：它只能拦已知模式。核心防线仍是 F-1 的权限作用域（`scopes`）与人工审批。
  文档与代码注释都按这个前提编写，请不要把它当成唯一防线。

### 默认行为与 fail closed

- 需要审批但没有配置审批后端时，**调用永不执行**（抛 `GuardError`），并写入 `pending-approval` 审计记录。
- 审批票据超时自动**拒绝**；`createCallbackApprovalService` 在回调沉默时同样超时拒绝。
- 内容检查命中且策略为 `reject` 时，业务方法不会被执行（在 `@Before` 语义下抛错）。
- 限流超出后返回可重试时间；调用方身份来自请求上下文（`principal`），匿名调用按同一键计数。

### 脱敏

`createMaskingService` 深拷贝后脱敏（不修改入参），默认规则覆盖手机号、身份证号、邮箱、银行卡号，
返回副本 + `inspect()` 命中明细。规则可配置；脱敏是**兜底**，不是把密钥放进工具参数/日志的许可。

`captureContent` 相关的 GenAI 侧用法见 `docs/migration/phase-f-genai.md`：`koatty_trace` 的
`createGenAiRecorder({ captureContent: true, mask: (v) => guard.masking.mask(v) })` 复用同一个脱敏服务。

### 与 `koatty_mcp` 的关系

`guard.approval` 与 `guard.audit` 满足 F-1 的 `ApprovalService` / 审计接口，可直接注入 MCP 宿主：

```ts
const host = createMcpHost({
  app,
  approval: guard.approval,
  audit: guard.audit,
  redact: (v) => guard.masking.mask(v),
});
```

`koatty_guard` **不依赖** `koatty_mcp`（结构性类型），两者可分别升级。

---

## 2. 验证

```bash
cd packages/koatty-guard
npx jest test/regression/F-03 --coverage=false   # 18 例
npx tsc -p tsconfig.json --noEmit
```

回归用例覆盖：脱敏不修改入参、注入特征命中与策略（reject/flag/downgrade）与严重度阈值、审批通过/拒绝/超时 fail closed
与回调后端沉默超时、滑动窗口限流、审计摘要脱敏与状态/耗时、切面在不接审批后端时 fail closed、
拒绝时写入 `pending-approval` 审计、注入内容在业务方法之前被拦截，以及 `IAspect` 接口形态。
