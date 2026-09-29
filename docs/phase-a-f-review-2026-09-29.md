# Koatty 加固方案 Phase A–F 实施全面审查报告

- 审查日期：2026-09-29
- 审查对象：工程 LLM 依据 `docs/koatty-hardening-and-ai-evolution-plan.md` 完成的 Phase A–F 实现，重点为 Phase F（MCP / LLM / Guard / GenAI Trace / 参考应用）及其审计修复轮（`docs/phase-f-audit-2026-09-29.md`、`docs/phase-f-repair-2026-09-29.md`）
- 审查基线：已提交代码 `2e7030e..7f50904`（根仓库领先 origin 8 个提交，全部未推送；子模块 `koatty` / `koatty-ai` / `koatty-validation` 分别领先 2 / 1 / 1 个提交）
- 审查方式：5 个分项审查（MCP、LLM、Guard+Trace、参考应用/Schema/流程、Phase A–E）并行进行；其中最严重的结论由主审查人逐条阅读代码、运行探针复核
- 本次审查未修改任何代码

---

## 0. 结论

**Phase F 当前不具备发布条件。**

- 首轮审计 F-A01～F-A23 中最危险的几项已真实关闭：HTTP server 复用、SSE 断开取消、工具白名单、原子预算扣减、票据一次性消费。
- 本轮新发现或残留 **13 个 P1**，其中 **9 个已由主审查人亲自复核确认**，4 个来自分项审查、证据具体但未逐条复跑。
- 质量门 `pnpm test:phase-f` **不稳定**，6 次运行失败 2 次。
- Phase A–E 的安全加固基本属实，SEC 系列回归用例均能通过，但仍有 **2 个 P1** 未关闭。
- **TC39 装饰器迁移、Bun 适配、TypeScript 7 支持**三份方案均**尚未开始实现**。
- 修复报告中“尚未提交”的表述已过时，修复已在审查期间提交。

---

