---
"koatty_trace": minor
---

Phase F (F-3/F-4) — AI 护栏与 GenAI 可观测性。

- **F-4（`koatty_trace` 2.5.0）**：新增 `src/genai`，按 OpenTelemetry GenAI 语义约定记录 `gen_ai.chat` / `gen_ai.tool` / `gen_ai.approval` Span（供应商、模型、输入/输出 token、耗时、结束原因、工具名与状态、审批结论），并提供 `metrics()`（每模型 token 与成本、工具调用成功率、审批通过率）。**默认不记录提示词与模型输出原文**，`captureContent: true` 时先调用注入的脱敏函数（F-3 同一服务）；`context` 选项可显式指定父 Span，使 “MCP 请求 → 工具调用 → LLM 调用” 落在同一条 Trace。属性名集中在 `src/genai/constants.ts` 便于跟进上游 development 状态。纯增量 API，未改动既有 Trace/指标行为。回归用例 `test/regression/F-04.genai.test.ts`（6 例）。迁移说明见 `docs/migration/phase-f-genai.md`。

- **F-3（`koatty_guard@1.0.0`）**：新增包 `packages/koatty-guard` —— 脱敏、提示注入内容检查、人工审批、按调用方+工具限流、结构化审计。全部构建在**既有** AOP 实现之上：一个 `GuardAspect` 顺序调用各服务，不新增 `Guard` 基类或装饰器栈（既有管线每个方法只应用一个 `Around`）。需要审批而未接审批后端时 **fail closed**（永不执行），审批票据超时自动拒绝；规则型注入检测在文档中明确为次要控制，核心防线仍是 F-1 的权限作用域与人工审批。`guard.approval` / `guard.audit` 满足 `koatty_mcp` 的接口（结构性类型，不引入包依赖）。`koatty_guard@1.0.0` 为首次发布，目标版本由 changeset major 从 0.0.0 统一生成，不直接写入 `packages/koatty-guard/package.json`，必须通过 changeset 统一生成版本。回归用例 `packages/koatty-guard/test/regression/F-03.guard.test.ts`（18 例）。迁移说明见 `docs/migration/phase-f-guard.md`。
