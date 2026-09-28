# Phase A–D 审计修复记录（2026-09-28）

**已修复 D-A01～D-A10 的主要行为缺陷，并将 ADR-108 的 API 收敛落实到源码、导出、测试和清单。Phase A～D 整体尚未全部补齐，不具备 Phase D 发布条件。** D-A11 中的连接池替换、HTTP/3 拆分、生产可执行清单以及完整性能验收仍开放。保留历史 A/B/C 修复和工作区其他开发内容；未提交、推送、应用版本号或发布。

环境：macOS、Node v22.23.1、pnpm 9.15.4；HEAD `cb7807fb1f71ccc6ba31f4813b4b64ee5d4a674c` 加未提交修改。HEAD 本身不能重现交付源码，关键源码指纹与摘要在 [证据目录](phase-ad-remediation-2026-09-28/verification.txt)。

## 修复对应关系

| 审计项 | 已落地的行为 | 回归证据 |
|---|---|---|
| D-A01 应用隔离 | Bootstrap 创建独立 Container；Loader、所有协议 Router、middleware 和 AOP 使用 app.container；注入落在实例，不写共享原型；类标识、同名类元数据缓存按构造函数隔离；Config 从实例 app 取值 | container `AD.instance-isolation`、config `AD.config-app-isolation`、主包 `AD.bootstrap-two-apps`；实际 HTTP 下两个启动应用返回自己的服务值，停止 A 后 B 仍正常 |
| D-A02 作用域 | Core ALS 与显式 ALS 请求绑定贯通；跨 await 保持、并发隔离、请求外拒绝、Singleton 捕获 Request 拒绝；Prototype 依赖每次创建；getInsByClass、Service 注册选项、请求初始化及销毁使用真实实例；不在启动时构造 Controller | container `ARCH-02`、`AD.instance-isolation`；主包 `AD.controller-request-scope` |
| D-A03 内置异步钩子 | 单一 IAspect.run 支持同步值/thenable；内置 __before/__after 与 Before/After 按返回值等待；业务不得抢跑 | container `ARCH-03`、AOP compatibility；实际双模式编译脚本 |
| D-A04 重复 proceed | 共用首次结果/Promise/错误；同步、异步、onError:log 回退均不重跑业务 | container `AD.instance-isolation`、AOP compatibility；实际 Legacy/TC39 Around 两次 proceed、业务计数仍为 1 |
| D-A05 重复装饰器 | 移除未发布 UseGuard/UseInterceptor/IGuard/IInterceptor/SSE 装饰器/runSync/createIsolated；保留已有 Controller/Mapping middleware、Around/run、普通路由 streamSSE 和 new Container | 源码/导出/API 文档检查；CLI manifest 回归；实际 Legacy/TC39 TypeScript emit |
| D-A06 类级 middleware | 保留 middleware 类引用并按当前容器解析；兼容旧名称引用；拒绝先于路由参数解析和业务 | router `AD.existing-api-http`、`ARCH-06.guard-interceptor-negotiation`；两种编译模式真实 HTTP 均返回 403 |
| D-A07 SSE | source factory 获取 AbortSignal；等待 next/drain 时可以取消；Web reader cancel、Node stream destroy；心跳遵守背压；晚到的 source 也清理；CR/LF 与 id/retry 编码校验 | `ARCH-06.sse` 受控背压/挂起源回归；`AD.existing-api-http` 真实 HTTP 客户端断开后生产者收到 abort、路由结束 |
| D-A08 路径越界 | 扫描目录、模块、缓存条目加载前 realpath 校验；越界直接拒绝，损坏缓存安全重扫 | loader `AD.scan-boundaries` |
| D-A09 缓存失效 | schema 2 按目录成员与逐文件状态校验；旧时间戳新增、删除、重命名、链接与自定义 ignore 不依赖全树最大 mtime | loader `PERF-03.scan-cache`、`AD.scan-boundaries`；未将缓存正确性等同于启动提速 |
| D-A10 内容协商 | 遵守 Accept 权重、q=0、通配符、vendor JSON；仅作用于 HTTP；内部错误保持脱敏 | router `ARCH-06.guard-interceptor-negotiation` |
| D-A11 部分 | 删除只采集统计的周期轮询；HTTPS/HTTP2 文件证书自动更新，先验证 TLS context 再替换，失败保留当前证书，停止后解除监听 | serve `AD.certificate-reload` 实际 TLS 新连接证书对比/无效证书回退；`AD.no-metrics-polling` |

额外修复：内存缓存、WS、metrics 和 Span 维护定时器不再阻止空闲进程退出；gRPC 旧流入口在初始化失败、流关闭和 cleanup 时释放 deadline。全量测试此前分别在 store、router、trace 挂住，定位句柄后增加实际子进程退出与 timer cleanup 回归。正常停机仍主动 flush/destroy，unref 不等于资源已清理。真实安全基线另定位到 HTTPS 将服务端 authorized=false 误当未完成握手的问题；现由 secureConnection 事件明确传递完成状态，未关闭证书校验，并补真实 HTTPS 与等待取消回归。

