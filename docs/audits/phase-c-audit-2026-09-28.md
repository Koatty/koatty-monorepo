# Phase C 独立审计（2026-09-28）

**结论：Phase C 不通过。** 当前代码存在 16 项可操作问题（9 项 P1、7 项 P2），不能用“全量测试通过”认定 C-1～C-7 已完成。尤其 C-5 的容器生命周期、COR-10 的 Redis 连接隔离和 COR-13 的缓存改造仍保留原实现。

审计依据：`docs/koatty-hardening-and-ai-evolution-plan.md` §6、ADR-102/104/107、§12.1，以及相关运行链路。开始时主仓 HEAD 为 `cb7807f`，工作树干净，子模块引用匹配。审计期间出现其他任务的 router 性能改动及 loader 改动，均予保留，未纳入本次变更；测试结果是执行时快照，不是对其后新增改动的认证。本次只新增审计报告、复现脚本和证据，没有修复生产源码、提交、推送或发布。

## 验证结果

| 验证 | 实际结果 |
|---|---|
| 全量 `pnpm turbo run test --force --continue --concurrency=2` | exit 0；46/46 构建/测试任务成功，0 缓存命中；3018 passed、48 skipped、0 failed |
| 全量 lint | exit 0；24/24 任务成功，仍有 warning |
| doctor 子模块检查 | exit 0 |
| 既有 COR-03 停机集成测试 | 本机连续 20/20 通过；Jest 仍提示 open handles / force exit |
| 新增真实 HTTP 探测 | 正常业务 200、异常业务 500；两次 reporter 调用；drain 后 `/ready` 503，但业务请求超时 |
| 新增真实 grpc-js 客户端 | 一元正常、客户端流正常；合法长 deadline 被 Trace 提前中止；服务端流产生假超时；双向流产生非法 callback 调用；五次 reporter 均未执行 |
| 独立组件探测 | 复现双实例化、钩子未调用、stop 重复、任务排空提前返回、maxHoldTime 未发出 abort、配置验证缺口、Redis 客户端复用和缓存类型改变 |

环境：macOS、Node v22.23.1、pnpm 9.15.4。没有远端 Linux/Node 20 CI、真实 Redis 多实例锁竞争、独立 npm tarball 消费或部署环境验收。48 个既有 skip 不计为已验证；koatty_graphql、koatty_testing 仍没有测试。

[执行汇总](./phase-c-audit-2026-09-28/verification.txt)、[组件输出](./phase-c-audit-2026-09-28/components.log)、[真实协议输出](./phase-c-audit-2026-09-28/network.log)。从仓库根复跑：

```bash
node docs/audits/phase-c-audit-2026-09-28/probe-components.cjs
node docs/audits/phase-c-audit-2026-09-28/probe-network.cjs
```

这些是输出实际行为的**审计探测**，不是测试通过门禁；exit 0 不表示产品正确。组件探测只替换明确标注的外部适配器：RedLock backend、缓存存储、Redis ready-client；容器、装饰器、调度状态机和配置加载使用真实源码。协议探测使用真实 Koatty、Trace、HttpServer/GrpcServer、grpc-js 客户端及 [stream.proto](./phase-c-audit-2026-09-28/stream.proto)，叶子 middleware 代替业务控制器；没有宣称覆盖完整 Router/IOC 控制器注册。错误诊断包装器只打印原异常并调用原处理器，不改变返回语义。

## P1 问题

### C-AUD-01 · isAsync 仍实例化两次（C-5 / COR-07）

位置：`packages/koatty-container/src/container/container.ts:310–318`。

`isAsync` 分支注册 appReady 回调后没有 return，紧接着执行 `_setInstance`。实测构造次数在 ready 前为 1、ready 后为 2。第一次实例的连接、定时器等副作用可能泄漏，已注入引用也可能指向被替换的旧实例。

