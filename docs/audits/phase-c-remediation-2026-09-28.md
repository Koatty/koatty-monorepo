# Phase C 审计修复记录（2026-09-28）

原始审计的 16 项问题已落实到代码、回归或验收文档。**代码修复完成，发布验收仍未全部关闭**：真实 Redis、远端 Linux/Node 20 CI、独立 npm tarball 消费需继续验证。本轮没有提交、推送、应用版本号或发布。

保留了开始时已有的 Phase D 容器/Core/Loader/Router 改动，以及执行期间出现的 Phase E CLI 改动；只在重叠文件中补对应缺陷。构建生成的 API 文档已更新，不能把并行任务的功能算作本轮交付。

## 逐项闭环

| 审计项 | 落实结果 | 回归证据 |
|---|---|---|
| C-AUD-01 | isAsync 使用 deferred 表，ready 时创建一次；提前解析明确报错 | container `COR-07-11.lifecycle.test.ts` |
| C-AUD-02 | 两种装饰器模式的 PostConstruct/PreDestroy；await 初始化、逆序销毁；Loader ready 屏障与延后 seal；异步 clear/await using | 同上；`phase-c-decorators.cjs` 实际编译执行 |
| C-AUD-03 | HTTP drain 真正 end 响应；gRPC/WS 按各自协议拒绝 | `phase-c-network.cjs` 真实 keep-alive 503 + Connection: close |
| C-AUD-04 | stop 与信号协调器共享资源清理 Promise，保留 once 语义与失败结果；appStop 完成后销毁容器 | core `COR-03.stop-once.test.ts`；外部 SIGTERM 20 次 |
| C-AUD-05 | Trace 使用真实客户端剩余 deadline，无 deadline 才回退配置；保留 DEADLINE_EXCEEDED | 真实 unary 500ms / deadline 1000ms / Trace 200ms；过期请求返回 code 4 |
| C-AUD-06 | proto 流类型传入 Core/Trace；流等待 finish/error/cancel，不调用 unary callback；Span 也不再受固定 unary 时限截断 | 真实四类 RPC、立即返回的 bidi 监听器；GrpcHandler 回归及 `COR-15.grpc-span-lifetime.test.ts` |
| C-AUD-07 | Legacy/TC39 共用持锁执行器；上限触发 AbortSignal，结束 using 回调、停止续期；绝不重跑业务 | watchdog 回归、实际双模式 emit；真实 Redis 门禁已增加但待运行 |
| C-AUD-08 | appStop 返回 stopSchedule Promise | schedule `COR-06.stop-drain.test.ts` |
| C-AUD-09 | stopping 后不启动 queued 后继或新 tick；等待已运行任务 | 同上 |
| C-AUD-10 | 区分轻量规则和 JSON Schema；AJV 8 可选 peer，缺失/版本不符/schema 非法明确失败 | config `COR-08.schema-profile.test.ts` |
| C-AUD-11 | 合并配置后确定显式画像，再解析嵌套环境变量，覆盖数组 | 同上，显式 strict/standard 与 NODE_ENV 相反的场景 |
| C-AUD-12 | 删除 generic-pool；普通命令共享客户端，native/WATCH/阻塞/事务使用 duplicate；显式事务句柄自动关闭连接 | store `COR-10.connection-isolation.test.ts`；真实 Redis 门禁待运行 |
| C-AUD-13 | 按 store + 最终 key 共享回源和写缓存 Promise，失败清表，两种装饰器共用 | cacheable `COR-13.cache-consistency.test.ts`；双模式 emit |
| C-AUD-14 | 版本化类型信封、旧缓存按 miss 迁移；长键保留前缀 + SHA-1 | 同上，8 类值的并发与命中类型一致性 |
| C-AUD-15 | gRPC Context 不再依赖 HTTP URL/header getter；指标在实际调用结束后执行一次 | 真实 5 次正常 RPC reporter=5，deadline 错误后=6；流式 Span 一次结束 |
| C-AUD-16 | 撤销旧 mock/测试总数构成端到端验收的表述，区分本地通过与外部未验；增加 CI 集成门禁 | 方案 §6 验收门、本文件、迁移说明、CI |

补充修复：默认信号停机预算从 35s 调整为 29s 总上限，drain 默认 19s，为 preStop 和资源清理留出时间。停止成功路径使用普通日志后 exit 0，避免 Fatal 日志的错误退出语义。

锁的取消属于协作机制：忽略 signal 的业务仍可能继续执行，需要 fencing/幂等约束。不能声称已强制取消任意 JavaScript 业务。

## 验证结果

- 全量：**46/46 任务成功，3121 passed、48 skipped、0 failed**，禁用 Turbo 缓存。
- 全量之后补充流式 Span 测试并复测 Trace：**17 套件、132/132**；Redis 配置透传收尾后复测 Store：**12 套件、68/68**。
- 直接修改的 9 个包：独立 `tsc --noEmit` 全部通过；Trace/Store 最后改动再次检查通过。
- lint：**24/24**；最后改动的 Trace/Store 补查通过，仍有既有 warnings。
- doctor：17 个子模块检出且具备测试脚本。
- 真实 HTTP / gRPC 完整控制器链路、实际 Legacy/TC39 编译产物、外部 SIGTERM 子进程：通过。
- 构建结束后独立执行的外部 SIGTERM 停机：**连续 20/20 通过**。

全量测试使用 `--runInBand --forceExit --coverage=false --silent`：既有 Jest 套件有未清理句柄，所以不能将此结果称为“全部进程资源自然退出”。独立网络和 OS 信号脚本没有 forceExit。未因新 skip 或放宽断言取得通过。

同时修复了三个验证层问题：CLI fake timers 改用毫秒时间戳以避免 Date realm 不兼容；Logger timer 断言改用可控时钟；Trace timeout 断言排除测试进程真实堆内存造成的内存驱逐，并验证超时计数始终恰好为 1。这些没有改变 CLI/Logger 的生产行为。

证据：[执行摘要](phase-c-remediation-2026-09-28/verification.txt)、[类型检查](phase-c-remediation-2026-09-28/types.log)、[真实集成输出](phase-c-remediation-2026-09-28/integration.log)、[外部停机 20 次](phase-c-remediation-2026-09-28/os-signal-20.log)。

## 发布前剩余工作

1. 运行远端 Linux/Node 20 CI，包含已有停机循环、新增真实协议/装饰器验证及 Redis service 门禁。
2. 在测试 Redis 上运行 `KOATTY_TEST_REDIS_PORT=6379 node scripts/regression/phase-c-redis.cjs`，验证真实续期、上限、WATCH 冲突和阻塞连接隔离。本机未安装 Redis，适配器测试不能替代这一步。
3. 从打包产物建立独立消费项目验证依赖与导出，确认子模块源码和主仓引用一致后，由维护者手动发布。

已准备 `.changeset/phase-c-audit-remediation.md`。Redis 事务句柄、native 连接释放、旧缓存迁移与异步生命周期调用方式见 [迁移说明](../migration/phase-c-audit-remediation.md)。旧版本的历史发布记录不代表这些修复已经发布。
