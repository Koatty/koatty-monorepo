# Koatty 面向 AI 开发与 MCP / Agent 场景的重新评估

日期：2026-09-30。性质：改造前评估与设计建议。后续本地实现状态见文末补充、总体路线图 Phase G 和 [迁移说明](migration/phase-g-ai-development.md)；尚未发布，不能把历史建议和当前交付状态混为一谈。

## 1. 判断与目标

Koatty 已具备 AI 友好的基础设施，以及 MCP 宿主、模型调用、护栏和追踪组件。下一阶段的主要问题是：这些能力尚未成为 AI 可以稳定发现、组合、修改、验证和恢复的一套开发流程。

建议定位：**让 AI 编码助手可靠开发应用，让业务能力安全地被 Agent 调用，并支持构建可观测、可恢复的 Agent 应用的 TypeScript 后端框架。**

需要同时解决三个不同问题：

1. **AI 使用框架开发软件**：CLI、结构清单、版本匹配的文档、生成器、变更计划、验证报告。
2. **Agent 使用框架提供的业务能力**：MCP Tools / Resources / Prompts、输入输出契约、身份、权限、审批、幂等和审计。
3. **开发者使用框架构建 Agent 应用**：模型调用与工具循环、运行状态、取消、预算、恢复、事件和业务结果验收。

第一项是近期最高优先级。第二项已有较完整的底座。第三项已有请求内工具循环，但尚不等于持久化 Agent 运行时。

继续遵守原路线图 ADR-106：AI 依赖放在可选组件，核心容器、路由和服务生命周期保持通用。不要为了 Agent 再造一套 DI、配置、审批或预算权威。

## 2. 本轮检查与证据边界

检查了 CLI 命令入口、生成流水线、普通 apply、MCP 工具与事务、静态清单、模板管理、默认项目模板，以及 MCP / LLM 的公开类型与主要执行链。结合原 Phase E/F 方案和迁移文档核对。

本轮实际运行：

| 检查 | 结果 | 能证明什么 |
|---|---|---|
| `pnpm --filter koatty_cli test -- --runInBand --coverage=false` | 41 suites、205 tests 通过 | 当前 CLI 既有测试通过 |
| `pnpm --filter koatty_cli exec tsc --noEmit` | 退出码 0 | 当前 CLI 类型检查通过 |
| 从源码执行 CLI `--help` | 成功 | 核实当前公开命令集合 |
| 从源码 collectManifest 扫描 `packages/koatty/examples/mcp-order-service` | 2 个组件、0 条路由、无 `mcp` 字段、`unresolved=[]` | 静态清单未描述示例的 MCP 能力；不代表运行时未注册工具 |
| 对真实 apply 处理器注入失败的 lint/typecheck 返回值，应用临时 changeset | 文件写入、显示类型检查失败、最终显示成功、退出码 0 | 质量失败没有传递到命令失败语义；质量工具为受控替身 |

临时探针文件已清理。未修改生产代码、未运行发布流程。本报告不将既有历史验收记录算成本轮复测，也不声称完成真实供应商、共享存储跨进程恢复、独立 npm 安装或外部 MCP 客户端验收。协议官网检索本轮未取得可用结果，因此没有据此声称符合某个最新 MCP 规范版本。

## 3. 已有基础值得保留

- 静态 manifest 已有组件、路由、DTO schema、切面、配置键、schema 来源和 unresolved；不会为了解析而启动用户应用。见 `packages/koatty-ai/src/manifest/index.ts:86`。
- CLI MCP 已有 7 个工具，MCP apply 包含会话内签发、前像检查、有效期、一次性消费、默认预览和文件事务恢复。见 `packages/koatty-ai/src/mcp/tools.ts:56`、`src/mcp/transaction.ts`。
- 普通生成流程已有 Spec → GeneratorPipeline → ChangeSet，不必推倒重做。见 `packages/koatty-ai/src/pipeline/GeneratorPipeline.ts`。
- 运行时 MCP 已复用容器、DTO 验证、请求上下文、权限、审批和审计，支持 HTTP / stdio，并提供 Tools / Resources / Prompts。见 `packages/koatty-mcp/src/server.ts`、`src/types.ts`。
- LLM 已提供流式调用、结构化输出、provider 适配、预算、工具 allowlist、有限轮数的工具循环。见 `packages/koatty-llm/src/types.ts`、`src/client.ts:552`。
- Guard / Trace 和订单参考应用为组合能力提供了现成入口；应将这些组装经验提炼为可生成、可验收的工程配方。