修复：定义明确的 deferred/ready 状态，确保创建一次，并处理 ready 前 get 的行为；补真实 appReady 前后身份与构造次数断言，不能仅看普通容器测试总数。

### C-AUD-02 · 初始化/销毁钩子完全未执行，仍提前 seal（C-5 / COR-11）

位置：`packages/koatty-container/src/container/lifecycle_manager.ts:24–31`、`container.ts:804–810`。

setInstance 只构造、复制原型值、立即 seal；clear 直接清 WeakMap。`initMethod`/`destroyMethod` 仅在类型和默认配置中出现，源码没有 PostConstruct/PreDestroy 实现，也没有 appStop 逆序销毁入口。实测明确指定 `init`/`dispose` 后，ready 和 clear 均未调用它们，计数都是 0，实例已经 sealed。

修复：实现可 await 的初始化和逆序销毁，接入启动/停止的真实调用链；延后 seal，并对异步初始化失败、销毁顺序及 Legacy/TC39 编译运行补测试。ADR-107 对 COR-07/11 的排期另有 Phase D 表述，应统一计划；即便决定延期，也不能把 §6 C-5 标成已交付。

### C-AUD-03 · drain 的业务 503 没有真正发给客户端（C-1 / COR-03）

位置：`packages/koatty-trace/src/trace/trace.ts:313–317`。

分支设置 ctx.status/body/header 后直接 return，没有经过 HttpHandler/respond。Koatty 的 handleRequest 不像标准 Koa 那样自动发送 body。真实 keep-alive 客户端先收到 200；beginDrain 后 readiness 收到 503，但 `/work` 等待 300ms 后触发 CLIENT_TIMEOUT，而非 503 + Connection: close。

修复：drain 拒绝必须完成各协议响应，且不进入业务；真实 HTTP 用同一 keep-alive 连接断言状态、header、响应完成与业务调用次数。既有测试使用直接 res.end 的应用 callback，没有覆盖 Trace 的这条路径。

### C-AUD-05 · gRPC 客户端 deadline 被固定 Trace timeout 截短（C-2 / COR-04）

位置：`packages/koatty-trace/src/handler/grpc.ts:50–54`。

Serve 传入剩余 deadline 后，Trace 仍使用 `Math.min(callDeadline, ext.timeout)`；这与“客户端 deadline 替代固定框架超时”相反。真实探测：无延迟 unary 成功；client deadline=1000ms、业务 500ms、Trace timeout=200ms 时，约 200ms 即终止。错误处理又读取非 HTTP 请求的 headers，最终返回 gRPC INTERNAL(13)，而不是正确的完成结果。

修复：有 deadline 时使用其剩余预算，无 deadline 才回退配置；保持 deadline 错误码；验证 deadline 大于/小于框架默认值，以及无 deadline、过期 deadline。补包含 Trace 的真实 RPC 测试。

### C-AUD-06 · gRPC 流式调用仍走 Trace 的 unary 超时/回调路径（C-2 / COR-04）

位置：`packages/koatty-trace/src/handler/grpc.ts:51–54,71,108–116`；对照 `koatty-serve/src/server/grpc.ts:638–641`。

Serve 对服务端流/双向流传入 `(call, undefined)`，但 GrpcHandler 不识别流类型，照样设置固定超时并调用 ctx.rpc.callback。真实 500ms 服务端流在 200ms 被记录 Deadline exceeded 和 callback 非函数，底层业务却继续运行并发送数据；成功的双向流同样记录两次 callback 非函数错误。不能因为客户端最后收到数据就称生命周期正确。

修复：将 proto 的流类型贯穿 Serve/Core/Router/Trace，分别定义 unary/client-stream 的 callback 完成和 server/bidi 的 end/cancel/error 完成。流不能套 unary 超时及回调；取消后停止写入，指标和 Span 应在真实流终止时结算。

### C-AUD-07 · maxHoldTime 只记标志，不中止续期或通知业务（C-3 / COR-05）

