# Koatty 加固治理与 AI 演进实施方案

> 版本：v1.0  
> 日期：2026-09-27  
> 关联文档：[`koatty-bun-tc39-integrated-plan.md`](./koatty-bun-tc39-integrated-plan.md) v1.1 · [`koatty-bun-plan.md`](./koatty-bun-plan.md) · [`tc39-decorator-migration-plan.md`](./tc39-decorator-migration-plan.md)  
> 状态：草案（基于 2026-09-27 全仓库代码评审 + 关键问题逐条源码核实）

---

## 文档定位

本方案覆盖三条工作线：

1. **加固（Hardening）**：修复安全漏洞与"失败即放行"（fail-open）默认值；
2. **治理（Correctness & Architecture）**：修复功能性 Bug、测试漂移、性能热点，收敛过度工程；
3. **演进（AI Evolution）**：让 Koatty 成为"对 AI 友好的框架"，并提供 AI 运行时能力（MCP / Tool / LLM / GenAI 可观测性）。

**与既有方案的边界**：

| 事项 | 归属 |
|---|---|
| TC39 标准装饰器迁移、Bun 运行时适配、`RuntimeAdapter` | 由 `koatty-bun-tc39-integrated-plan.md` 负责，本方案**不重复** |
| 本方案对 TC39 的要求 | 仅约束：新增的装饰器（`@Tool`、`@Resource`、`@Prompt` 等）必须**原生双模式**；容器改造（请求作用域、生命周期钩子）需与其 Phase 1/3 协同，避免同一文件并行大改 |
| 时间协调 | 本方案 Phase A/B（加固）应**先于或并行于** TC39 方案 Phase 0/1 完成，原因见 §2 ADR-107 |

阅读顺序：§0 执行摘要 → §1 问题基线 → §3 路线图 → 按需阅读 §4–§9 的任务细节。

---

## 目录