这些能力说明下一阶段应侧重统一与产品化，而不是继续零散增加包和装饰器。

## 4. 当前最影响 AI 使用的缺口

### 4.1 CLI 与 MCP 的变更语义分叉

普通 `plan` 输出面向人的预览；普通 `apply` 从 Spec 重新生成，或直接加载 ChangeSet 后逐文件写入。它没有调用 MCP 的计划签发与事务入口。见 `src/cli/commands/plan.ts`、`src/cli/commands/apply.ts:128`。

MCP 路径则保存前像，检查计划是否由当前会话签发，最后调用 `applyTransaction`。见 `src/mcp/tools.ts:313`、`:382`。

因此不能把“MCP apply 有前像与回滚”概括为“所有 CLI 写入口都有同等保证”。AI 通过 shell 和 MCP 完成同一件事时，目前会得到不同的安全与恢复语义。

**目标**：提取共享开发操作层，CLI 和开发 MCP 成为两个适配器。保留默认预览、根目录约束和并发冲突检查；把协议补丁、依赖声明等辅助写入也纳入计划。

### 4.2 AI 不能可靠判断任务是否成功

普通 `apply` 的 lint/typecheck 失败只告警，之后仍执行成功提示；显式 `--commit` 分支也位于其后。见 `src/cli/commands/apply.ts:170`。受控探针已确认退出码 0。

开发 MCP 正常结果是 JSON 序列化后的 text，异常是 `Error: ...` 字符串，没有统一稳定错误码、修复建议或输出 schema。见 `src/mcp/tools.ts:520`、`:533`。

`koatty_test` 返回单文件 Jest 的 passed/exitCode 和日志尾部，尚不是编译、测试、启动、协议和业务断言的统一交付报告。测试失败可体现在 `passed:false` 而非工具级 `isError`，消费端必须另行解释。

**目标**：区分“计划生成成功”“文件已写入”“验证失败”“已验证完成”，让退出码、结构化状态与实际结果一致；验证默认不修改源文件，修复格式/lint 应是显式操作。

### 4.3 静态发现尚未覆盖自己的 AI 运行时

Manifest v1 没有 MCP tools/resources/prompts 字段。订单参考应用实际声明 3 个工具和 1 个 Resource，但本轮采集只返回 `OrderService` / `OrderTools` 两个组件，并且没有未覆盖能力的诊断。

这会使 AI 误把“清单符合 v1 schema”理解为“已经完整理解应用”。

**目标**：增加有版本的 MCP 能力投影，包含源文件定位、输入输出 schema、scope、审批要求、副作用声明与解析覆盖情况。静态声明与运行时有效注册分别标明来源；不要把 Loader 的 runtime 文件清单误称为运行时业务 introspection。

### 4.4 生成器仍以 CRUD 为中心

`Spec` 围绕 module/table/fields/api/dto/auth/features；API 类型为 rest/grpc/graphql。ModuleGenerator 固定生成 Model、DTO、Service、Controller 和测试。`new` 仅提供 project/middleware/plugin，单文件创建也没有 MCP Tool / Resource / Prompt 或 Agent 配方。

证据：`src/types/spec.ts`、`src/generators/ModuleGenerator.ts`、`src/cli/commands/new.ts`、`src/cli/commands/registerCreate.ts`。

**目标**：支持纯业务能力，不强制先建表或生成 Controller。首批配方应包含：只读业务工具、需审批写工具、SSE 工具问答应用。复用现有 Service 与 DTO，通过显式选择暴露 MCP，禁止自动把所有 Service 方法变成工具。

### 4.5 模板缺少可重复生成与版本兼容保证

TemplateManager 优先使用用户缓存，再用内置模板，最后下载远端默认分支；当前生成流程没有固定模板 revision 的锁定契约。源码相同、缓存不同，可能得到不同输出。见 `src/services/TemplateManager.ts:217`、`:299`。

仓库内置项目模板仍声明 `koatty: ^4.0.0`，CLI 为 `^5.0.0`；当前工作区主包已为 5.x，CLI 为 5.1.0。该证据说明模板版本没有同步，不等于已实测所有旧版本安装都失败。

默认 smoke 测试仅 `expect(true).toBe(true)`，HTTP 示例在注释中；它证明 Jest 接线，不证明应用可启动或路由正确。见 `templates/project/default/package.json.hbs`、`test/smoke.test.ts.hbs`。