位置：`packages/koatty-schedule/src/process/locker.ts:105–132`；TC39 `src/decorator/redlock.ts` 有同样逻辑。

watchdog 只设置 holdExceeded 并写日志。传给业务的 signal 来自 redlock.using，并没有被该上限 abort；using 仍等待业务完成，持续续期。业务若挂起，上限不会限制占锁。探测设置 maxHoldTime=15ms，30ms 时业务 signal.aborted=false；直到业务结束才抛“超限”错误。没有重跑，这部分已修好，但计划要求的持锁上限未实现。

修复：统一两条装饰器路径，明确最大持锁时间的续期停止与业务 AbortSignal 语义；不可把 Promise.race 当作取消。补真实 Redis 续期、失锁、竞争和超限验证。当前 backend 探测仅证明 watchdog 不触发 abort，不替代分布式互斥测试。

### C-AUD-08 · 调度 appStop 监听器丢弃 Promise（C-4 / COR-06）

位置：`packages/koatty-schedule/src/process/schedule.ts:161–163`。

监听器调用 `void stopSchedule(...)` 后立即返回，TerminusManager 即使 await listener 也等不到任务排空；正常信号退出可以直接截断正在运行的工作。实测监听器返回值不是 Promise，await 返回后 inFlight=1。

修复：return/await stopSchedule，将调度关闭纳入总停机预算；测试应经 appStop/信号完整路径，而不是只直接调用 stopSchedule。

### C-AUD-10 · JSON Schema 被静默当作轻量 schema 接受（C-6 / COR-08）

位置：`packages/koatty-config/src/config.ts:114–124`、`validator.ts:30`。

只支持逐键轻量规则，没有 AJV/JSON Schema 分支和可选 peer 依赖。传入标准 JSON Schema（port 必须为 integer）时，实际配置 `port:'not-a-number'` 被 LoadConfigs 原样接受，没有错误；标准 schema 的 type/properties/required 被误当配置字段规则。

修复：明确区分两种 schema，JSON Schema 分支使用 AJV，缺引擎时明确失败；未知 schema 不能静默通过。补有效/无效嵌套 schema、字段路径错误和缺依赖场景。

### C-AUD-12 · Redis 仍是伪连接池，未实现独立事务/阻塞连接（C-7 / COR-10）

位置：`packages/koatty-store/src/store/redis.ts:105–106,193–226`。

仍引入 generic-pool，工厂调用 connect，而 ready 后每次 connect 返回同一 this.client。源码没有 client.duplicate 的独立连接路径。探测返回对象身份相等；RedisStore.beginTransaction 也不存在，门面宣称 Redis 支持事务，但实际上抛 unsupported。

修复：普通命令使用共享多路复用客户端；事务/WATCH/阻塞调用使用独立连接和明确归还/关闭契约。必须以真实 Redis 并发阻塞/普通请求、事务隔离验证，普通存储测试通过不构成 COR-10 完成证据。

## P2 问题

### C-AUD-04 · app.stop 不尊重 once 语义，资源清理可重复（C-1 / COR-03）

位置：`packages/koatty-core/src/application.ts:590–623`。

直接遍历 `.listeners('appStop')` 调用原监听器，绕过 EventEmitter 的 once 包装，既不删除监听器，也没有停止 Promise/幂等门闩。实测注册一次 once，连续两次 await app.stop 后计数为 2。并发 stop 也可能重复清理。Stop 回调错误和清理错误还会被忽略或仅记录。

修复：共享一次停止过程，确保事件监听器正确移除，保留失败结果；验证重复/并发 stop，以及 stop 与信号退出交错。

### C-AUD-09 · queue 后继任务不在停机等待快照中（C-4 / COR-06）

位置：`packages/koatty-schedule/src/process/schedule.ts:85–88,120`。