## 1. 质量门实测结果

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit`：mcp / llm / guard / trace / validation / cli / example | 全部 0 错误 |
| `pnpm lint` | 0 error |
| koatty-validation 全量测试 | 通过 |
| `pnpm security:baseline` | 通过 |
| `pnpm test:phase-f:compiled`（编译产物 + 真实 HTTP） | 通过 |
| mcp 34/34、llm 31/31、guard 26/26、trace F-04 9/9 | 通过 |
| **`pnpm test:phase-f`** | **不稳定：6 次中失败 2 次** |

### 1.1 `test:phase-f` 不稳定的根因（已用探针复现）

失败用例：`packages/koatty/examples/mcp-order-service/test/regression/F-05.reference-app.test.ts:261`，即“审批后端静默时 fail closed”。

- **原因：** 同一次审批超时由两个都是 50ms 的定时器竞争处理：
  - MCP Host 层抛出 `McpApprovalTimeoutError`，审计状态记为 `pending-approval`；
  - Guard 审批服务层返回 `approval-timeout`，审计状态记为 `denied`。
- **后果：** 谁先触发由调度决定，审计语义不确定。探针 8 次中 7 次为前者、1 次为后者。
- **安全结论不受影响：** 两条路径都没有执行退款，fail-closed 成立。
- **测试缺陷：** 用例只断言 `rejects.toBeDefined()`，任何拒绝都能通过，掩盖了竞争。
- **附带确认：** 每次调用都写入两条审计记录（`pending-approval` / `denied` 各一条，另加一条 `error`），即“拒绝被重复审计”属实。

接入 CI 后预计约 1/3 的运行随机失败。

---

## 2. P1 问题

### 2.1 已亲自复核确认（9 个）

#### P1-01 MCP 静默清空无 DTO 工具的参数

- 位置：`packages/koatty-mcp/src/server.ts:160`
- 现状：`let validatedArgs = tool.dto ? args : {};`；修复前的 `ed11ed4` 为 `= args`。
- 影响：没有 DTO 的工具，调用方传入的参数被静默丢弃，属于行为回归；CHANGELOG 与 `docs/migration/` 均未记录。
- 建议：无 DTO 且收到非空参数时返回 `InvalidParams` 明确拒绝，并补回归测试与迁移说明。

#### P1-02 LLM 一次失败即锁死整个预算 scope

- 位置：`packages/koatty-llm/src/client.ts:250`、`:341`、`:387`
- 现状：
  - `started = true` 在调用 provider **之前**置位（`:341`）；
  - 结算时，已 started 但未 completed 的请求按 `reservation.reserved` 全额扣除（`:387`）；
  - 预留额 `Math.min(options.maxTokens ?? budget.maxTokens, 剩余额度)`（`:250`），调用方不传 `maxTokens` 时等于**全部剩余额度**。
- 影响：provider 立即返回 503 且不带 usage 时，整个 scope 的剩余预算被一次扣光，后续请求全部 `LlmBudgetError`。
- 同源问题（分项审查探针结果，未复跑）：剩余额度被作为 `max_tokens` 下发给 provider；并发请求被串行化，5 个并发中仅 1 个成功。
- 建议：收到首个 chunk 后再置 `started`；默认预留额设上限（如单次 `maxTokens` 默认值），而非全部剩余额度。

#### P1-03 Guard 本地审批存储容量 DoS

- 位置：`packages/koatty-guard/src/approval.ts:66`、`:107-110`、`:139`
- 现状：本地 `memory` Map 没有任何 `delete` 调用；票据消费后写为墓碑并永久保留；容量检查 `memory.size >= (maxLocalTickets ?? 10_000)` 将墓碑计入。
- 影响：累计 1 万张票据后，所有审批永久返回 `approval-capacity`，写操作工具全部不可用。
- 建议：过期或已消费的票据按 `expiresAt` 清除；补“超过容量后仍可继续审批”的回归测试。

#### P1-04 `resume(id)` 没有绑定调用方与参数

- 位置：`packages/koatty-guard/src/approval.ts:144`、`:159-168`
- 现状：`request()` 计算了包含 tool / caller / session / requestId / args 的 fingerprint 并写入存储，但全程**从未比对**；`resume` 只接收 `id`。
- 影响：与迁移文档中“审批绑定调用方和参数”的声明不符；知道票据 id 即可复用审批结果。
- 建议：`resume` 接收调用上下文并比对 fingerprint，不一致时拒绝。

#### P1-05 masking 键名正则误伤业务字段

- 位置：`packages/koatty-guard/src/masking.ts:70`
- 现状：`/(password|passwd|secret|token|authorization|api[_-]?key|cookie)/i` 为子串匹配。
- 影响：`total_tokens`、`maxTokens`、`nextPageToken`、`tokenizer` 等被替换为 `***`，包括 LLM usage 统计本身；属未记录的破坏性变更。
- 建议：改为完整词或规范化后的精确键名匹配，并在迁移文档中说明。

#### P1-06 `/metrics` 在反向代理后等同公开

- 位置：`packages/koatty-serve/src/middleware/healthCheck.ts:215-238`（调用处 `serve.ts:153-161`）
- 现状：`isTrustedRemoteIp` 只看 `socket.remoteAddress`，内置信任全部 RFC1918 私网段。
- 影响：在 k8s Ingress / Nginx 之后，公网请求的来源地址均为 10.x / 172.x / 192.168.x，全部被当作内网放行。
- 建议：默认仅信任回环地址，私网段需显式配置 `allowCidrs`；迁移文档说明部署方式。

#### P1-07 Swagger 的生产判定与 SecurityProfile 不一致

- 位置：`packages/koatty-swagger/src/index.ts:48`、`:71`；对照 `packages/koatty-core/src/security/profile.ts:160`
- 现状：Swagger 只看 `NODE_ENV`，SecurityProfile 使用 `KOATTY_ENV || NODE_ENV`。
- 影响：`KOATTY_ENV=production` 且未设 `NODE_ENV` 时，profile 判定为 strict，Swagger 却默认开启。
- 同类：`packages/koatty-typeorm/src/index.ts:55`（仅影响日志级别）。
- 建议：统一改用 `resolveProfileName()`。

#### P1-08 发布时版本号会被重复升级

| 包 | 本地 package.json | npm 已发布 | 待应用的 changeset |
|---|---|---|---|
| koatty_trace | 2.5.0 | 2.4.0 | minor |
| koatty_validation | 4.1.0 | 4.0.0 | minor |
| koatty_mcp / koatty_llm / koatty_guard | 1.0.0 | 未发布 | patch |

- 影响：执行 `changeset version` 后 trace 变为 2.6.0（跳过 2.5.0），mcp 变为 1.0.1（1.0.0 从未发布）。
- 建议：回退手工版本号，由 changeset 统一决定版本。

#### P1-09 5 个 changeset 未进入版本库

- 现状：`.gitignore:28` 的 `.changeset/*.md` 忽略了以下文件，版本库中仅跟踪 patch 级的 `phase-f-audit-hardening.md`：
  - `phase-c-audit-remediation.md`
  - `phase-d-architecture-and-performance.md`（含 `koatty`、`koatty_serve` 的 **major**）
  - `phase-e-audit-fixes.md`
  - `phase-f-mcp-host.md`
  - `phase-f-guard-genai.md`
- 说明：该规则自 `98bd7c6 init` 起即存在，并非本轮引入；如果一贯在本机发布，本地文件仍然有效。但换机器或走 CI 发布时，major 升级会丢失。
- 附带：MCP 存在破坏性变更（`createBearerAuth` 必须指定 audience、`McpHost` 新增必需成员 `createServer` / `allowedOrigins`、adapter origins 列表取代 host 列表），changeset 却只标 patch，级别偏低；peer `koatty_validation ^4.1.0` 应与最终发布版本对齐。
- 建议：`git add -f` 或取消忽略；MCP 变更级别改为 minor 或 major。

### 2.2 分项审查报告、未逐条复跑（4 个）

| 编号 | 问题 | 位置 |
|---|---|---|
| P1-10 | LLM 缓存键不含 DTO：命中后校验失败直接抛错而不重新请求，整个 TTL 内持续失败（仓库自带测试断言了此行为）；同名 provider 的不同 client 共享缓存 | `packages/koatty-llm/src/client.ts:190-203`、`:502` |
| P1-11 | `approve()` 返回类型改为 `boolean \| Promise`，共享存储模式下 `if (svc.approve(id))` 恒为真；未记录的破坏性变更 | `packages/koatty-guard/src/approval.ts` |
| P1-12 | Date 与嵌套 DTO 在运行时总被拒绝（无 class-transformer 转换步骤），而生成的 schema 声称合法；CHANGELOG 中“嵌套已修复”不成立 | `packages/koatty-validation/src/decorators.ts:225-236` |
| P1-13 | `koatty-ai` 嵌套子模块 `templates/modules`、`templates/project` 有未提交改动（`git status` 已确认 ` m`） | `packages/koatty-ai` |

---

## 3. P2 问题

### 3.1 MCP（`packages/koatty-mcp`）

- `onApproval` 钩子抛错时丢失审计记录（`server.ts:199`、`:206`）。
- 取消场景的审计状态不一致。
- stateless 模式下 progress 通知被丢弃（`server.ts:275`，应改用 `extra.sendNotification`）。
- session 没有 TTL，也没有数量上限。
- token 缺少 sub / client_id 时，所有调用共享 `oauth-client` 主体（`security.ts:141`）。
- 未认证错误码不一致，且认证之前即泄露资源是否存在。
- 未加装饰器的子类覆盖方法：legacy 装饰器下暴露、TC39 下不暴露；class-validator 在 TC39 下报 TS1240 并在运行时崩溃（F-A18 残留）。

### 3.2 LLM（`packages/koatty-llm`）

- 本地 token 估算器会提前截断流（`client.ts:351-355`）。
- `streamWithTools` 与 `withTools` 行为不一致：先输出未授权的 tool-call 片段再拒绝；直接抛原始错误；依赖 `this`。
- 类型与 README 过时：`incrBy?`、`store?` 仍为可选；`cacheKey` 语义已变；新接口成员 `streamWithTools` 未记录。
- settle / cancel 失败会覆盖成功结果。
- provider 忽略 signal 时超时失效。

### 3.3 Guard / Trace

- 存储 `get` 抛错被映射为超时，票据仍停留在 pending，之后仍可被批准。
- `createdAt` 设为未来时间可绕过超时；约 24.8 天以上的超时值溢出。
- 审计错误白名单拿 message 与错误码比较；拒绝被重复审计（`audit.ts:77`、`aspects.ts:143`、`:178`、`:180`，1.1 节已实测确认重复记录）。
- 审计 mask 抛错会在 `proceed()` 之后改变业务结果。
- 内容检查可被 Map / Set / Buffer / 键名 / 零宽字符 / 同形字绕过；8MB Buffer 耗时约 643ms。
- 凭据仍会经由 pwd、credential、privateKey、accessKey、session，以及写在非敏感键名下的 Bearer / 数据库 URL 泄露（`audit.ts:34`、`:38-39`）。
- 原始参数被持久化到共享存储（`approval.ts:148`）。
- GenAI 错误 span 状态为 UNSET；masker 抛错时 span 没有任何属性；NaN 成本会污染指标。

### 3.4 参考应用 / Schema / 流程

- `packages/koatty-validation/src/schema-rules.ts` 将 5 条规则标为已解决，但只设置了 type。
- F-A19 残留：28 条 validator 规则中 10 条与 schema 不符却未标注 unresolved（IsDate、IsNumberString、IsIP、IsBooleanString、嵌套 IsObject 等）。
- CLI 静态 schema 与运行时在 required / ValidateIf / 嵌套上不一致（`packages/koatty-ai/src/manifest/schema.ts:113-130`）。
- `examples/mcp-order-service/src/main.ts:34` 的 `catch {}` 吞掉流中途错误，既不发送 error 事件也不记日志；EPIPE 被记为 ERROR。
- 关闭时不排空连接：`closeAllConnections` 直接重置 SSE，`/readyz` 恒返回就绪，与 k8s 配置注释矛盾。
- F-A02 的背压与流中途错误回归测试缺失（行为本身已在真实 socket 上验证：provider 在 0～2ms 内中止，背压有界）。
- 覆盖率门槛排除了 `examples/`（`scripts/check-diff-coverage.cjs:15`）。
- `pnpm-lock.yaml` 为手工编辑；`pnpm-workspace.yaml` 引入了位于子模块内的 `packages/koatty/examples/mcp-order-service`；koatty 发布包可能包含 `examples/`。

### 3.5 Phase A–E

- `legacyDefaults` 回滚范围不完整。
- `resolveProfile` 不校验输入：非法 profile 导致 TypeError，可经 `__proto__` 覆盖（`profile.ts:198-208`）。
- 环境名子串匹配误判，如 `latest` 命中 `test`。
- `writeInside` 可被硬链接绕过（`packages/koatty-ai/src/utils/sandbox.ts:31-47`）。
- 未配置 profile 时 WebSocket Origin 检查关闭（`ws.ts:35-37`）。
- prettier / eslint 的 `execFileSync` 调用缺少 `--` 分隔（`QualityService.ts:30`、`:41`）。
- `koatty_http3` 将 `koatty_serve` 声明为 dependency 而非 peer。
- 偏弱的测试：SEC-15、SEC-04、SEC-10 GitService、E-02、SEC-03 plain object。
- 路线图中“B-12 logger 30”与文件实际 6 个用例不符。

### 3.6 文档过时

- `docs/phase-f-repair-2026-09-29.md` 第 3、63 行“尚未提交”。
- 路线图将 Phase F 质量门勾选为 `[x]`（约 1283–1288 行），而 §9 F-4 仍写“captureContent 复用 F-3 masking”，与实现不符。

---

## 4. 已确认属实的部分

- 首轮审计已关闭：F-A01、F-A03、F-A05、F-A06、F-A07、F-A08、F-A09、F-A10、F-A13、F-A16、F-A22、templates/list；F-A02 行为层面关闭。
- Phase A–E：SEC-01/02/03/05/07/08/09/12/13/17、附录 B 默认值、`legacyDefaults` 告警、D-5 统计、http3 拆分（koatty-serve 精简至 23 个文件 / 4692 行）、E-1 manifest 不输出配置值，均已验证。
- 没有提交构建产物（`dist/`、`tsbuildinfo`、`.turbo/`），文档与日志中没有密钥或配置值。
- 子模块已提交且主仓库指针已更新（尚未推送）。
- 回归测试命名与位置符合 `AGENTS.md` 约定。

---

## 5. 未实施的方案

以下方案仅有文档，代码侧尚未开始：

- `docs/koatty-bun-tc39-integrated-plan.md`（TC39 标准装饰器迁移，含 TypeScript 7 支持）
- `docs/koatty-bun-plan.md`（Bun 运行时适配）

---

## 6. 建议修复顺序

1. **预算锁死（P1-02）：** 首个 chunk 到达后再置 `started`；默认预留额设上限。
2. **审批容量 DoS（P1-03）：** 清除过期 / 已消费票据。
3. **`resume` 绑定（P1-04）：** 比对 fingerprint。
4. **masking 误伤（P1-05）：** 改为完整词匹配。
5. **MCP 参数（P1-01）：** 无 DTO 且有参数时返回 `InvalidParams`。
6. **审批双重超时（1.1 节）：** 只保留一层超时判定；F-05 断言改为检查具体错误码。
7. **环境判定（P1-06、P1-07）：** `/metrics` 默认不信任私网段；Swagger / TypeORM 改用 `resolveProfileName()`。
8. **LLM 缓存与 validation（P1-10、P1-12）：** DTO 纳入缓存键、校验失败时重新请求；运行时增加 class-transformer 转换。
9. **发布准备（P1-08、P1-09、P1-13）：**
   - 回退手工版本号；
   - 强制添加或取消忽略 5 个 changeset，MCP 变更级别改为 minor 或 major；
   - 提交 `koatty-ai` 嵌套子模块；
   - 按先子模块、后主仓库的顺序推送。
10. 每项行为变更按 `AGENTS.md` 补 `test/regression/` 用例、包 `CHANGELOG.md` 与 `docs/migration/*.md`，并同步更新修复报告与路线图的状态勾选。

---

## 7. 审查局限

- 2.2 节 4 个 P1 与第 3 节大部分 P2 来自分项审查，主审查人未逐条复跑。
- 未执行全仓库 `pnpm build` 与 `pnpm test`，仅执行了第 1 节所列的受影响包质量门。
- npm 版本核对基于 2026-09-29 的 `npm view` 结果。