**目标**：模板清单记录兼容框架/CLI 范围、版本、revision、内容摘要与来源；生成 receipt 固定来源，显式支持离线模式；新增真实启动和协议 smoke，并做隔离安装验收。

### 4.6 工具循环尚不具备长任务恢复语义

`withTools` / `streamWithTools` 在当前请求的内存消息数组中执行有限轮数循环，已有取消和 allowlist。相关接口没有通用 runId、checkpoint、持久化步骤或恢复 API。见 `packages/koatty-llm/src/client.ts:552`、`:595`。

这适合短请求 Agent，但进程重启后不能仅凭这些 API 恢复任务。审批存储持久化也不等于整个 Agent run 已持久化。

**目标**：先界定短请求与持久任务两个层次，再提供可选 RunStore / 执行适配层。不要把 durable workflow、memory、RAG、multi-agent 全部塞进 LLM client。

## 5. 建议架构

### 5.1 一个开发操作层，两个入口

```text
人 / AI 编码助手
  ├─ koatty CLI（人类输出或 JSON）
  └─ koatty mcp（开发期工具协议）
           ↓
    共享开发操作层
    discover / inspect / plan / apply / verify / diagnose
           ↓
    Manifest、Spec、生成器、变更事务、验证器
```

可先在 `koatty_cli` 内提取模块；没有必要为了架构图立即新增 npm 包。

建议统一结果契约至少包含：schemaVersion、operation、status、data、diagnostics、artifacts；诊断包含 code、severity、文件定位、建议下一步。apply 返回 planId、实际写入清单、项目指纹和验证状态。大结果提供过滤、分页、摘要与可按需读取的 artifact，避免每次把整个项目灌入模型上下文。

JSON 模式 stdout 只输出约定的机器结果；日志和进度进入 stderr。MCP 使用相同语义映射为 structuredContent，同时保留兼容 text。服务端声明的输出 schema 应有实际结果校验，不能只发布元数据。

### 5.2 计划必须同时约束输入、授权和执行

建议 Plan 记录：project root identity、输入/配置/模板指纹、生成器版本、文件前像、完整 edits、验证计划、有效期和执行状态。

内容 hash 只能证明内容一致，不能独自证明获得授权。现有 MCP 会话隔离应保留。CLI 的跨进程计划需要独立设计可信本地计划存储和消费机制，不能简单让调用者提交任意 JSON 加自算 hash。

对新建项目区分“目标不存在”的计划身份与现有项目 realpath，避免套用现有根目录前提。跨文件失败保留 recovery artifact；面对进程被杀或断电，必须明确恢复协议，不能把顺序 rename 包装成数据库原子事务。

### 5.3 开发 MCP 与业务 MCP 保持边界

- 开发 MCP：限定项目根目录、修改代码、执行开发验证。
- 业务 MCP：只暴露应用显式声明的能力，通过身份、scope、DTO、审批、预算和审计调用业务服务。

两者共享契约设计经验，但不能因为业务应用引入 MCP 就开放源码写入或测试执行。工具 annotations 是描述；权限和幂等必须有真实执行机制。

HTTP Controller 和 MCP Tool adapter 可以调用同一个 Service。避免业务逻辑复制，也避免把 HTTP ctx 假装成所有协议通用的输入。

### 5.4 Agent 能力按可靠性层次增长

先把现有模型 + 工具循环产品化，提供显式结果终态：completed / failed / cancelled / budget_limited / tool_round_limit 等，并关联 trace 与业务结果。

需要持久任务时，再增加：

- run/step 记录、版本化 checkpoint、事件游标、租约与 fencing；
- pending approval 与执行结果分离，重启后恢复待决状态；
- 工具执行幂等键、结果记录及重复提交查询；
- 对“外部副作用成功，但本地结果未落库”的 unknown 状态执行对账，不自动重放退款等操作；
- 复用 Guard 审批与 LLM 预算权威，用 runId 关联，不建立第二套余额或审批事实；
- 对外部 workflow / Agent SDK 提供适配接口，先验证单 Agent，再决定是否需要框架自带复杂编排。

不承诺跨任意外部系统的 exactly-once；业务幂等、事务边界与恢复策略必须显式声明。

## 6. 建议的 CLI 使用闭环（待实施）

保留现有命令与别名，优先扩展已有入口而非制造大量近义命令。