stopSchedule 只等待开始时的 inFlightTasks 快照。首个任务 finally 仍启动 queued 的第二个任务；旧 Promise 完成后 stopSchedule 就返回。实测返回时 runs=2、inFlight=1。即使修复 appStop 的 void，这个问题仍存在。

修复：进入 stopping 状态后取消尚未启动的排队任务，或在共享 deadline 内等待动态任务集合；排空完成应断言没有后台任务，而不是只看初始 Promise settled。

### C-AUD-11 · 显式 strict 画像对缺失环境变量不生效（C-6 / ADR-102）

位置：`packages/koatty-config/src/config.ts:146`。

parseEnv 只通过进程环境解析画像，不读取明确配置的 security.profile。实测 NODE_ENV=development、security.profile='strict'、`${KOATTY_C_AUDIT_MISSING}` 未设置时，加载成功并把 URL 变为空字符串，与显式配置优先的规则不一致。

修复：先确定有效画像或向加载器传入已解析策略，避免每处重新推断；覆盖显式 strict/standard 与 NODE_ENV 相反、嵌套插值和默认值。

### C-AUD-13 · CacheAble 仍无 single-flight（C-7 / COR-13）

位置：`packages/koatty-cacheable/src/cache.ts:113,175` 两种装饰器分支。

miss 后每个请求直接执行原方法，无按键 in-flight Promise 表。实测同一 key 的 10 次并发调用，源方法执行 10 次。store.ts 的 initPromise 仅防止缓存连接重复初始化，不是回源防击穿。

修复：按最终 key 共享在途回源及写缓存过程，失败后清表，保证不同 key 不互相阻塞；Legacy/TC39 均验证。

### C-AUD-14 · 缓存命中会改变返回类型，长键改造未落地（C-7 / COR-13）

位置：`packages/koatty-cacheable/src/cache.ts:103,165,177`；`utils.ts:86`。

写入非 JSON 对象时直接存原值，读取一律 JSON.parse，没有类型标记。实际源方法返回字符串 `'123'`，命中后返回数字 123；一般普通字符串还会被当坏缓存删除并回源。长键仍是 murmurHash，没有方案要求的 SHA-1 和前缀保留；本次没有制造哈希碰撞，不把潜在碰撞写成已复现的数据串用。

修复：带版本/类型标签的对称编码，明确支持值类型和旧缓存迁移；实现长键方案并覆盖字符串、数值、布尔、null、数组等命中前后类型一致性。

### C-AUD-15 · gRPC 的自定义指标 reporter 实际不执行（C-7 / COR-15）

位置：`packages/koatty-trace/src/trace/trace.ts:437–445`。

构建 reporter 参数时直接读取 HTTP Koa 的 ctx.path；grpc-js call 没有 HTTP req.url，getter 抛 `Cannot read properties of undefined (reading 'pathname')`，catch 仅 Warn，reporter 被跳过。实测配置 reporter 后五次真实 gRPC 调用计数为 0；对照 HTTP 200/500 两次调用计数为 2。

修复：按协议提取方法路径/状态，避免 HTTP getter；验证真实 gRPC 正常/错误/流终止的 reporter +1 和 Span 一次结束。这里只确认自定义 reporter 缺失，不扩大为“所有 Prometheus 指标均为零”。

### C-AUD-16 · Phase C 验收勾选缺乏对应证据（§6 验收门、ADR-104/107）

位置：`docs/koatty-hardening-and-ai-evolution-plan.md:831–844`；`packages/koatty-serve/test/regression/COR-04.grpc-streaming.test.ts:33–47`。

文档称 gRPC 四类型端到端已通过，但测试 mock grpc-js Server、proto-loader 和 app.callback，仅测试 wrapper 分派；没有方案要求的真实 proto 客户端链路。容器/存储/缓存的总体测试数量被引用为 COR-07/11/10/13 完成证据，而对应实现和专属回归尚不存在。TC39 RedLock 测试也 mock createDecorator 后手工调用 handler，不能代表 TypeScript 实际 emit 的双模式矩阵。

