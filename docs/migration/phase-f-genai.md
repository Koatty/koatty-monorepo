# Phase F 迁移指南：GenAI 可观测性 —— `koatty_trace@2.4.0 → 2.5.0`（F-4）

适用版本：`koatty_trace` 2.4.0 → 2.5.0（minor，纯增量 API；未改动既有 Trace/指标行为）。
方案来源：`docs/koatty-hardening-and-ai-evolution-plan.md` §9（Phase F，F-4）。

本次交付**无破坏性变更**：新增导出 `createGenAiRecorder` / `GEN_AI_ATTRIBUTES` / `GEN_AI_SPAN_NAMES`，
不改变现有 `Trace()` 中间件、Span 名称、指标名称与采样行为。不调用新 API 的现有应用行为完全不变。

---

## 1. 新增能力

`src/genai/` 按 OpenTelemetry GenAI 语义约定（development 状态）记录大模型与工具调用：

```ts
import { createGenAiRecorder } from 'koatty_trace';

const genai = createGenAiRecorder({
  captureContent: false,                              // 默认：不记录提示词/输出原文
  mask: (v) => guard.masking.mask(v),                 // 仅在 captureContent 时使用
  pricePer1kPrompt: { 'openai:gpt-4o-mini': 0.00015 },      // 或用单个数字作为默认单价
  pricePer1kCompletion: { 'openai:gpt-4o-mini': 0.0006 },
});

genai.recordChat({ provider, model, responseModel, usage, finishReason, durationMs, context });
genai.recordToolCall({ name, status, toolCallId, durationMs, context });
genai.recordApproval({ tool, decision, durationMs, context });
genai.metrics();   // { tokensByModel, costByModel, toolCalls{total,failed,successRate}, approvals{total,approved,rejected,rate} }
```

- Span 名称：`gen_ai.chat` / `gen_ai.tool` / `gen_ai.approval`；属性 `gen_ai.system`、`gen_ai.request.model`、
  `gen_ai.response.model`、`gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens`、
  `gen_ai.response.finish_reasons`、`gen_ai.tool.name`、`gen_ai.tool.call.id`、`gen_ai.operation.name`、
  `gen_ai.usage.cost_usd` 等。
- **属性名集中在 `src/genai/constants.ts`**（`GEN_AI_ATTRIBUTES` 已 `Object.freeze`）。上游语义约定仍是
  development 状态（风险 R-06），跟进时只改这一个文件；**不要把属性字符串散落在业务代码里**。

## 2. 升级注意

1. **隐私默认值**：`captureContent` 默认 `false`，提示词与模型输出**不会**进入 Trace。显式开启后内容按
   `gen_ai.prompt` / `gen_ai.completion` 记录，并且必须先经 `mask` 处理；不传 `mask` 会把原文写入 Trace，
   请注入 F-3 的脱敏服务，不要在生产环境裸开。
2. **父 Span 选择**：`record*` 默认使用当前活动上下文。在 `await` 之后（或测试等没有注册 OTel 上下文管理器的场景）
   请传 `context`：

   ```ts
   const ctx = trace.setSpan(context.active(), requestSpan);   // 来自 @opentelemetry/api
   genai.recordChat({ ...input, context: ctx });
   ```

   这样 “MCP/HTTP 请求 Span → 工具调用 Span → LLM 调用 Span” 处于同一条 Trace，可直接在 Jaeger/Tempo 中串起链路。
3. **成本**：只有配置了单价才会写入 `gen_ai.usage.cost_usd` 与 `costByModel`；未配置单价的模型不会出现在 `costByModel`
   里（不是记为 0）。单位是「每 1k token」的价格，货币单位由调用方自行统一（建议 USD）。
4. **模型键**：指标按 `provider:model` 聚合，其中 model 取 `responseModel ?? model`（即故障转移后的实际回答模型）。
   配置字典单价时请用同一格式的键。
5. OTel 相关依赖已在本包内，**无需**额外安装 `@opentelemetry/*` 即可使用；测试若要断言真实 Span，可用
   `@opentelemetry/sdk-trace-base` 的 `InMemorySpanExporter`（注意 SDK ≥ 2 已移除 `addSpanProcessor`，
   改为构造函数 `spanProcessors` 选项）。

## 3. 验证

```bash
cd packages/koatty-trace
npx jest test/regression/F-04 --coverage=false   # 6 例
npx tsc -p tsconfig.json --noEmit
```

回归用例覆盖：属性名常量（含冻结）、chat Span 的供应商/模型/token/结束原因/耗时/成本、默认不记录提示词与
输出原文、`captureContent` 下先脱敏再记录、工具与审批 Span 与请求 Span 同 Trace（父 Span 校验）、
工具成功率与审批通过率、按模型单价估算成本。