```text
discover：版本、项目根、依赖、可用操作及输入/输出 schema
manifest / inspect：按工具、组件、路由、DTO 查询与解释
plan：生成完整变更与影响范围，固定模板/输入指纹
apply：消费计划，检查前像，执行并生成 receipt
verify：类型、测试、启动与协议/业务断言，输出统一报告
diagnose：把失败映射为稳定错误码、证据与可执行下一步
```

可考虑新增 `koatty capabilities --json` 与应用侧 `koatty doctor --json`；它们不同于仓库根 `pnpm doctor`。`manifest` 增加范围查询；`plan/apply` 增加 JSON 结果和计划引用；`verify` 提供明确检查级别。最终命令拼写应在接口设计时冻结，上述尚不可直接执行。

MCP 工具应复用同一操作层，而不是逐命令机械映射。缺依赖时给出结构化诊断与明确安装步骤，验证阶段不静默触发 npx 下载；运行用户测试仍属于代码执行，文件路径检查不构成 OS 权限沙箱。

## 7. 实施顺序与验收

| 阶段 | 主要交付 | 验收门 |
|---|---|---|
| G0：统一操作契约 | 共享 apply/verify、机器输出、稳定错误、非交互行为 | 同一输入经 CLI/MCP 的变更与终态一致；验证失败非零退出；预览零写入；冲突不覆盖；受控失败能恢复 |
| G1：能力发现与兼容性 | MCP manifest、capabilities、模板锁定、版本文档索引 | 示例 3 Tools + 1 Resource 可发现；动态值标 unresolved；不输出配置值；相同锁定输入得到相同文件内容 |
| G2：场景脚手架 | MCP server、审批写工具、Agent SSE 配方 | 隔离安装 → 生成 → 编译 → 启动 → 实际协议调用；非法输入/无权调用不进入业务；包含真正的行为测试 |
| G3：可恢复 Agent | 可选运行存储、步骤、事件、审批恢复、幂等适配 | 进程重启、网络超时、重复请求、取消、预算不足均有明确终态；副作用 unknown 对账不盲目重放 |
| G4：持续 AI 验收 | 固定任务集、可重复评估、真实客户端与 provider 门 | 报告首次成功率、修复轮数、人工介入、无关修改、时间/token 和业务正确性；记录模型/框架/模板版本 |

G0 中先修质量失败仍报告成功、普通 apply 与 MCP apply 分叉。G1 同步修默认模板版本及 smoke 测试。不要先做多 Agent 编排或继续大范围增加新装饰器。

每个行为变更配套回归、包 CHANGELOG 与 migration；兼容旧文本输出时可先新增 JSON 模式，但不应为保留兼容而继续把验证失败报告为成功。发布仍走 Changesets 和现有发布门。

## 8. 用真实 AI 任务判断是否“用得好”

建议固定以下任务，期望结果由框架外的验收断言判定，不由 Agent 自述判定：

1. 新项目生成只读订单查询工具，SDK 客户端调用成功。
2. 给现有订单服务增加需审批退款工具，拒绝/超时均无业务副作用。
3. 改 DTO 后同步工具 schema、输入验证和行为测试。
4. HTTP 与 MCP 复用业务服务，非法参数得到一致的业务拒绝语义。
5. 定位依赖未安装、模板不兼容、配置键缺失、循环依赖与路由冲突。
6. 计划后文件被其他开发者修改，拒绝旧计划并重新规划。
7. 取消流式问答后 provider/tool 清理、预算结算与 trace 终态正确。
8. Agent 在审批等待或工具调用期间重启，按设计恢复或报告 unknown，不重复退款。

先记录当前基线，再设提升目标；不能凭空声称当前成功率或预定百分比已达成。独立 tarball 安装是必要门，因为 workspace 软链接、旧 dist 和本地模板缓存会掩盖真实用户问题。

最终交付标准：AI 能发现支持的能力、得到准确契约、执行可审查的变更、从失败中获得可操作信息，并用独立证据确认应用行为正确。
# 实施状态补充（2026-09-30）

本文为改造前评估与分阶段建议。后续本地实现已覆盖共享开发契约、能力发现、MCP/Agent 工程、可选检查点 runner 及 Koatty Skill；当前状态和剩余验收边界以总体路线图 Phase G 和 `docs/migration/phase-g-ai-development.md` 为准。不要将下文的历史缺口继续理解为全部未实现，也不要将本地实现理解为已发布。
