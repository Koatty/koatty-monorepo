## Unreleased — Phase A–F review (2026-09-30)

Expire replay tombstones without exhausting active capacity; bind resume context; async approval decisions; omit persisted raw args; distinguish backend failure. Precise credential masking, normalized container content inspection and one terminal audit.

Migration: `docs/migration/phase-a-f-review-fixes.md` in the monorepo. No release has been applied.

# Changelog

## Unreleased — Phase F audit fixes (2026-09-29)

- 审批 UUID/单次消费/CAS 持久状态/跨实例回调与截止时间；严格批准判断；递归内容检查，敏感键及错误审计脱敏，sink 异常隔离。
- 迁移说明：`docs/migration/phase-f-audit-fixes.md`（主仓库）。


All notable changes to `koatty_guard` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## 1.0.0

First release — AI guardrails (roadmap Phase F, item F-3). Built on the existing
`koatty_container` AOP implementation; no new decorator stack or Guard base class.

### Added

- `createMaskingService`: configurable masking of phone numbers, national ids,
  e-mail addresses and bank card numbers; deep, non-mutating masking of nested
  structures; `inspect()` reports which rules matched.
- `createContentGuard`: prompt-injection heuristics for EXTERNAL content entering
  the model (ignore-previous-instructions, role override, system-prompt
  exfiltration, secret exfiltration, tool misuse, encoded payloads) with
  `reject` / `flag` / `downgrade` policies and a configurable severity threshold.
  Rule-based detection is documented as a secondary control only.
- `createApprovalService`: human-in-the-loop backend compatible with
  `koatty_mcp`'s `ApprovalService` (`request` / `approve` / `reject` / `list`),
  optional shared key/value store for tickets, and **timeout auto-rejection**.
  `createCallbackApprovalService` drives MCP elicitation or an external webhook.
- `createRateLimiter`: per-key sliding window with `retryAfterMs`, so the
  existing auth middleware can limit by caller + tool.
- `createAuditService` + `summarizeArguments`: redacted structured records
  (caller, target, argument summary, status, duration).
- `GuardAspect` / `createGuardAspect` / `createGuard`: one aspect that composes
  rate limiting → content inspection → approval → masking of the result →
  auditing, and fails closed when a guard throws.