Jest 导入 Bootstrap 类不再隐式创建后台应用，测试显式启动并负责 stop。共享默认日志器按应用记录使用者，最后一个停止时关闭批量定时器，不销毁其他应用使用的日志器。默认日志器配置仍为进程共享，未承诺完整日志配置隔离。

## 本地验证

- 全仓测试命令：`pnpm exec turbo run test --concurrency=1 -- --runInBand`。46/46 任务成功，其中 37 个缓存命中；累计 Jest **3146 passed / 48 skipped / 0 failed**，详见 [逐包统计](phase-ad-remediation-2026-09-28/test-summary.json)。缓存为本轮前面成功执行的结果，不能称为全部重新强制执行。
- 未在命令中追加 forceExit；但 serve 的既有 Jest 配置仍有 forceExit，因此全仓绿色不等于每个套件均已自然退出。store/router/trace 和新增退出子进程回归自然完成。
- koatty_graphql、koatty_testing 仍无测试；koatty-doc 运行文档校验。保留既有 48 个 skip，不算作已验证。
- `pnpm lint`：24/24 任务，0 error，保留 warning。`pnpm run doctor`：5/5。`pnpm doctor` 是 pnpm 自身诊断命令，曾因沙箱外用户缓存目录不可写报错，不把它当作项目 doctor 结果。
- 最终 `pnpm build` 成功：基础包依序构建，Turbo 23/23（19 缓存）；包含最新 HTTPS 修复的 JS 与类型声明。
- [真实协议集成](phase-ad-remediation-2026-09-28/real-protocols.txt)：HTTP 与 gRPC 四种形态、Legacy/TC39 注入/生命周期、OS SIGTERM 停机均通过；本次 OS 信号脚本运行一次，不冒充 CI 中的 20 次循环。
- [既有 API 双模式](phase-ad-remediation-2026-09-28/existing-decorators.txt)：实际 emit 的 Autowired/Around/Before、多容器 Prototype、proceed 至多一次通过。
- [最终安全基线](phase-ad-remediation-2026-09-28/security-baseline.txt)：含脚本类型检查与真实 HTTP/WS/TLS/GraphQL，**PASS 14 / FAIL 0 / SKIP 0**；HTTPS 修复后不再出现 10 秒握手等待残留。
- TLS 停止监听测试在把等待延长至大于 500ms 轮询 + 100ms 防抖之后单独复跑通过。
- API 生成文档随包重建，撤回接口不再出现在导出中。迁移和 CHANGELOG 已更新；CI 增加实际 Legacy/TC39 既有 Autowired/Around/Before 组合脚本。

## 性能实测与范围

普通 Node 进程执行当前 Container 源码，Request 空依赖 Bean 每次新请求解析中位数 **1.154µs**，Singleton **0.160µs**（25 组，每组 2000 次，先预热）。[原始数据](phase-ad-remediation-2026-09-28/request-scope.json)。这验证指定微基准，不代表完整 HTTP/AOP/数据库请求耗时。

HTTP 使用真实本地 Koa 服务与 Node 客户端，16 并发、每轮 5000 请求、7 组交替顺序；基线为 HEAD handler，其他依赖与环境相同。它只隔离 handler 改动，**不是两个完整框架版本的对比**。

| 测量 | 基线 RPS | 当前 RPS | RPS 变化 | 基线 p99 | 当前 p99 | 10% 且 p99 不退化 |
|---|---:|---:|---:|---:|---:|---|
| 优化前 | 14945.96 | 15355.58 | +2.74% | 2.971ms | 2.801ms | 未通过 |
| 减少异步包装后 | 15942.18 | 16564.93 | +3.91% | 2.191ms | 2.264ms | 未通过 |

两轮基线存在机器状态差异，不能跨行比较绝对吞吐；没有反复跑到达标为止。每轮明细：[优化前](phase-ad-remediation-2026-09-28/http-before-optimization.json)、[优化后](phase-ad-remediation-2026-09-28/http-after-optimization.json)。D-4 性能门保持未通过。

## 仍须完成的工作

1. **D-5**：当前 serve 仍为 36 个 TS 文件、15740 物理行（含注释/空行）；旧连接池替换、HTTP/3 拆为可选包、移除核心 @matrixai/quic、serve 源码 <5000 行。只完成 TLS 与无效轮询部分，不把删除少量代码称为整体瘦身。
2. **D-7**：生产预生成可执行文件清单的构建/启动消费契约、200 组件项目冷启动降低 ≥30%。扫描缓存已修正确性，性能和生产清单仍未交付。
3. **发布环境验收**：远端 Linux/目标 Node 矩阵、真实 Redis、独立 tarball 消费、新项目生成完整链路、变更行覆盖率门禁与完整公共装饰器双模式矩阵。本地无 redis-server/Docker；已有 CI Redis 门禁不能冒充本机真实执行。
4. **性能**：完整框架版本、真实 HTTP RPS 提高 ≥10% 且 p99 不退化。当前对比不足以关闭该项。

暂不提示发布版本。完成剩余实施和验收后，由维护者按 RELEASE-GUIDE 手动发布；当前 Changeset 仅是待审材料。历史审计报告保留原时点结论，不改写历史失败为成功。