修复：按证据重写勾选状态；补每个条目的独立失败回归与真实集成正反对照。已有 20/20 停机测试有效，但只证明当前测试场景；它使用真实 HTTP 服务和 process.emit('SIGTERM')，关闭了进程退出，不能覆盖外部 OS 信号/真实退出/所有 cleanup 语义。

## 逐项验收判断

| 任务 | 判定 | 说明 |
|---|---|---|
| C-1 停机闭环 | 不通过 | readiness/HTTP listener 排空、SpanManager 信号统一已有实现；业务拒绝响应、stop 幂等、调度等待不闭环 |
| C-2 gRPC | 不通过 | Serve 四形态分派及 randomUUID 已实现；Trace deadline、stream callback/timeout 和真实端到端门禁缺口 |
| C-3 RedLock | 部分完成 | using 自动续期、单资源、业务不重跑已实现；maxHoldTime 未停止续期/abort；真实 Redis 竞争未验证，旧未导出 Locker 文件仍存在 |
| C-4 Scheduled | 部分完成 | 默认 skip、queue 至多一项、allow 的直接测试通过；停机 Promise 和后继任务排空存在缺陷 |
| C-5 容器 | 未完成 | 双实例化原缺陷仍在；生命周期装饰器、await 初始化、逆序销毁、延迟 seal 未落地 |
| C-6 配置 | 部分完成 | 轻量规则、导出、嵌入环境变量/默认值已有实现；JSON Schema 和显式 strict 缺失 |
| C-7 COR-10 | 未完成 | generic-pool、同一 client 仍在，无 duplicate 隔离 |
| C-7 COR-12 | 所查路径通过 | use 同时清 middlewareStacks/composedCallbackCache，ready 后有 warning；全量 core 测试通过 |
| C-7 COR-13 | 未完成 | single-flight、长键 SHA-1、带类型编码均未实现 |
| COR-14 WS 定时器 | 所查路径通过 | ws pool destroy 清 ping/heartbeat，再调用 super.destroy；serve 测试通过 |
| C-7 COR-15 | 部分完成 | 普通 HTTP 成功/错误 reporter 各一次；gRPC reporter 0 次，流式结算仍受错误超时路径影响 |

另一个需修订的 C-1 预算：TerminusManager 的默认总超时为 `5000 + 25000 + 5000 = 35000ms`，无法作为方案“总时长严格小于 Kubernetes 默认 30s”的保证。需要统一总 deadline，给 force close、appStop/log flush 预留预算；本次未执行 35s 的最坏情况实测，不把这一静态预算矛盾混写成已观测到的超时。

## 修复和发布建议

1. 先修 P1：容器单实例/生命周期、drain 真正响应、gRPC Trace 的 deadline/流式完成、锁持有上限、调度退出等待、JSON Schema、Redis 隔离。
2. 再补 stop 幂等、排队任务收尾、显式画像配置、缓存一致性、跨协议指标，逐项建立能在当前代码上失败的回归。
3. 重新建立真实集成门禁：完整控制器装配的四类 gRPC、真实 Redis 锁续期与竞争、外部 SIGTERM 子进程退出、Legacy/TC39 实际编译运行；Linux/Node 20 CI 与独立消费项目另验。
4. **当前不建议仅再发一个版本来宣称 Phase C 完成。** 修复后需要新版本，直接涉及 container/core/serve/trace/schedule/config/store/cacheable，入口及依赖包范围由 Changesets 计算。不能只 bump `koatty` 而遗漏子包源码或子模块引用。
5. 最终由维护者手动发布。本次未查询 npm 注册表，方案里的“已发布 4.4.0/6.1.0”只视为历史声明；仓库 `pnpm release` 包含发布及子模块提交/推送，不作为只读检查执行。
