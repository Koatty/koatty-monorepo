# koatty_guard

AI guardrails for Koatty: masking, prompt-injection inspection, human approval,
rate limiting and auditing — built on the EXISTING AOP implementation, not on a
new decorator stack.

> Roadmap: `docs/koatty-hardening-and-ai-evolution-plan.md` → Phase F, item **F-3**.

## Design constraints (from the roadmap)

- No new `Guard` base class and no new decorator stack: the services are plain
  classes, and a **single** `GuardAspect` implements `IAspect` from
  `koatty_container` (the existing `@Around` / `@Before` pipeline applies one
  `Around` per method, so composing several independent aspects is not a
  supported assumption).
- Rule-based inspection only catches **known** patterns. The primary defences
  stay the permission scopes and human approval of `koatty_mcp` (F-1).
- Everything fails closed: a call that needs approval without a configured
  backend never executes, and a ticket that times out is **rejected**.

## Use

```ts
import { createGuard } from 'koatty_guard';

const guard = createGuard({
  app,                                   // Koatty application (current context)
  rateLimit: 60,                         // calls per caller+tool per window
  windowMs: 60_000,
  approvalTimeoutMs: 5 * 60 * 1000,      // silence == rejection
  requiresApproval: (tool) => tool === 'order.refund',
  inspectsContent: (target) => target === 'llm.ask',
  auditSink: (record) => logger.info('guard-audit', record),
});

// The approval backend also satisfies koatty_mcp's `ApprovalService`:
const host = createMcpHost({ app, approval: guard.approval, audit: guard.audit, redact: (v) => guard.masking.mask(v) });
```

Wrap a business call with the composed aspect (also what `@Around` calls):

```ts
const result = await guard.aspect.runGuarded('order.refund', [dto], () => orderService.refund(dto));
```

| Service | Purpose |
|---|---|
| `createMaskingService` | Redacts phone / national id / e-mail / bank card (rules configurable); returns a masked copy, never mutates. |
| `createContentGuard` | Prompt-injection heuristics for external content with `reject` / `flag` / `downgrade` policies. |
| `createApprovalService` | Human-in-the-loop backend (`request` / `approve` / `reject` / `list`) with optional shared store and timeout → reject. `createCallbackApprovalService` drives MCP elicitation or a webhook. |
| `createRateLimiter` | Sliding-window limiter, keyed by caller + tool. |
| `createAuditService` | Redacted structured records (caller, target, argument summary, status, duration). |

## Verify

```bash
npx jest test/regression/F-03 --coverage=false   # 18 cases
npx tsc -p tsconfig.json --noEmit
```

## License

BSD-3-Clause