- [0. 执行摘要](#0-执行摘要)
- [1. 问题基线](#1-问题基线)
- [2. 设计原则与架构决策（ADR）](#2-设计原则与架构决策adr)
- [3. 总体路线图](#3-总体路线图)
- [4. Phase A：基线修复（测试与 CI）](#4-phase-a基线修复测试与-ci)
- [5. Phase B：P0 安全与正确性](#5-phase-bp0-安全与正确性)
- [6. Phase C：P1 功能正确性](#6-phase-cp1-功能正确性)
- [7. Phase D：P2 架构治理与性能](#7-phase-dp2-架构治理与性能)
- [8. Phase E：AI-Ready 开发体验](#8-phase-eai-ready-开发体验)
- [9. Phase F：AI 运行时能力](#9-phase-fai-运行时能力)
- [10. 版本、破坏性变更与迁移指南](#10-版本破坏性变更与迁移指南)
- [11. 风险登记](#11-风险登记)
- [12. 验收标准与度量](#12-验收标准与度量)
- [13. 资源估算](#13-资源估算)
- [附录 A：问题清单与源码定位](#附录-a问题清单与源码定位)
- [附录 B：安全默认值对照表](#附录-b安全默认值对照表)

---

## 0. 执行摘要

**现状判断**：Koatty 的架构方向正确（IoC + AOP + 多协议共享 Koa 应用），功能覆盖面广，但存在一类系统性问题——**失败时放行（fail-open）与宽松默认值**，以及**测试与源码漂移**。这两点使其当前不适合直接承载高要求生产流量，更不适合承载 AI Agent 工具调用（在 Agent 场景下，一次校验绕过即可能产生真实副作用）。

**核心策略**：

1. **先加固，后演进**。AI 能力（尤其 `@Tool` 与护栏）直接依赖 AOP、校验、请求体解析的正确性；地基不修，AI 能力会放大风险。
2. **统一处理，而非逐条打补丁**。引入"安全默认值 + 环境画像（profile）"机制，把分散在各包的默认值收敛到一处。
3. **差异化定位**：不与 NestJS 在通用 Web 框架赛道正面竞争，而是定位为 **"用 TypeScript 构建 MCP / Agent 工具服务的多协议框架"**。

**里程碑**（总周期约 16 周，可与 TC39/Bun 方案交错）：

| 里程碑 | 周次 | 交付 |
|---|---|---|
| M1 基线可信 | W1 | 全部测试修绿，CI 真正覆盖所有子模块 |
| M2 安全默认 | W3 | P0 全部关闭，发布 `koatty@4.3.0`（含安全默认值，带兼容开关） |
| M3 功能正确 | W6 | P1 全部关闭（gRPC 流、RedLock、上传、调度） |
| M4 AI-Ready | W8 | `koatty manifest`、MCP 形态的 CLI、`AGENTS.md`/`llms.txt` |
| M5 架构治理 | W12 | 容器多实例 + 请求作用域 + 生命周期钩子，`koatty-serve` 瘦身 |
| M6 AI Runtime | W16 | `koatty_mcp`、`@Tool`、SSE、`koatty_llm`、GenAI 可观测性，发布 `koatty@5.0.0` |

---

## 1. 问题基线

评审方式：5 个只读子代理分领域通读 22 个包（约 6 万行 TypeScript），关键问题由人工逐条回到源码核实，并实际运行了部分测试。以下为**已核实**问题（✅）与**待验证**问题（⚠️）。编号在后文各任务中引用。

### 1.1 安全类（SEC）

| ID | 严重度 | 问题 | 核实 |
|---|---|---|---|
| SEC-01 | 高 | AOP `@Before`/`@After` 切面异常被捕获后仅记日志，业务方法继续执行（鉴权/审计切面失败即放行） | ✅ |
| SEC-02 | 高 | JSON/表单/XML/文本解析失败静默返回 `{}`，而非 400 | ✅ |
| SEC-03 | 高 | DTO 校验未开启 `whitelist`/`forbidNonWhitelisted`；非 convert 模式 `skipMissingProperties: true` | ✅ |
| SEC-04 | 高 | GraphQL 默认开启 GraphiQL（代码为 `playground !== false`，与类型注释"默认 false"矛盾）；`introspection` 未传入 handler；深度/复杂度限制需手动开启，且 `graphql-query-complexity` 未声明依赖、缺失时静默降级 | ✅ |
| SEC-05 | 高 | 上传无 `maxFiles`/`maxFields`/`maxFieldsSize`；`multiples: true` 时字段值为数组，`deleteFiles` 取 `.path` 失败，临时文件永不清理 | ✅ |
| SEC-06 | 高 | `/health`、`/healthz`、`/metrics` 及 Prometheus 9464 端口无鉴权 | ✅ |
| SEC-07 | 高 | 信任客户端 `X-Request-Id`（含 query 回退），无长度/字符集校验，拼接进日志字符串 | ✅ |
| SEC-08 | 高 | WebSocket 默认不校验 Origin、无 `maxPayload`、无背压；错误时回传 `error.message` | ✅ |
| SEC-09 | 高 | `escapeHtml` 把 `"` 转为非法实体 `&quote;`，且**不转义 `&`** | ✅ |
| SEC-10 | 高 | `koatty-ai` 的 `GitService` 构造时排队 `git clean -f`；`apply` 写文件不限制在项目根目录内；`QualityService` 用字符串拼接执行 shell | ✅ |
| SEC-11 | 中 | TypeORM 默认 `logging: true`，日志脱敏默认关闭，SQL 参数（含密码）入日志 | ✅ |
| SEC-12 | 中 | HTTPS 自动模式未设 `minVersion`/加密套件；HTTPS 连接池把 TLSv1.1 评为"部分安全"；证书更新需重启 | ✅ |
| SEC-13 | 中 | 请求体默认上限 `20mb`；`chmod` 默认 `777`；`rand` 用 `Math.random` | ✅ |
| SEC-14 | 中 | Swagger UI 无生产环境开关 | ✅ |
| SEC-15 | 中 | Trace 拓扑记录信任客户端 `service` 请求头 | ✅ |
| SEC-16 | 低 | `koatty-loader` 扫描路径不限制在 `baseDir` 内；日志绝对路径不受目录约束 | ✅ |
| SEC-17 | 低 | `isNumberString` 正则存在嵌套可选量词，可能 ReDoS | ⚠️ 需 PoC |

### 1.2 正确性类（COR）

| ID | 严重度 | 问题 | 核实 |
|---|---|---|---|
| COR-01 | 高 | 用户插件仅有 `run()` 时执行两次（自动绑定 `appReady` + `loadComponent` 阶段直接 `await`） | ✅ |
| COR-02 | 高 | `@Bootstrap` 为未等待的 Promise，启动失败只记 `Logger.Fatal`，不抛出、不退出 | ✅ |
| COR-03 | 高 | 停机时 `server.status` 从不设为 503，Trace 的停机拒绝逻辑是死代码；`app.stop()` 不触发 `appStop` | ✅ |
| COR-04 | 高 | gRPC `RegisterService` 一律按一元调用包装，服务端流/双向流会误报超时或双回调 | ✅（全文无 `requestStream`/`responseStream`） |
| COR-05 | 高 | `@RedLock` 旧版路径超时后**重新执行业务方法**；TC39 路径超时后在 `finally` 释放锁，原方法仍在运行 | ✅ |
| COR-06 | 高 | `@Scheduled` 无防重叠，长任务会堆积 | ✅ |
| COR-07 | 高 | 容器 `isAsync` 先立即创建实例，`appReady` 时再建第二个 | ✅ |
| COR-08 | 高 | 配置 Schema 校验：README 和测试声称支持，源码 `LoadConfigs` 无该参数（测试 7 例失败 3 例） | ✅ 已运行 |
| COR-09 | 中 | Redis 默认端口写成 `3306` | ✅ |
| COR-10 | 中 | Redis 连接池每次返回同一 `this.client`，池形同虚设；用于 MULTI/阻塞命令时互相干扰 | ✅ |
| COR-11 | 中 | `initMethod`/`destroyMethod` 声明但从未调用；单例 `Object.seal` 与延迟注入冲突 | ✅ |
| COR-12 | 中 | 协议中间件栈首次 `callback()` 时固化，后续 `use()` 不刷新 | ✅ |
| COR-13 | 中 | `@CacheAble` 无防击穿；长键 murmurHash 可能碰撞；非 JSON 值序列化不对称 | ✅ |
| COR-14 | 中 | WS 连接池 `destroy()` 不清理 ping/heartbeat 定时器 | ✅ |
| COR-15 | 中 | Trace 每请求重复采集指标、重复结束 Span | ✅ |
| COR-16 | 低 | `escapeHtml` 的逆函数同样使用错误实体 | ✅ |

### 1.3 架构/性能类（ARCH / PERF）

| ID | 问题 |
|---|---|
| ARCH-01 | IoC 容器为进程级全局单例（`globalThis[Symbol.for('koatty.ioc.v2')]`），无法多实例隔离 |
| ARCH-02 | 仅 `Singleton`/`Prototype` 作用域，无请求作用域；`@Autowired` 注入写在类原型上，Prototype 实例共享引用 |
| ARCH-03 | AOP 强制把同步方法包装成 `async` |
| ARCH-04 | 启动过程修改 `process.env.*` 并注册全局错误监听器且不移除 |
| ARCH-05 | `koatty-serve` 约 1.5 万行：约 4000 行入站"连接池"、约 2500 行实验性 HTTP/3 + QPACK |
| ARCH-06 | 缺 Guard / Interceptor / SSE / 内容协商 / API 版本 |
| PERF-01 | `Handler` 每请求新建数组、闭包并重新 `compose` |
| PERF-02 | 热路径 `Logger.Debug` 字符串拼接未做级别短路 |
| PERF-03 | 启动 `globby.sync` + 同步 `require` 全目录树 |
| PERF-04 | Trace 默认采样率 1.0，每 Span 一个 `setTimeout` |

### 1.4 工程质量类（QA）

| ID | 问题 |
|---|---|
| QA-01 | `koatty-config` 测试 3/7 失败；`koatty-core/test/performance.test.ts` 6/6 失败（引用已删除的 `ContextPool`） |
| QA-02 | CI 运行 `pnpm test` 却未拦截上述失败 → CI 未真实覆盖子模块（需排查 checkout 与 turbo 过滤） |
| QA-03 | `koatty-ai/src` 下 49 个编译产物 `.js` 被提交进 git |
| QA-04 | 子模块频繁处于 dirty 状态，发布依赖多个自定义脚本 |
| QA-05 | 根 README 引用不存在的 `examples/`；`koatty-graphql`、`koatty-testing` 无测试 |

---

## 2. 设计原则与架构决策（ADR）

编号接续既有方案（ADR-009 ~ ADR-016），从 ADR-101 开始以免冲突。

### ADR-101：失败即拒绝（Fail-Closed）是框架默认语义

**决策**：凡是"校验、鉴权、解析、切面"类环节，出错时默认**中断请求并返回明确错误**。放行必须是**显式、局部、可审计**的配置。

**适用范围**：AOP 切面（SEC-01）、请求体解析（SEC-02）、DTO 校验（SEC-03）、GraphQL 安全规则加载（SEC-04）。

**理由**：fail-open 的错误在测试中不可见，在生产中表现为"安全控制偶发失效"，是最难排查的一类缺陷；且在 AI Tool 场景下，错误输入会直接变成副作用。

### ADR-102：安全默认值集中在 `SecurityProfile`，按环境分级

**决策**：新增 `koatty_core` 导出的 `SecurityProfile`，所有包从中读取默认值，不再各自硬编码。

```ts
// packages/koatty-core/src/security/profile.ts（新增）
export type ProfileName = 'strict' | 'standard' | 'development';

export interface SecurityProfile {
  name: ProfileName;
  payload: {
    limit: string;              // 请求体上限
    maxFiles: number;
    maxFields: number;
    maxFieldsSize: string;
    onParseError: 'reject' | 'empty';
  };
  validation: {
    whitelist: boolean;
    forbidNonWhitelisted: boolean;
  };
  aop: { onAspectError: 'throw' | 'log' };
  graphql: {
    playground: boolean;
    introspection: boolean;
    depthLimit: number;
    complexityLimit: number;
  };
  ws: { maxPayload: number; checkOrigin: boolean };
  ops: { exposeMetrics: 'off' | 'internal' | 'public' };
  tls: { minVersion: 'TLSv1.2' | 'TLSv1.3' };
}

export function resolveProfile(env = process.env.NODE_ENV): SecurityProfile;
```

| 字段 | `strict`（生产默认） | `standard` | `development` |
|---|---|---|---|
| `payload.limit` | `1mb` | `5mb` | `20mb` |
| `payload.maxFiles` | 10 | 20 | 100 |
| `payload.onParseError` | `reject` | `reject` | `reject` |
| `validation.whitelist` | `true` | `true` | `true` |
| `validation.forbidNonWhitelisted` | `true` | `false` | `false` |
| `aop.onAspectError` | `throw` | `throw` | `throw` |
| `graphql.playground` | `false` | `false` | `true` |
| `graphql.introspection` | `false` | `true` | `true` |
| `graphql.depthLimit` / `complexityLimit` | 10 / 1000 | 15 / 2000 | 20 / 5000 |
| `ws.maxPayload` | 1 MiB | 4 MiB | 16 MiB |
| `ws.checkOrigin` | `true` | `true` | `false` |
| `ops.exposeMetrics` | `internal` | `internal` | `public` |
| `tls.minVersion` | `TLSv1.2` | `TLSv1.2` | `TLSv1.2` |

**选择规则**：`config.security.profile` 显式指定 > `NODE_ENV=production` 取 `strict` > `NODE_ENV=development|test` 取 `development` > 其余取 `standard`。**`NODE_ENV` 未设置时取 `standard` 而非 `development`**，避免"忘设环境变量 = 全开"。

**用户覆盖**：`config/security.ts` 中任意字段可覆盖；启动时打印一次最终生效的安全画像摘要（便于审计）。

### ADR-103：破坏性变更走"两段式"——先警告，后切换

**决策**：

- `4.3.x`：安全默认值生效，但提供 `security.legacyDefaults: true` 一键回退；回退时启动输出 `WARN` 并列出被回退的项。
- `5.0.0`：移除 `legacyDefaults`。

**例外**：SEC-09（`escapeHtml`）、COR-01（插件重复执行）、COR-05（RedLock 重跑）属于**明确缺陷**，直接修复，不提供回退开关。

### ADR-104：先写失败测试，再修代码（Red-Green）

**决策**：本方案每个 SEC/COR 条目，第一步是提交一个**能复现问题的失败测试**，PR 必须同时包含该测试从红变绿。测试放在各包 `test/security/` 或 `test/regression/` 下，文件名带问题 ID，如 `SEC-01.aop-fail-closed.test.ts`。

### ADR-105：`koatty-serve` 收敛到"Node 原语 + 薄封装"

**决策**：

- 入站连接"池"降级为**轻量连接跟踪器**（仅保留停机排空所需的活跃连接集合和计数），删除等待队列、安全评分、环形缓冲百分位等。
- HTTP/3 移出核心包，拆为可选包 `koatty_http3`，标注 experimental；`koatty-serve` 不再依赖 `@matrixai/quic`。
- 指标统一由 `koatty-trace` 负责，serve 不再维护第二套指标。

**目标**：`koatty-serve` 代码量从约 1.5 万行降到 5000 行以内，功能不回退（以既有测试 + 新增停机/流式测试为准）。

### ADR-106：AI 能力以可选组件交付，核心包零 AI 依赖

**决策**：`koatty` 与 `koatty_core` 不引入任何 LLM SDK。AI 运行时能力以独立包交付：

| 包 | 职责 |
|---|---|
| `koatty_mcp` | MCP Server 宿主：`@Tool`/`@Resource`/`@Prompt` 装饰器、Streamable HTTP 协议、工具鉴权与审批 |
| `koatty_llm` | 大模型调用抽象：多供应商、流式、重试/故障转移、token 预算 |
| `koatty_guard` | 护栏切面：提示注入检测、敏感信息脱敏、高危操作人工审批（基于 AOP，依赖 SEC-01 修复） |
| `koatty_cli`（现 `koatty-ai`） | 增加 `manifest` 命令与 MCP 模式 |

### ADR-107：加固先于 TC39 迁移的大规模改动

**理由**：TC39 方案 Phase 1 会大面积改写 `Component.ts`、`mapping.ts`、容器装饰器。若先迁移再加固，本方案的回归测试无从对比"迁移前行为"；若先加固，则回归测试成为 TC39 迁移的安全网。

**协同约定**：

- 本方案 Phase A（测试修绿）必须在 TC39 方案 Phase 0 结束前完成；
- 本方案 Phase D 中的容器改造（ARCH-01/02、COR-07/11）与 TC39 方案 Phase 3 "构造注入完整迁移"合并排期，由同一负责人主导；
- 所有新增回归测试须在 Legacy 与 TC39 两种模式下各跑一遍（复用 TC39 方案的测试矩阵）。

---

## 3. 总体路线图

```
Week      1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16
══════════════════════════════════════════════════════════════════════════
Phase A  ━━                                   ← 测试修绿 / CI 可信
Phase B  ━━━━━━━━━━                           ← P0 安全与正确性
Phase C          ━━━━━━━━━━━━                 ← P1 功能正确性
Phase E              ━━━━━━━━━━━━━━━━         ← AI-Ready DX（并行）
Phase D                      ━━━━━━━━━━━━━━━━━━━━━━  ← P2 架构治理（与 TC39 Phase 3 协同）
Phase F                                  ━━━━━━━━━━━━━━━━━━━━━  ← AI Runtime
发布        4.3.0(W3)      4.4.0(W6)    cli 5.0(W8)     4.5.0(W12)    5.0.0(W16)
```

**关键依赖**：

- Phase A → 所有后续阶段（没有可信测试，其他改动不可验证）
- SEC-01（AOP fail-closed）→ Phase F 的 `koatty_guard`
- SEC-02/03（解析与校验）→ Phase F 的 `@Tool` 参数校验
- SEC-10（CLI 写文件沙箱）→ Phase E 的 MCP 形态 CLI
- ARCH-06 中的 SSE → Phase F 的 MCP Streamable HTTP 与 LLM 流式
- ARCH-02（请求作用域）→ Phase F 的每次工具调用上下文隔离

---

## 4. Phase A：基线修复（测试与 CI）

**周期**：W1（5 人天）  
**目标**：让"测试通过"重新成为可信信号。

### A-1 修复已知红灯测试（QA-01）

| 文件 | 处理 |
|---|---|
| `packages/koatty-config/test/index.test.ts` 第 36–64、85 行附近 | 保留测试，作为 COR-08 的验收用例；本阶段先标记 `it.todo` 并注明 `COR-08`，Phase C 实现后恢复 |
| `packages/koatty-core/test/performance.test.ts` | `ContextPool` 已从源码删除：删除依赖它的用例；保留的性能断言迁移到 §12 的基准套件，不再以单测形式做耗时断言（单测里的耗时断言在 CI 机器上不稳定） |

### A-2 全量普查

```bash
pnpm -r --workspace-concurrency=1 exec -- npx jest --ci --silent 2>&1 | tee test-baseline.log
```

输出一张"包 × 通过/失败/跳过"表，写入 `docs/reports/test-baseline-2026-09.md`。每个失败用例必须归类为：真实 Bug（建 COR 条目）/ 测试过期（修测试）/ 环境依赖（加 `describe.skipIf` 并注明依赖）。

### A-3 让 CI 真正覆盖子模块（QA-02）

排查项：

1. `actions/checkout` 是否配置 `submodules: recursive`；
2. `turbo run test` 是否因缓存命中而跳过（`turbo.json` 的 `test.inputs` 未声明时，默认会读取包内所有文件，但子模块未 checkout 时包目录为空，turbo 会视为"无任务"并成功退出）；
3. 各包 `package.json` 是否都有 `test` 脚本（缺失时 turbo 会跳过）。

改动：

```yaml
# .github/workflows/ci.yml（片段）
- uses: actions/checkout@v4
  with:
    submodules: recursive
    fetch-depth: 0
- run: pnpm install --frozen-lockfile
- run: node scripts/doctor.js --assert-submodules   # 新增：子模块为空或缺 test 脚本即失败
- run: pnpm turbo run test --force                   # 主干上禁用缓存，保证真实执行
```

`scripts/doctor.js` 新增 `--assert-submodules`：遍历 `.gitmodules`，任一路径下缺 `package.json` 或 `scripts.test` 即 `process.exit(1)`。

### A-4 仓库卫生（QA-03、QA-05）

- `packages/koatty-ai/.gitignore` 增加 `src/**/*.js`、`src/**/*.d.ts`、`src/**/*.map`，并 `git rm --cached` 已提交的产物；
- 根 README 中 `examples/` 引用改为 `packages/koatty/examples/`；删除"配置校验"等未实现能力的描述（Phase C 实现后再补回）。

### Phase A 验收门

- [ ] 所有包 `jest --ci` 全绿（允许显式 `skip`，但每个 skip 必须带 issue 链接）
- [ ] 人为在任一子模块制造一个失败测试，CI 必须变红（**负向验证**，必须实际做一次）
- [ ] `koatty-ai/src` 下不再有被跟踪的 `.js`

---

## 5. Phase B：P0 安全与正确性

**周期**：W1–W3（约 18 人天）  
**发布**：`4.3.0`（全部受影响包 minor 升级）

每个任务的结构：**问题 → 方案 → 兼容性 → 测试 → 验收**。

### B-0 `SecurityProfile` 基础设施（ADR-102）

- 新增 `packages/koatty-core/src/security/profile.ts`、`index.ts` 导出；
- `Application` 初始化时解析 profile 并挂到 `app.security`（只读，`Object.freeze`）；
- 启动日志输出：`[Security] profile=strict payload.limit=1mb graphql.playground=off ...`；
- 工作量：2 人天。

### B-1 AOP 切面失败即拒绝（SEC-01）

**问题**：`koatty-container/src/processor/aop_processor.ts` 中 `executeBefore`（约第 321 行）与 `executeAfter`（约第 350 行）的 `catch` 只记日志；`executeAfter` 调用 `aspect.run(originalArgs, undefined, options)`，After 切面拿不到返回值。

**方案**：

```ts
// aop_processor.ts（修改示意）
type AspectErrorPolicy = 'throw' | 'log';

function resolveErrorPolicy(data: AspectMeta, container?: IContainer): AspectErrorPolicy {
  return data.options?.onError
    ?? container?.getApp?.()?.security?.aop.onAspectError
    ?? 'throw';
}

async function executeBefore(/* ... */) {
  for (const data of aspectData) {
    try {
      // ... 原逻辑
    } catch (error) {
      if (resolveErrorPolicy(data, container) === 'throw') throw error;
      logger.Error(`Before aspect execution failed for ${data.aopName}:`, error);
    }
  }
  return args;
}
```

After 切面传入返回值：由于 `IAspect.run` 签名是 `(args, proceed?, options?)`，不改签名，而是把结果放入 `options`：

```ts
await aspect.run(originalArgs || [], undefined, { ...enhancedOptions, result });
```

并在 `icontainer.ts` 的 JSDoc 中说明 `options.result` 仅在 After/AfterEach 中可用。

**装饰器层**：`@Before(aopName, { onError?: 'throw' | 'log' })`、`@After(...)` 同理，允许单个切面显式声明"可失败"（如纯日志切面）。

**兼容性**：行为变更（原来吞掉的异常现在会抛出）。`legacyDefaults: true` 时回到 `'log'`。

**测试**（`packages/koatty-container/test/regression/SEC-01.aop-fail-closed.test.ts`）：

1. Before 切面抛错 → 业务方法**未被调用**，异常向上传播；
2. `onError: 'log'` 的切面抛错 → 业务方法被调用；
3. After 切面在 `options.result` 中拿到返回值；
4. Legacy 与 TC39 两种装饰器模式各跑一遍。

**工作量**：2 人天。

### B-2 请求体解析失败返回 400（SEC-02）

**问题**：`packages/koatty-router/src/payload/parser/{json,form,xml,text}.ts` 的 `catch` 返回 `{}`；`payload.ts` 第 174–178 行同样吞错。

**方案**：解析失败时抛出携带状态码的异常，由全局异常处理器转换为 400。`Exception` 构造函数签名为 `(message, code?, status?)`：

```ts
// parser/json.ts（修改示意）
import { Exception } from 'koatty_exception';

} catch (error) {
  if (opts.onParseError === 'empty') {
    Logger.Warn('JSON parse failed, fallback to empty object', error);
    return {};
  }
  throw new Exception('Invalid JSON body', 1, 400);
}
```

同时区分两类错误：

| 错误 | 状态码 |
|---|---|
| 语法错误 | 400 |
| 超过 `limit`（`raw-body` 抛 `entity.too.large`） | 413 |
| 不支持的 `Content-Encoding` | 415 |

**注意**：错误消息不得包含请求体片段（避免反射型日志注入与敏感数据回显）。

**测试**：畸形 JSON → 400；超限 → 413；`onParseError: 'empty'` → `{}`；错误响应体不含原始请求内容。

**工作量**：1.5 人天。

### B-3 DTO 校验白名单（SEC-03）

**问题**：`packages/koatty-validation/src/rule.ts` 第 80–84 行调用 `validate(obj)` 未传白名单选项；`decorators.ts` 第 217–219 行 `Object.assign(new paramType(), arg)` 会复制任意多余字段。

**方案**：

```ts
// rule.ts（修改示意）
const base = {
  whitelist: profile.validation.whitelist,
  forbidNonWhitelisted: profile.validation.forbidNonWhitelisted,
  forbidUnknownValues: true,
};
errors = convert
  ? await validate(obj, base)
  : await validate(obj, { ...base, skipMissingProperties: true });
```

`decorators.ts` 中的 `Object.assign` 改为走同一 `plainToClass` 路径，并使用 `excludeExtraneousValues` 语义（仅保留带校验装饰器或 `@Expose` 的字段）。

**关于 `skipMissingProperties`**：保留该选项，但在文档中明确"非 convert 模式不校验缺失字段"的语义；新增 `@Validated({ partial: false })` 让用户显式要求全量校验。

**兼容性**：`whitelist: true` 会剥离 DTO 未声明的字段——这是**有意的**行为变更，写入迁移指南。

**测试**：多余字段被剥离；strict 画像下多余字段 → 400；`__proto__`/`constructor` 键不进入 DTO 实例。

**工作量**：2 人天。

### B-4 GraphQL 安全默认值（SEC-04）

**问题**：`packages/koatty-router/src/router/graphql.ts` 第 149 行 `playground !== false` 默认开启；`introspection` 从未传入；安全规则依赖可选包，缺失时 `catch` 静默降级。

**方案**：

1. 默认值从 `app.security.graphql` 读取，判断改为 `this.options.ext?.playground ?? profile.graphql.playground`；
2. `introspection === false` 时加入 `NoSchemaIntrospectionCustomRule`（`graphql` 包自带，无需额外依赖）；
3. 深度限制改为**内置实现**（约 60 行，遍历 AST 计算选择集深度，含 fragment 展开与循环检测），移除对 `graphql-depth-limit` 的运行时 `require`；
4. 复杂度限制：把 `graphql-query-complexity` 声明为 `peerDependencies` + `peerDependenciesMeta.optional`；配置了 `complexityLimit` 但包缺失时**启动失败**（fail-closed），而非静默跳过；
5. GraphiQL 页面不再从 unpkg 加载脚本：要么内嵌资源，要么在 HTML 中加 SRI 哈希；
6. 修正 `types.ts` 中与实际行为矛盾的注释。

**测试**：strict 画像下 GET 无 query → 404；introspection 查询 → 错误；深度 11 的查询 → 错误；配置复杂度限制但缺包 → 启动失败。

**工作量**：2.5 人天。

### B-5 上传限制与临时文件清理（SEC-05）

**问题**：`packages/koatty-router/src/payload/parser/multipart.ts` 第 40–45 行只设置了 `maxFileSize`；`packages/koatty-router/src/utils/path.ts` 第 38–49 行 `deleteFiles` 不处理数组。

**方案**：

```ts
// multipart.ts（修改示意）
const form = new IncomingForm({
  encoding: opts.encoding,
  multiples: opts.multiples,
  keepExtensions: false,                        // 默认不保留攻击者可控的扩展名
  maxFileSize: bytes.parse(opts.fileLimit ?? opts.limit),
  maxFiles: opts.maxFiles ?? profile.payload.maxFiles,
  maxFields: opts.maxFields ?? profile.payload.maxFields,
  maxFieldsSize: bytes.parse(opts.maxFieldsSize ?? profile.payload.maxFieldsSize),
  uploadDir: opts.uploadDir,                     // 默认 os.tmpdir()/koatty-upload-<pid>
  filter: opts.fileFilter,                       // 允许用户按 mimetype/扩展名过滤
});
```

```ts
// utils/path.ts（修改示意）
type FormFile = { filepath?: string; path?: string };
export async function deleteFiles(files: Record<string, FormFile | FormFile[]>) {
  const list = Object.values(files).flatMap(v => (Array.isArray(v) ? v : [v]));
  await Promise.all(list.map(async f => {
    const p = f?.filepath ?? f?.path;
    if (!p) return;
    await fsPromise.unlink(p).catch(err => {
      if (err.code !== 'ENOENT') logger.Error(err);
    });
  }));
}
```

其他要求：

- 用 `bytes` 包统一解析大小字符串，替换 `parseInt('20mb')` 这种写法；
- 清理时机挂在 `on-finished(ctx.res)` 上，保证异常路径也会清理；
- 文档明确：`originalFilename` 不可信，保存文件时必须用 `path.basename` 并重新生成文件名；框架提供 `safeFilename(file)` 工具函数。

**测试**：`multiples` 数组形态被正确清理；超过 `maxFiles` → 413；请求中途抛错时临时文件仍被删除；`keepExtensions` 默认关闭。

**工作量**：2 人天。

### B-6 运维端点鉴权（SEC-06）

**问题**：`packages/koatty-serve/src/server/serve.ts` 第 412–430 行 `/health`、`/metrics` 对外开放；`packages/koatty-serve/src/middleware/healthCheck.ts` 默认启用；`packages/koatty-trace/src/opentelemetry/prometheus.ts` 在 9464 端口起独立服务。

**方案**：

| 端点 | strict 默认行为 |
|---|---|
| `/health`、`/healthz`（存活探针） | 开放，**只返回** `{"status":"ok"}`，不含内存、CPU、连接数等细节 |
| `/ready`（就绪探针） | 开放；停机期间返回 503（与 C-1 联动） |
| `/metrics` | `exposeMetrics: 'internal'`：只允许 `config.ops.allowCidrs`（默认回环地址 + RFC1918 私网）访问，或要求 `Authorization: Bearer <config.ops.token>` |
| Prometheus 9464 | 默认绑定 `127.0.0.1` 而非 `0.0.0.0` |
| 详细健康信息 | 需 token |

判断来源 IP 时**只用 `socket.remoteAddress`**；仅当 `app.proxy === true` 且配置了 `trustedProxies` 时才解析 `X-Forwarded-For`。

同时把已存在但未接入的限流中间件 `packages/koatty-serve/src/middleware/rateLimit.ts` 接入 HTTP/HTTPS/HTTP2 处理链（默认仍关闭，但保证开启后真正生效，并补集成测试）。

**工作量**：2 人天。

### B-7 请求 ID 校验与结构化日志（SEC-07、SEC-15）

**问题**：`packages/koatty-trace/src/utils/utils.ts` 第 36–40 行直接信任请求头与 query；`handler/http.ts` 第 74 行用模板字符串拼 JSON。

**方案**：

```ts
// utils.ts（修改示意）
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function acceptRequestId(v: unknown): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && REQUEST_ID_RE.test(s) ? s : undefined;
}
```

- 默认**不再**从 query 读取请求 ID（`requestIdFromQuery: false`）；
- 不合法的外部 ID 被丢弃并生成新 ID，原值不入日志；
- 访问日志改为结构化对象交给 logger 序列化，禁止手工拼接 JSON 字符串：

```ts
Logger.Info({ action: ctx.method, status: ctx.status, requestId: ctx.requestId,
              path: ctx.originalPath || '/', duration });
```

- 拓扑记录中的 `service` 请求头同样经过白名单正则，并只在 `topology.trustServiceHeader: true` 时采用。

**工作量**：1 人天。

### B-8 WebSocket 默认加固（SEC-08、COR-14）

**问题**：`packages/koatty-serve/src/server/ws.ts` 第 125–129 行升级时不校验；第 277–280 行回传 `error.message`；`pools/ws.ts` 的心跳定时器在 `destroy()` 时未清理。

**方案**：

- `wsOptions` 默认值：`maxPayload = profile.ws.maxPayload`，`perMessageDeflate: false`（避免压缩炸弹与 CPU 放大）；
- 升级前校验：`checkOrigin` 为真时，`Origin` 必须在 `config.ws.allowedOrigins` 中（支持通配子域），否则直接写回 `HTTP/1.1 403` 并销毁 socket；
- 升级阶段接入限流与最大连接数检查，超限返回 503；
- 错误回传改为 `{ error: 'Internal server error', requestId }`，不含 `message`；
- 发送前检查 `ws.bufferedAmount`，超过 `maxBufferedAmount` 时暂停读取或断开慢消费者；
- `pools/ws.ts` 的 `destroy()` 中 `clearInterval(this.pingInterval)`、`clearInterval(this.heartbeatInterval)`，并给定时器加 `.unref()`。

**工作量**：2 人天。

### B-9 `koatty-lib` 安全修复（SEC-09、SEC-13、COR-16）

```ts
// lib.ts（修改示意）
const htmlMaps: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
export function escapeHtml(value: string): string {
  return `${value}`.replace(/[&<>"']/g, c => htmlMaps[c]);
}
// 逆函数必须最后处理 &amp;，否则 "&amp;lt;" 会被错误地还原成 "<"
```

- `chmod(p, mode = '755')`；
- `rand` 改用 `crypto.randomInt(min, max + 1)`；原 `Math.random` 版本保留为 `randFast` 并标注"非安全用途"；
- `md5`/`md5Salt` 的 JSDoc 标注"不可用于口令或签名"；
- SEC-17：为 `isNumberString` 编写 ReDoS 基准（长度 1 万～10 万的构造输入，耗时须呈线性）；若确认存在问题，改为非回溯写法或先限制输入长度。

**测试**：`escapeHtml('&lt;')` → `&amp;lt;`；`escapeHtml('"')` → `&quot;`；往返一致性；属性上下文注入用例。

**工作量**：1 人天。

### B-10 CLI 沙箱（SEC-10）

**问题**：`packages/koatty-ai/src/utils/GitService.ts` 第 10 行；`cli/commands/apply.ts` 第 89–96 行；`utils/QualityService.ts` 第 27–40 行。

**方案**：

```ts
// GitService.ts
constructor(private workingDir = process.cwd()) {
  this.git = simpleGit(workingDir);           // 移除 .clean(CleanOptions.FORCE)
}
```

```ts
// 新增 utils/sandbox.ts
export function resolveInside(root: string, p: string): string {
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${p}`);
  }
  return abs;
}
```

- `apply` 所有写入都经过 `resolveInside(projectRoot, change.path)`；另外还要处理符号链接逃逸：对已存在路径先 `fs.realpath` 再做一次检查；
- `QualityService` 改为 `execFileSync('npx', ['prettier', '--write', filePath])`，不经过 shell；
- `TemplateManager` 中的 `git clone` 同样改为参数数组形式；
- `apply` 默认 `--dry-run` 预览变更，需要 `--yes` 才真正写入。这一点在 Phase E 的 MCP 模式下尤其关键。

**工作量**：1.5 人天。

### B-11 明确缺陷直接修复（COR-01、COR-02、COR-09）

**COR-01 插件 `run()` 执行两次**（`packages/koatty-core/src/ComponentManager.ts` 第 344–356 行）：

删除 `loadComponent` 阶段对 `run()` 的直接调用，统一由 `registerComponentEvents` 绑定到 `appReady`。如果某些插件确实需要"在 loadComponent 阶段立即执行"，应显式标注 `@OnEvent(AppEvent.loadComponent)`。回归测试：只有 `run()` 的插件，计数器最终为 1。

**COR-02 启动失败不退出**（`packages/koatty/src/core/Bootstrap.ts` 第 114–129 行）：

```ts
} catch (err) {
  Logger.Fatal(err);                   // koatty_logger 的 Fatal 会 flush 后 exit(1)
  if (checkUTRuntime() || isInitiative) throw err;   // 测试和主动调用时让调用方拿到错误
  process.exitCode = 1;
}
```

同时导出 `createApplication()` 作为推荐入口，文档说明 `@Bootstrap()` 适用于"一个进程一个应用"的场景。

**COR-09 Redis 默认端口**：`packages/koatty-store/src/store/redis.ts` 第 53 行 `3306` → `6379`。

**工作量**：1.5 人天。

### B-12 默认值收紧（SEC-11、SEC-12、SEC-14）

- `koatty-typeorm`：`logging` 默认值改为 `NODE_ENV === 'production' ? ['error'] : true`；`logQuery` 输出参数前经过 `ShieldLog`；
- `koatty-logger`：内置默认敏感字段 `password, passwd, secret, token, accessToken, refreshToken, authorization, cookie, apiKey, api_key`，用户可追加或清空；
- `koatty-serve` HTTPS 自动模式：`minVersion: profile.tls.minVersion`；删除连接池对 TLSv1.1 的"部分安全"评分；
- `koatty-swagger`：新增 `enabled` 选项，默认 `NODE_ENV !== 'production'`；生产环境开启时输出 `WARN`。

**工作量**：1.5 人天。

### Phase B 验收门

- [ ] 附录 A 中 SEC-01～SEC-15、COR-01/02/09 均有对应回归测试，且全部通过
- [ ] `koatty new` 生成的空项目在 `NODE_ENV=production` 下，运行附录 B 的检查脚本全部通过
- [ ] `security.legacyDefaults: true` 能恢复旧行为，并在启动时打印回退清单
- [ ] 迁移指南（§10）已随 `4.3.0` 发布

---

## 6. Phase C：P1 功能正确性

**周期**：W3–W6（约 17 人天）  
**发布**：`4.4.0`

### C-1 优雅停机闭环（COR-03）

**目标语义**（与 Kubernetes 的配合方式）：

```
SIGTERM
  → status = 503（/ready 返回 503，负载均衡摘流）
  → 等待 preStopDelay（默认 5s，给负载均衡传播时间）
  → 停止接收新连接（server.close()）
  → 已有 keep-alive 连接：下一个请求返回 503 + Connection: close
  → 等待在途请求完成（drainTimeout，默认 25s）
  → 强制关闭剩余连接
  → emit appStop（资源清理：数据库、Redis、日志 flush）
  → exit(0)
总时长须 < terminationGracePeriodSeconds（默认 30s）
```

**改动**：

- `packages/koatty-serve/src/server/serve.ts`：新增 `beginDrain()`，设置 `this.status = 503`；`Stop()` 先调用 `beginDrain()`；
- `packages/koatty-serve/src/utils/terminus-manager.ts`：`shutdownAll` 依次执行 `beginDrain → preStopDelay → Stop → appStop`，不再只触发 `appStop`；
- `packages/koatty-core/src/Application.ts`：`stop()` 改为返回 Promise，完成后 `emit('appStop')`；移除把 `appStop` 转绑到 `beforeExit` 的 `bindProcessEvent` 用法（`beforeExit` 在收到信号退出时不会触发）；
- 删除 `SpanManager` 自行注册的 SIGTERM/SIGINT 监听（`spanManager.ts` 第 83–84 行），统一由 `TerminusManager` 协调；
- 修正 `test/terminus.test.ts` 第 97–101 行的空测试。

**测试**：真实起 HTTP 服务 → 发 SIGTERM → 断言 `/ready` 返回 503、在途慢请求完成、新连接被拒、`appStop` 监听器被调用恰好一次。

**工作量**：3 人天。

### C-2 gRPC 流式调用（COR-04）

**问题**：`packages/koatty-serve/src/server/grpc.ts` 第 581–719 行统一包装成 `(call, callback)`。

**方案**：根据 `@grpc/proto-loader` 生成的方法定义中的 `requestStream`/`responseStream` 字段分派四种包装器：

| 类型 | `requestStream` | `responseStream` | 包装签名 | 超时处理 |
|---|---|---|---|---|
| 一元 | false | false | `(call, callback)` | 读取 `call.getDeadline()`，无 deadline 时用配置默认值 |
| 客户端流 | true | false | `(call, callback)` | 同上 |
| 服务端流 | false | true | `(call)` | 不设回调超时；监听 `cancelled` 事件后停止写出 |
| 双向流 | true | true | `(call)` | 同上 |

- `RegisterService` 需要拿到 `impl.service`（`ServiceDefinition`）中每个方法的定义，目前代码只遍历 `impl.implementation`，需改为遍历 `impl.service` 的键；
- 把 gRPC deadline 传入 `koatty-trace` 的 `GrpcHandler`，作为请求超时，替代框架层固定超时；
- 连接跟踪 ID 改用 `crypto.randomUUID()`，替换 `Date.now() + Math.random()`。

**测试**：四种调用类型的端到端测试（proto 文件放在 `test/fixtures/stream.proto`）；客户端取消后服务端停止写出；deadline 超过后返回 `DEADLINE_EXCEEDED`。

**工作量**：4 人天。

### C-3 RedLock 正确性（COR-05）

**问题**：`packages/koatty-schedule/src/process/locker.ts` 第 94–124 行超时后 `continue` 会**重新执行**业务方法；`packages/koatty-schedule/src/decorator/redlock.ts` 第 83–96 行超时后在 `finally` 中释放锁，而原方法仍在运行。

**核心认知**：`Promise.race` 无法取消正在运行的 Promise。正确模型是**后台自动续期**，而不是"超时后重跑"。

**方案**：统一两条路径，采用 `@sesamecare-oss/redlock` 提供的 `using` 自动续期 API：

```ts
// 修改示意
return redlock.using([resolvedLockName], lockTime, { automaticExtensionThreshold: 500 },
  async (signal) => {
    const ctrl = { signal };                          // 将 AbortSignal 暴露给业务方法
    const result = await originalMethod.apply(this, [...props, ctrl]);
    if (signal.aborted) throw signal.error;           // 续期失败：锁已丢失，结果不可信
    return result;
  });
```

- 锁名只用 `resolvedLockName` 一个资源（当前 `[methodName, name]` 两个键的写法容易被误解，且会加倍 Redis 操作）；
- 新增 `maxHoldTime`（默认 `lockTime × 10`）：超过后中止续期并记录 `ERROR`，**不重跑**；
- 通过 `AbortSignal` 让业务方法可以感知锁丢失（需要在文档中说明：做写操作前检查 `signal.aborted`；需要严格正确性的场景应使用 fencing token）；
- 删除未导出且已损坏的旧 `Locker` 类（它调用的 `cacheStore.getCompare` 在 `CacheStore` 门面上并不存在）。

**测试**：业务耗时为 `lockTime` 的 3 倍时只执行一次，且期间另一实例拿不到锁；模拟续期失败时 `signal.aborted` 为真；并发 10 实例只有 1 个执行。

**工作量**：3 人天。

### C-4 `@Scheduled` 防重叠（COR-06）

```ts
@Scheduled('*/10 * * * * *', { overlap: 'skip' })   // 'skip'（默认）| 'queue' | 'allow'
```

- 进程内用 `running` 标志实现 `skip`；`queue` 最多排队 1 次；
- `skip` 模式可直接使用 `cron` 包的 `waitForCompletion` 选项（当前依赖 `cron@4.4.0` 已支持）；`queue` 模式仍需自行实现；
- 需要跨实例互斥时文档推荐组合 `@RedLock`；
- 停机时停止所有 CronJob，并等待正在运行的任务结束（受 `drainTimeout` 约束）。

**工作量**：1.5 人天。

### C-5 容器 `isAsync` 与生命周期钩子（COR-07、COR-11）

**`isAsync`**（`packages/koatty-container/src/container/container.ts` 第 309–318 行）：

```ts
if (options.isAsync) {
  this.app.once('appReady', () => this._setInstance(target, options));
  return;                                         // 关键：不再立即创建第二个实例
}
this._setInstance(target, options);
```

**生命周期钩子**：

- `LifecycleManager.setInstance` 完成构造和注入后，调用 `@PostConstruct` 标注的方法或 `options.initMethod`（支持 async，由容器 `await`）；
- `Container.clear()` 与 `appStop` 时按**注册的逆序**调用 `@PreDestroy` 方法或 `options.destroyMethod`；
- `Object.seal` 移到所有延迟注入完成之后（`appReady` 之后）再执行，或者改为只在开发模式下 seal 以便尽早发现问题。

**与 TC39 方案协同**：`@PostConstruct`/`@PreDestroy` 是方法装饰器，按双模式实现。

**工作量**：3 人天。

### C-6 配置 Schema 校验落地（COR-08）

- 恢复 Phase A 中标记为 `todo` 的测试；
- `LoadConfigs(loadPath, baseDir?, pattern?, ignore?, schema?)` 接入已存在的 `validator.ts`，并从 `index.ts` 导出；
- Schema 格式支持 JSON Schema（校验引擎用 `ajv`，作为 optional peer 依赖）以及轻量的内置规则格式；
- 校验失败时启动失败，并逐条列出字段路径与原因；
- `parseEnv` 支持内嵌插值 `"redis://${REDIS_HOST}:${REDIS_PORT}"` 和默认值 `${VAR:-default}`；变量未定义且无默认值时，strict 画像下报错，而不是替换为空字符串。

**工作量**：2 人天。

### C-7 其他正确性修复

| ID | 改动 | 人天 |
|---|---|---|
| COR-10 | Redis：去掉 generic-pool，直接使用单个 ioredis 客户端（它本身支持多路复用）；MULTI 和阻塞命令通过 `client.duplicate()` 获得独立连接 | 1 |
| COR-12 | `Application.use()` 同时清空 `middlewareStacks`；如果在 `appReady` 之后调用 `use()`，输出 `WARN` | 0.5 |
| COR-13 | `@CacheAble`：进程内 single-flight 防击穿（同一个键只有一个在途的回源 Promise）；长键哈希改为 `sha1` 并保留键前缀；统一用带类型标记的封装做序列化 | 2 |
| COR-15 | Trace：指标采集和 Span 结束只在 `handleRequest` 的 `finally` 中进行一次，删除各协议 handler 中的重复调用；加断言测试"每个请求计数恰好 +1" | 1 |

### Phase C 验收门

- [ ] COR-03～COR-15 回归测试全部通过
- [ ] 停机集成测试在 Linux CI 中连续跑 20 次无偶发失败
- [ ] gRPC 四种调用类型端到端测试通过

---

## 7. Phase D：P2 架构治理与性能

**周期**：W6–W12（约 30 人天，其中容器部分与 TC39 方案 Phase 3 合并排期）  
**发布**：`4.5.0`

### D-1 容器多实例（ARCH-01、ARCH-04）

**目标**：允许 `new Container()` 创建相互隔离的实例；全局 `IOC` 保留，作为"默认容器"，保证向后兼容。

**方案**：

1. `Container` 的构造函数改为公开；`getInstance()` 只返回默认容器；
2. `MetadataCache.getShared()` 改为每个容器持有自己的缓存实例；
3. 装饰器元数据仍然写在类上（这部分是全局的，不可避免），但**实例表、注册表**按容器隔离；
4. `Application` 持有自己的 `container` 引用；框架内部代码逐步把 `IOC.get(...)` 替换为 `app.container.get(...)`；
5. 启动过程不再写 `process.env.ROOT_PATH` 等变量，改为写入 `app.paths`；为兼容旧代码仍然写入 env，但标记 deprecated，并在 `5.0` 移除；
6. `captureError` 中注册的进程级监听器，在 `app.stop()` 时移除。

**验收**：同一进程中启动两个应用、各自监听不同端口，二者的单例互不相同；测试用例之间无需手动清理容器。

**工作量**：6 人天。

### D-2 请求作用域与实例级注入（ARCH-02）

**方案**：

- 新增 `Scope = 'Singleton' | 'Prototype' | 'Request'`；
- `Request` 作用域的实例缓存在 `ctx` 上（`WeakMap<KoattyContext, Map<Class, Instance>>`），请求结束后随 `ctx` 一起被回收；
- 解析 `Request` 作用域 Bean 时，从 `AsyncLocalStorage` 中取当前 `ctx`（`koatty-core` 已经有 ALS）；
- **作用域规则校验**：`Singleton` 不能直接依赖 `Request` 作用域的 Bean（这属于作用域扩大，会造成跨请求的数据串用），启动期检测到时报错，并提示改用 `@Autowired({ lazy: true })` 获取代理；
- `@Autowired` 注入从"写到类原型上"改为"实例构造后写到实例上"；`Singleton` 的行为不变，`Prototype`/`Request` 从此真正做到每个实例独立。

**性能约束**：`Request` 作用域在每个请求中的解析开销 < 2µs（通过基准测试验证）；只有使用了 `Request` 作用域的请求才付出这部分成本。

**工作量**：6 人天（与 TC39 方案的"构造注入完整迁移"合并）。

### D-3 AOP 保持同步语义（ARCH-03）

**方案**：在注册期（而不是调用期）判断：若原方法与所有相关切面都是同步函数，则生成同步包装器；否则生成 async 包装器。切面元数据在注册期就已确定，不需要在每次调用时判断。

```ts
const needsAsync = isAsyncFn(originalMethod) || aspects.some(a => isAsyncFn(a.run))
                   || hasDefault__before__after(target);
descriptor.value = needsAsync ? makeAsyncWrapper(...) : makeSyncWrapper(...);
```

说明：`IAspect.run` 的类型签名返回 `Promise`，因此"同步切面"需要新增一个 `runSync?` 可选方法；只要有任何切面没有提供 `runSync`，就走 async 包装。这样对现有用户完全兼容。

同时把 `getAOPMethodMetadata` 从每次调用时查询改为注册期查一次并存入闭包（它当前在包装函数内部每次调用都执行）。

**工作量**：3 人天。

### D-4 Router 热路径（PERF-01、PERF-02）

**问题**：`packages/koatty-router/src/utils/handler.ts` 第 47–80 行每个请求都新建数组、闭包，并重新 `compose`。

**方案**：在路由注册时一次性生成最终处理函数：

```ts
// 注册期
const invoke = async (ctx: KoattyContext) => {
  const ctl = resolveController(app, ctx, ctlClass);     // Singleton 情况下直接闭包引用实例
  const args = ctlParams ? await extractParameters(app, ctx, ctlParams) : [];
  const res = await ctl[method](...args);
  if (Helper.isError(res)) throw res;
  if (ctx.body === undefined) ctx.body = res;            // 原来的 `ctx.body || res` 会把 0/''/false 当成"未设置"
};
const handler = composedMiddleware
  ? (ctx: KoattyContext) => composedMiddleware(ctx, () => invoke(ctx))
  : invoke;
```

- 热路径上的 `Logger.Debug` 改为 `if (Logger.isDebugEnabled) Logger.Debug(...)`；`koatty-logger` 需新增 `isDebugEnabled` getter；
- 注意 `ctx.body === undefined` 的判断是一个**行为变更**：原逻辑下返回 `0`、`''`、`false` 时 body 会被覆盖；需要在迁移指南中说明。

**目标**：简单 GET 路由的 RPS 提升 ≥ 10%（以 §12 的基准为准）。

**工作量**：2 人天。

### D-5 `koatty-serve` 瘦身（ARCH-05）

| 步骤 | 内容 | 人天 |
|---|---|---|
| 1 | 补齐行为测试：启动、停止、停机排空、超时配置、TLS、WS、gRPC。**这是删除代码的前提** | 3 |
| 2 | 连接池替换为 `ConnectionTracker`（`Set<Socket>` + 计数 + `closeIdle()`），Node 18.2+ 可直接使用 `server.closeIdleConnections()` | 3 |
| 3 | HTTP/3 拆分为 `koatty_http3`（experimental），核心包移除 `@matrixai/quic` 依赖；原生适配器中的模拟监听代码删除 | 2 |
| 4 | 删除 serve 自身的指标采集，统一由 trace 负责；删除只打日志的 30 秒周期"清理"定时器 | 1 |
| 5 | HTTPS 证书热更新：监听证书文件变化，调用 `server.setSecureContext()`，不再需要重启 | 1 |

**验收**：步骤 1 的测试在瘦身前后全部通过；`koatty-serve` 源码 < 5000 行；包的依赖数量减少。

### D-6 缺失的 Web 能力（ARCH-06）

按照对 Phase F 的依赖程度排序：

| 能力 | 设计要点 | 人天 |
|---|---|---|
| **SSE / 流式响应**（Phase F 前置） | `@SSE()` 方法装饰器，方法返回 `AsyncIterable<T>`，框架负责 `text/event-stream` 编码、心跳、客户端断开时通过 `AbortSignal` 通知业务方法；同时支持返回 `ReadableStream` 和 Node `Readable` | 3 |
| Guard | `@UseGuard(AuthGuard)`：`canActivate(ctx): boolean \| Promise<boolean>`，返回 false 时 403；执行在参数解析之前 | 2 |
| Interceptor | 本质上是可复用的 Around 切面，基于 D-3 的实现，提供 `@UseInterceptor` 语法糖 | 1 |
| 内容协商 | 异常输出按 `Accept` 头返回 JSON 或纯文本；gRPC、WS 维持现有逻辑 | 1 |

### D-7 启动性能（PERF-03）

- 扫描结果缓存：以 `文件路径 + mtime` 为键，缓存在 `.koatty/scan-cache.json`；生产环境可使用 `koatty build` 预生成组件清单（与 Phase E 的 manifest 共用同一数据结构），启动时跳过 glob 扫描；
- 目标：200 个组件文件的项目，冷启动时间降低 ≥ 30%。

**工作量**：2 人天。

### Phase D 验收门

- [ ] 双应用同进程隔离测试通过
- [ ] Request 作用域基准 < 2µs/次
- [ ] Router 基准 RPS 提升 ≥ 10%，p99 不回退
- [ ] `koatty-serve` < 5000 行，所有行为测试通过
- [ ] 以上所有改动在 Legacy 与 TC39 两种模式下均通过测试

---

## 8. Phase E：AI-Ready 开发体验

**周期**：W4–W8（约 15 人天，可以与 Phase C/D 并行，由另一名开发者负责）  
**发布**：`koatty_cli@5.0.0`

这个阶段的目标是：**让 AI 编码助手在 Koatty 项目中犯更少的错误**。成本低、见效快。

### E-1 应用清单 `koatty manifest`

**原理**：框架在启动后已经掌握了应用的全部结构元数据，只是没有导出。manifest 把这些元数据导出为一份机器可读的 JSON，是 AI 理解项目最便宜的入口。

**命令**：

```bash
koatty manifest [--out .koatty/manifest.json] [--format json|md]
```

**实现**：以 `createApplication()` 方式启动应用，但不监听端口，也不执行 `appReady` 之后的副作用（新增 `bootstrapApplication(..., { dryRun: true })`，跳过 `loadServe` 与用户组件的 `run()`），然后从 IoC 容器与路由元数据中收集信息。

**输出结构**：

```jsonc
{
  "koatty": "4.5.0",
  "decoratorMode": "legacy",
  "protocols": ["http", "grpc"],
  "components": [
    { "id": "UserService", "type": "SERVICE", "scope": "Singleton",
      "file": "src/service/UserService.ts", "dependsOn": ["UserRepository", "CacheStore"] }
  ],
  "routes": [
    { "protocol": "http", "method": "POST", "path": "/users",
      "controller": "UserController", "handler": "create",
      "middleware": ["AuthMiddleware"], "guards": [],
      "params": [{ "source": "body", "dto": "CreateUserDto" }],
      "file": "src/controller/UserController.ts", "line": 42 }
  ],
  "dtos": { "CreateUserDto": { /* 由 class-validator 元数据生成的 JSON Schema */ } },
  "aspects": [{ "name": "AuditAspect", "targets": ["UserService.create"] }],
  "config": { "keys": ["server.port", "redis.host"], "schema": { /* C-6 */ } },
  "security": { "profile": "strict" /* 最终生效的安全画像 */ }
}
```

- DTO → JSON Schema：基于 `class-validator` 的元数据存储转换（可以评估使用 `class-validator-jsonschema`，或自行实现一个约 300 行的转换器）。这一能力同时服务于 Swagger、MCP `@Tool` 和 LLM 结构化输出，**一次实现，三处复用**；
- 配置只输出键名与 schema，**绝不输出配置值**（其中可能有密钥）。

**工作量**：5 人天。

### E-2 MCP 形态的 CLI（`koatty mcp`）

**前提**：B-10 的沙箱已完成。

```bash
koatty mcp            # stdio 传输，供 Cursor / Claude Code 等 IDE 接入
```

**暴露的工具**：

| 工具 | 类型 | 说明 |
|---|---|---|
| `koatty_manifest` | 只读 | 返回 E-1 的清单 |
| `koatty_routes` | 只读 | 按路径或控制器过滤路由 |
| `koatty_explain_component` | 只读 | 某个组件的依赖图、切面、所在文件 |
| `koatty_plan` | 只读 | 输入 spec，返回变更集预览（不写盘） |
| `koatty_apply` | **写** | 应用变更集；限制在项目根目录内；变更集需带 `plan` 阶段返回的哈希，防止被篡改 |
| `koatty_test` | 执行 | 运行指定测试文件；只允许运行 `test/` 目录下的文件，带超时 |
| `koatty_docs` | 只读 | 按主题检索框架文档片段 |

**安全约束**：

- 写类工具默认要求在 IDE 中人工确认（利用 MCP 客户端的确认机制）；
- 所有路径参数经过 `resolveInside`；
- 不提供任意 shell 执行工具。

依赖：`@modelcontextprotocol/sdk`，仅由 `koatty_cli` 依赖。

**工作量**：5 人天。

### E-3 面向 AI 的项目文档

`koatty new` 生成的模板中新增：

| 文件 | 内容 |
|---|---|
| `AGENTS.md` | 项目约定：目录结构、装饰器用法、如何新增路由/服务、测试命令、**禁止事项**（例如不要直接修改 `IOC` 全局对象、不要在 Controller 中写业务逻辑） |
| `.cursor/rules/koatty.mdc` | 同上内容的 Cursor 规则版本，按 `src/controller/**` 等路径匹配 |
| `llms.txt`（框架文档站） | 框架 API 精简索引，遵循 llms.txt 约定 |

同时在框架仓库根目录为本 monorepo 自身编写 `AGENTS.md`：构建顺序、子模块工作流、测试命令、发布流程。

**工作量**：2 人天。

### E-4 测试即规格

AI 修改代码时，可运行的测试是最可靠的反馈。模板项目默认包含：

- `koatty_testing` 补齐自身测试（QA-05），并提供 `createTestApp()` + `request()` 的最小示例；
- 每个生成器生成的 Controller/Service 同时生成对应的测试文件骨架。

**工作量**：3 人天。

### Phase E 验收门

- [ ] 在示例项目上执行 `koatty manifest`，输出能通过 JSON Schema 校验，且不包含任何配置值
- [ ] 在 Cursor 中接入 `koatty mcp`，完成"新增一个带 DTO 校验的 POST 接口并通过测试"的端到端任务
- [ ] 构造一个试图写入 `../outside.txt` 的恶意变更集，`koatty_apply` 必须拒绝

---

## 9. Phase F：AI 运行时能力

**周期**：W10–W16（约 35 人天）  
**发布**：`koatty@5.0.0` + `koatty_mcp@1.0.0` + `koatty_llm@1.0.0` + `koatty_guard@1.0.0`

**前置条件**（必须全部满足才能开始）：SEC-01、SEC-02、SEC-03 已关闭；D-2 请求作用域可用；D-6 SSE 可用。

### F-1 `koatty_mcp`：MCP Server 宿主

**定位**：把 Koatty 应用中的 Service 方法，以声明式的方式暴露为 MCP 工具、资源与提示词，复用 Koatty 已有的 IoC、校验、AOP、多协议与可观测性能力。**这是 Koatty 相对其他框架最有差异化的能力。**

**装饰器**（全部原生支持双模式）：

```ts
@McpServer({ name: 'order-service', version: '1.0.0' })
@Service()
export class OrderTools {
  @Autowired() private orders: OrderService;

  @Tool({
    name: 'order_query',
    description: '按订单号查询订单状态',
    annotations: { readOnlyHint: true },
  })
  async query(@Payload(QueryOrderDto) input: QueryOrderDto, ctx: ToolContext) {
    return this.orders.findByNo(input.orderNo, ctx.principal);
  }

  @Tool({
    name: 'order_refund',
    description: '对订单发起退款',
    annotations: { destructiveHint: true },
    requireApproval: true,                       // 需要人工审批（见 F-3）
    scopes: ['order:refund'],                    // 调用方必须具备的权限
  })
  async refund(@Payload(RefundDto) input: RefundDto, ctx: ToolContext) { /* ... */ }

  @Resource({ uri: 'order://{orderNo}', mimeType: 'application/json' })
  async orderResource(params: { orderNo: string }) { /* ... */ }

  @Prompt({ name: 'refund_policy', description: '退款政策说明模板' })
  refundPrompt() { /* ... */ }
}
```

**关键设计**：

1. **Schema 自动生成**：`@Payload(Dto)` 通过 E-1 的 DTO → JSON Schema 转换器生成工具的 `inputSchema`；调用时复用 `koatty_validation` 的白名单校验（B-3）。**工具参数与 HTTP 请求体走同一套校验逻辑**；
2. **传输协议**：新增 `mcp` 协议，实现 MCP Streamable HTTP 传输（`POST` 接收 JSON-RPC 请求，按需通过 SSE 流式返回），挂在 `koatty-serve` 的 HTTP 服务上的指定路径（默认 `/mcp`），也支持 stdio 模式用于本地调试；
3. **会话与上下文**：每次工具调用创建一个请求作用域（D-2）；`ToolContext` 包含 `principal`、`sessionId`、`requestId`、`signal`（取消信号）、`progress()`（进度通知）；
4. **鉴权**：遵循 MCP 规范的 OAuth 2.1 授权模型（资源服务器角色，校验 Bearer token 的受众与作用域）；同时提供简单的 API Key 模式供内部服务使用。`scopes` 在工具调用前由 Guard（D-6）校验；
5. **协议安全**：校验 `Origin` 头防止 DNS rebinding；本地模式默认只绑定 `127.0.0.1`；
6. **SDK 策略**：底层使用官方 `@modelcontextprotocol/sdk` 处理协议细节，Koatty 只负责装饰器、IoC 集成与传输适配，避免自行实现并维护协议状态机。

**工作量**：12 人天。

### F-2 `koatty_llm`：大模型调用抽象

```ts
@Service()
export class SupportAgent {
  @Autowired() private llm: LlmClient;

  async answer(question: string, signal: AbortSignal) {
    return this.llm.stream({
      model: 'default',                           // 在配置中映射到具体供应商与模型
      messages: [{ role: 'user', content: question }],
      tools: ['order_query'],                     // 直接引用本应用中注册的 @Tool
      signal,
    });                                           // 返回 AsyncIterable，可以直接交给 @SSE 输出
  }
}
```

**能力清单**：

| 能力 | 说明 |
|---|---|
| 供应商抽象 | 统一接口；首批适配 OpenAI 兼容协议（可覆盖大多数国内外厂商与本地 vLLM/Ollama）+ Anthropic；每个适配器是一个可选依赖 |
| 模型路由 | 配置中声明逻辑模型名到具体模型的映射，支持按优先级故障转移 |
| 可靠性 | 超时、指数退避重试（仅对 429/5xx）、熔断 |
| 预算 | 按用户/租户/请求设置 token 上限，超出时中止；与 `koatty-store` 结合实现分布式计数 |
| 结构化输出 | 输入 DTO 类，自动生成 JSON Schema，并用 `koatty_validation` 校验模型输出；校验失败时可按配置重试 |
| 工具调用循环 | 可选的工具调用执行器：模型请求调用工具 → 在本进程内通过 IoC 调用对应 `@Tool` 方法 → 结果回传模型，设置最大轮数上限 |
| 缓存 | 基于 `koatty-cacheable` 的精确匹配缓存；语义缓存作为可选扩展（需要向量存储），不放在第一版 |

**明确不做**：Agent 编排 DSL、多 Agent 框架。这些领域变化太快，框架应该只提供可靠的底层能力，编排留给用户选择专门的库。

**工作量**：10 人天。

### F-3 `koatty_guard`：AI 护栏

基于 AOP 实现（依赖 SEC-01 已修复）：

| 切面 | 作用 |
|---|---|
| `@RedactPII()` | 在工具输入/输出、LLM 请求/响应上脱敏手机号、身份证号、邮箱、银行卡号等；规则可配置 |
| `@PromptShield()` | 对进入 LLM 的**外部内容**（用户输入、检索结果、工具返回值）做提示注入特征检测；命中时按策略拒绝、标记或降权。**注意：基于规则的检测只能拦截已知模式，不能作为唯一防线**，核心防线是 F-1 中的权限作用域与人工审批 |
| `@RequireApproval()` | 高危工具调用挂起，生成审批单（存储于 `koatty-store`），通过 MCP 的 elicitation 机制或外部回调通知审批人；超时后自动拒绝 |
| `@ToolRateLimit()` | 按调用方 + 工具维度限流 |
| `@AuditLog()` | 结构化记录调用方、工具名、参数摘要（脱敏后）、结果状态、耗时，便于事后追溯 |

**默认策略**：带有 `destructiveHint: true` 的工具，若未显式声明 `requireApproval: false`，在 strict 画像下默认需要审批。

**工作量**：6 人天。

### F-4 GenAI 可观测性（扩展 `koatty-trace`）

- 遵循 OpenTelemetry GenAI 语义约定（`gen_ai.*` 属性）：记录供应商、模型、输入/输出 token 数、耗时、结束原因；
- 工具调用 Span：`gen_ai.tool.name` 等属性，与 HTTP/MCP 请求 Span 形成完整调用链；
- 指标：每个模型的 token 消耗与成本（按配置的单价计算）、工具调用成功率、审批通过率；
- **默认不记录提示词与模型输出的原文**（隐私与合规要求），需要通过 `trace.genai.captureContent: true` 显式开启，开启后经过 `@RedactPII` 规则处理；
- 注意：OTel 的 GenAI 语义约定目前仍处于 development 状态，属性名可能变化；实现时把属性名集中在一个常量文件中，便于后续跟进。

**工作量**：4 人天。

### F-5 参考应用

`packages/koatty/examples/mcp-order-service`：包含 2 个只读工具、1 个需要审批的写工具、1 个资源，接入 LLM 的 SSE 问答接口，配套完整测试与部署说明（Docker + Kubernetes 探针配置）。它同时作为 F-1～F-4 的集成测试。

**工作量**：3 人天。

### Phase F 验收门

- [ ] 使用 MCP Inspector 与至少两个主流 MCP 客户端完成工具发现与调用
- [ ] 工具参数中的多余字段被剥离，非法参数返回 JSON-RPC 错误（而不是抛出未处理异常）
- [ ] 没有所需 scope 的调用方调用写工具 → 被拒绝；高危工具未经审批 → 不执行
- [ ] 客户端断开 SSE 连接后，LLM 流式请求在 1 秒内被取消（通过 mock 供应商验证）
- [ ] Trace 中可以看到"MCP 请求 → 工具调用 → LLM 调用"的完整链路，且默认不含提示词原文

---

## 10. 版本、破坏性变更与迁移指南

### 10.1 版本规划

| 版本 | 时间 | 内容 | 是否破坏性 |
|---|---|---|---|
| `4.3.0` | W3 | Phase B：安全默认值（提供 `legacyDefaults` 回退） | 行为变更，可回退 |
| `4.4.0` | W6 | Phase C：功能正确性 | 否（缺陷修复） |
| `koatty_cli@5.0.0` | W8 | manifest、MCP 模式，`apply` 默认 dry-run | CLI 行为变更 |
| `4.5.0` | W12 | Phase D：多容器、请求作用域、serve 瘦身、SSE | 否（新增能力；HTTP/3 移到独立包是依赖变更，需说明） |
| `5.0.0` | W16 | 移除 `legacyDefaults` 与 `process.env` 路径变量；与 TC39 方案的发布合并；AI 组件 1.0 | 是 |

### 10.2 `4.3.0` 行为变更清单（写入 CHANGELOG 与迁移指南）

| 变更 | 影响 | 迁移方式 |
|---|---|---|
| 请求体解析失败返回 400/413 | 原来依赖"畸形请求体得到 `{}`"的代码 | 修正客户端；或者 `payload.onParseError: 'empty'` |
| DTO 白名单 | DTO 中未声明的字段被剥离 | 在 DTO 上声明字段；或者 `validation.whitelist: false` |
| AOP 切面异常会向上抛出 | 原来"切面出错但业务继续"的行为不再成立 | 对确实可以失败的切面加 `{ onError: 'log' }` |
| 请求体上限 1mb（生产） | 大请求体被拒绝，返回 413 | `payload.limit` |
| GraphQL 生产环境关闭 playground 与 introspection | 生产环境无法使用 GraphiQL | `graphql.ext.playground: true`（不推荐） |
| `/metrics` 仅限内网访问 | 外部 Prometheus 抓取会失败 | 配置 `ops.allowCidrs` 或 `ops.token` |
| WS 默认校验 Origin | 跨域 WS 客户端被拒绝 | 配置 `ws.allowedOrigins` |
| 请求 ID 格式校验、不再从 query 读取 | 不合法的外部 ID 被替换 | 客户端遵循 `[A-Za-z0-9._:-]{1,128}` |
| TypeORM 生产环境只记录错误日志 | 生产环境看不到 SQL 日志 | 显式设置 `logging` |
| Swagger 生产环境默认关闭 | 生产环境看不到文档 | `swagger.enabled: true` |

### 10.3 迁移辅助

- 新增 `koatty doctor --security`：扫描项目配置与代码，列出受上述变更影响的位置（例如 DTO 中未声明但在代码里读取的字段、没有配置 `allowedOrigins` 的 WS 服务等）；
- 所有回退开关在启动时汇总输出一次 `WARN`，方便运维发现遗留配置。

---

## 11. 风险登记

| ID | 风险 | 可能性 | 影响 | 缓解措施 |
|---|---|---|---|---|
| R-01 | 安全默认值导致用户升级后接口异常 | 高 | 中 | 两段式发布（ADR-103）；`doctor --security`；迁移指南逐项列出 |
| R-02 | 与 TC39 迁移在同一批文件上冲突 | 高 | 中 | ADR-107 规定顺序；容器改造由同一负责人主导；两种模式的测试矩阵 |
| R-03 | `koatty-serve` 瘦身引入回归 | 中 | 高 | D-5 第 1 步先补行为测试；瘦身分多个小 PR；保留旧实现一个小版本并通过开关切换 |
| R-04 | 子模块工作流导致改动难以原子提交 | 高 | 中 | 每个 Phase 结束时统一更新子模块引用；中长期评估把子模块合并回 monorepo（本方案不强制） |
| R-05 | MCP 规范仍在快速演进 | 中 | 中 | 协议细节交给官方 SDK；Koatty 只负责装饰器与集成层；锁定规范版本并在 CI 中跑协议一致性测试 |
| R-06 | OTel GenAI 语义约定变化 | 中 | 低 | 属性名集中在常量文件；跟随上游版本更新 |
| R-07 | 提示注入检测给出虚假的安全感 | 中 | 高 | 文档明确说明其局限；核心防线放在权限作用域 + 人工审批 + 最小权限的工具设计 |
| R-08 | 人力不足导致 AI 阶段挤压加固阶段 | 中 | 高 | Phase F 设置硬性前置条件（§9 开头）；加固阶段的验收门不允许跳过 |
| R-09 | Request 作用域带来性能退化 | 低 | 中 | 只有使用了该作用域才付出成本；基准测试门槛 < 2µs |

---

## 12. 验收标准与度量

### 12.1 质量门（每次 PR 必须满足）

- 全部测试通过；新代码行覆盖率 ≥ 80%；
- 每个 SEC/COR 条目有独立的回归测试文件（ADR-104）；
- 涉及装饰器的改动在 Legacy 与 TC39 两种模式下均通过测试。

### 12.2 安全基线（附录 B 的自动化检查）

新增 `scripts/security-baseline.ts`：以 `NODE_ENV=production` 启动示例应用，逐项探测：

| 检查 | 期望结果 |
|---|---|
| 畸形 JSON 请求体 | 400 |
| 2MB 请求体 | 413 |
| DTO 多余字段 | 被剥离或返回 400 |
| `GET /graphql`（无 query） | 非 200 |
| introspection 查询 | 返回错误 |
| 外网来源访问 `/metrics` | 403 |
| 非白名单 Origin 发起 WS 升级 | 403 |
| 超长或含特殊字符的 `X-Request-Id` | 被替换 |
| TLSv1.1 握手 | 失败 |
| 上传 11 个文件 | 413，且临时目录中无残留文件 |

该脚本在 CI 中每次都运行。

### 12.3 性能基准

新增 `benchmarks/` 目录（使用 `autocannon`，固定硬件环境或以同机前后对比的相对值为准）：

| 场景 | 指标 | 目标 |
|---|---|---|
| 简单 GET 路由（无 DTO） | RPS、p99 | RPS 相比 4.2.0 提升 ≥ 10%，p99 不回退 |
| POST + DTO 校验 | RPS、p99 | 开启白名单后回退 ≤ 5% |
| 开启 Trace（采样率 0.1） | 相对未开启的开销 | ≤ 15% |
| Request 作用域 Bean 解析 | 单次耗时 | < 2µs |
| 200 个组件的冷启动 | 启动时间 | 降低 ≥ 30%（使用预生成清单） |
| MCP 工具调用（空实现） | p99 | < 5ms（本机） |

### 12.4 结果度量（用于判断定位是否成功，发布后 3 个月观察）

- 生产用户反馈的安全类 issue 数量；
- 使用 `koatty mcp` 的项目比例（通过 CLI 可选的匿名统计，默认关闭）；
- `koatty_mcp` 的下载量与示例仓库的使用情况。

---

## 13. 资源估算

| Phase | 人天 | 建议人员 | 可否并行 |
|---|---|---|---|
| A 基线修复 | 5 | 1 人 | 必须最先完成 |
| B P0 安全 | 18 | 2 人 | 与 A 末段重叠 |
| C P1 正确性 | 17 | 2 人 | — |
| D P2 架构 | 30 | 2 人（其中 1 人同时负责 TC39 容器部分） | 与 C 末段、E 并行 |
| E AI-Ready DX | 15 | 1 人 | 与 C/D 并行 |
| F AI Runtime | 35 | 2 人 | 需满足前置条件 |
| 发布、文档、迁移指南 | 8 | 1 人 | 贯穿全程 |
| **合计** | **约 128 人天** | 2–3 人 | 约 16 周 |

若人力只有 1 人：先完成 A + B + C（约 40 人天，8 周），发布 `4.4.0`；E 可以只做 E-1 与 E-3；F 推迟到下一个周期。**不建议**为了赶 AI 功能而跳过 B 与 C。

---

## 附录 A：问题清单与源码定位

> 行号基于 2026-09-27 的代码，实施时以实际代码为准。

| ID | 文件 | 位置 | 对应任务 |
|---|---|---|---|
| SEC-01 | `packages/koatty-container/src/processor/aop_processor.ts` | 约 310–355 行（`executeBefore`/`executeAfter`） | B-1 |
| SEC-02 | `packages/koatty-router/src/payload/parser/json.ts` | 33–36 行；form/xml/text 解析器同理；`payload.ts` 174–178 行 | B-2 |
| SEC-03 | `packages/koatty-validation/src/rule.ts` | 80–84 行；`decorators.ts` 217–219 行 | B-3 |
| SEC-04 | `packages/koatty-router/src/router/graphql.ts` | 86–127 行、149 行；`types.ts` 69–78 行 | B-4 |
| SEC-05 | `packages/koatty-router/src/payload/parser/multipart.ts` | 40–45 行；`utils/path.ts` 38–49 行；`payload_cache.ts` 27、70–73 行 | B-5 |
| SEC-06 | `packages/koatty-serve/src/server/serve.ts` | 412–430 行；`middleware/healthCheck.ts`；`koatty-trace/src/opentelemetry/prometheus.ts` | B-6 |
| SEC-07 | `packages/koatty-trace/src/utils/utils.ts` | 36–40 行；`handler/http.ts` 74 行 | B-7 |
| SEC-08 | `packages/koatty-serve/src/server/ws.ts` | 125–129、277–280 行 | B-8 |
| SEC-09 | `packages/koatty-lib/src/lib.ts` | 139–162 行 | B-9 |
| SEC-10 | `packages/koatty-ai/src/utils/GitService.ts` | 10 行；`cli/commands/apply.ts` 89–96 行；`utils/QualityService.ts` 27–40 行 | B-10 |
| SEC-11 | `packages/koatty-typeorm/src/index.ts` | 54 行；`logger.ts` 37–40 行 | B-12 |
| SEC-12 | `packages/koatty-serve/src/server/https.ts` | 125–165 行；`pools/https.ts` 213–218 行 | B-12 |
| SEC-13 | `packages/koatty-router/src/payload/payload_cache.ts` | 27 行；`koatty-lib/src/lib.ts` 239、398 行 | B-9 / B-0 |
| SEC-14 | `packages/koatty-swagger/src/index.ts` | 34–41 行 | B-12 |
| SEC-15 | `packages/koatty-trace/src/trace/trace.ts` | 335–340 行 | B-7 |
| SEC-16 | `packages/koatty-loader/src/index.ts` | 78–82 行；`koatty-logger/src/logger.ts` 417–432 行 | D-1 附带处理 |
| SEC-17 | `packages/koatty-lib/src/lib.ts` | 59–61 行 | B-9 |
| COR-01 | `packages/koatty-core/src/ComponentManager.ts` | 278–290、344–356 行 | B-11 |
| COR-02 | `packages/koatty/src/core/Bootstrap.ts` | 114–129 行；`core/Decorator.ts` 29–36 行 | B-11 |
| COR-03 | `packages/koatty-serve/src/server/serve.ts` | 208–229 行；`utils/terminus-manager.ts` 117–161 行；`koatty-core/src/Application.ts` 417–420、530–554 行 | C-1 |
| COR-04 | `packages/koatty-serve/src/server/grpc.ts` | 581–719 行 | C-2 |
| COR-05 | `packages/koatty-schedule/src/process/locker.ts` | 94–130 行；`decorator/redlock.ts` 64–100 行 | C-3 |
| COR-06 | `packages/koatty-schedule/src/process/schedule.ts` | 78–92 行 | C-4 |
| COR-07 | `packages/koatty-container/src/container/container.ts` | 309–318 行 | C-5 |
| COR-08 | `packages/koatty-config/src/config.ts` | 83–103 行；`validator.ts`；`index.ts` | C-6 |
| COR-09 | `packages/koatty-store/src/store/redis.ts` | 53 行 | B-11 |
| COR-10 | `packages/koatty-store/src/store/redis.ts` | 104–107、194–230 行 | C-7 |
| COR-11 | `packages/koatty-container/src/container/lifecycle_manager.ts` | 24–31 行 | C-5 |
| COR-12 | `packages/koatty-core/src/Application.ts` | 199–206、565–579 行 | C-7 |
| COR-13 | `packages/koatty-cacheable/src/cache.ts` | 91–119 行；`utils.ts` 73–86 行 | C-7 |
| COR-14 | `packages/koatty-serve/src/pools/ws.ts` | 279–291、424–427 行 | B-8 |
| COR-15 | `packages/koatty-trace/src/trace/trace.ts` | 417–456 行；`handler/base.ts` | C-7 |
| ARCH-01 | `packages/koatty-container/src/container/container.ts` | 88–93、940–956 行；`utils/cache.ts` 500–514 行 | D-1 |
| ARCH-02 | `packages/koatty-container/src/processor/autowired_processor.ts` | 209–216 行 | D-2 |
| ARCH-03 | `packages/koatty-container/src/processor/aop_processor.ts` | 394–458 行 | D-3 |
| PERF-01 | `packages/koatty-router/src/utils/handler.ts` | 47–80 行 | D-4 |
| QA-01 | `packages/koatty-config/test/index.test.ts`；`packages/koatty-core/test/performance.test.ts` | — | A-1 |
| QA-03 | `packages/koatty-ai/src/**/*.js` | 49 个被跟踪的文件 | A-4 |

---

## 附录 B：安全默认值对照表

| 项目 | 当前默认值 | 4.3.0 strict 默认值 | 所在包 |
|---|---|---|---|
| 请求体上限 | 20mb | 1mb | router |
| 解析失败 | 返回 `{}` | 400 / 413 | router |
| 上传文件数上限 | 无限制 | 10 | router |
| 上传保留扩展名 | 是 | 否 | router |
| DTO 白名单 | 关 | 开，且禁止多余字段 | validation |
| AOP 切面异常 | 记录日志后继续 | 抛出 | container |
| GraphiQL | 开 | 关 | router |
| GraphQL introspection | 开（配置项未生效） | 关 | router |
| GraphQL 深度 / 复杂度 | 未启用 | 10 / 1000 | router |
| `/metrics` | 公开 | 仅内网或需 token | serve |
| Prometheus 端口绑定地址 | `0.0.0.0` | `127.0.0.1` | trace |
| 健康检查详情 | 可配置为公开 | 需 token | serve |
| WS `maxPayload` | 未设置（使用 `ws` 库默认 100 MiB） | 1 MiB | serve |
| WS Origin 校验 | 否 | 是 | serve |
| WS 错误消息回传 | 回传 `error.message` | 只回传 requestId | serve |
| TLS 最低版本 | Node 默认 | TLSv1.2 | serve |
| 外部请求 ID | 无条件信任，含 query 回退 | 格式校验，禁用 query 回退 | trace |
| TypeORM 日志 | 全部 SQL 与参数 | 仅错误 | typeorm |
| 日志敏感字段 | 空 | 内置常见字段 | logger |
| Swagger | 挂载即开放 | 生产环境关闭 | swagger |
| `chmod` 默认权限 | 777 | 755 | lib |
| Redis 默认端口 | 3306 | 6379 | store |
| `@Scheduled` 重叠执行 | 允许 | 跳过 | schedule |
| CLI `apply` | 直接写入 | 默认 dry-run，写入限制在项目根目录内 | cli |
