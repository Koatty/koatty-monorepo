# Phase D 全面审计（2026-09-28）

**结论：不通过，暂不发布 Phase D。** D-1/D-2 未贯通真实应用链路，D-3 引入执行顺序和重复调用回归，D-6 存在鉴权失效及流取消问题，D-5 未实施，D-7 的缓存与路径边界不完整。既有测试通过不能替代这些验收。

本次按用户要求完成全方案 API 收敛，修改总体方案及迁移说明；新增可重复执行的审计探针和证据。**没有修改生产源码，没有把下述问题标记为已修复，没有提交或发布版本。** 既有 Phase A/B/C 修改和工作区 D/E 开发内容保留。

## 范围与证据

- 通读总体方案全部阶段；沿 Bootstrap → Loader → Container → Core ALS → Router → Middleware/AOP → SSE/错误处理检查 D-1～D-7。
- 当前主仓 HEAD：`cb7807fb1f71ccc6ba31f4813b4b64ee5d4a674c`，审计对象包含未提交修改，不能只用 HEAD 重现。
- 本机：macOS、Node `v22.23.1`、pnpm `9.15.4`。
- [探针源码](phase-d-audit-2026-09-28/probes.cjs)、[原始输出](phase-d-audit-2026-09-28/probes.log)、[执行记录](phase-d-audit-2026-09-28/verification.txt)。探针从当前 TS 源码转译加载，依赖使用当前工作区安装；不依赖旧 router bundle。其 exit 0 表示成功复现缺陷，**不是修复验收通过**。
- 共 **13 个失败场景已复现**，包括真实 HTTP 中间件请求和 Legacy/TC39 实际 TypeScript emit 的对照。SSE 断连/背压探针使用受控响应及事件对象，未冒充真实供应商或真实网络慢客户端验收。
- 六个相关包全部原有测试 **86 个套件，1160 通过、4 跳过、0 失败**；同六包 `tsc --noEmit` 通过。测试使用 `--forceExit`，不代表全部后台资源已自然释放。

| 包 | 套件 | 通过 | 跳过 |
|---|---:|---:|---:|
| koatty_logger | 2 | 30 | 0 |
| koatty_loader | 2 | 15 | 0 |
| koatty_container | 25 | 379 | 0 |
| koatty_core | 19 | 315 | 4 |
| koatty_router | 35 | 414 | 0 |
| koatty | 3 | 7 | 0 |

原始日志：[六包全量测试](phase-d-audit-2026-09-28/full-package-tests.log)。另单独复跑 D 相关用例：container 18、core 6、router 38、loader 14，共 76 例通过；这些是上述全量测试的子集，不重复计数。

## 发现与整改要求

### D-A01 · P1 · 独立容器尚未贯通，仍会解析全局依赖

定位：`packages/koatty/src/core/Bootstrap.ts:90`，`Loader.ts:412/505/535/563`；`packages/koatty-container/src/container/container.ts:479`；`packages/koatty-router/src/router/http.ts:91/121`。

Bootstrap 仍 `IOC.setApp(app)`，Loader 向全局 IOC 注册服务和控制器，HTTP Router 仍通过全局 IOC 解析控制器。容器 `_injection` 也将 **IOC** 传给 Autowired/Values，而非当前容器。探针在独立容器把依赖标为 `isolated`，消费者实际得到 `global`。

隔离还受到共享原型 `app` / `_options`、AOP 进程缓存和原型 `__aopApplied` 标志影响：AOP 实例缓存按名称取值，包装器闭包绑定第一次注入的容器。`RouterMiddlewareManager.getInstance(app)`（`manager.ts:132`）也只保留第一个应用。这些是 D-1 验收链路缺口，不是仅增加 `app.container` 字段就能解决。

**整改**：实例和可变状态归应用容器；共享的只能是不可变类定义。补真实双端口应用测试，使用同一个组件类但不同配置/依赖，验证 service、AOP、中间件、Values 和停止一个应用后的另一个应用均隔离。现有 `ARCH-01.app-container` 测试只替换 stub 并直接调用 stub.get，没有经过启动或路由。

### D-A02 · P1 · Request 与实例级注入不完整

定位：`container.ts:191` 的 `runInRequestScope`、Request 分支及 `getInsByClass:692`；`processor/autowired_processor.ts` 原型属性注入；Core `Component.ts:29`；主包 `Loader.ts:542`。

`runInRequestScope` 用普通字段配合同步 try/finally，返回 Promise 时立即恢复上下文。并发探针显示同一请求 await 前后实例不同，两个请求 await 后得到同一个回退单例。Core 自身 ALS 不存在此同步字段问题，但正常启动的容器绑定、注册与 getInsByClass 链路没有贯通，不能用手动 ctxStorage.run 的单测代表集成完成。

Prototype 消费者虽然每次新建，依赖仍在类原型上共享，探针确认两个消费者持有同一 Prototype 依赖。`getInsByClass(target, [ctx])` 直接构造对象，绕过 Request 缓存和实例初始化流程。Request 注册也创建一个请求外实例；没有活动上下文时回退单例，与文档中的“请求外不发放”相反。

声明入口同样缺失：Core IOCScope 仍只有 Singleton/Prototype，Loader 硬编码服务 Singleton、控制器 Prototype；迁移示例 `@Component({ scope: 'Request' })` 不符合 Component 的现有签名及 core/user scope 含义。`@Autowired({ lazy: true })` 重载不存在，不能作为解决办法。当前依赖校验测试直接调用 private 检查函数，未证明任意注册顺序及真实装饰器注入都能检测。

**整改**：复用 Core ALS；统一解析入口和实例级注入；无请求上下文明确报错；贯通已有注册选项而不混淆组件类别与生命周期。测试需包含跨 await、并发、注册顺序、真实装饰器、Request 的初始化/清理和 Prototype 依赖隔离。

### D-A03 · P1 · 同步 AOP 分支不等待异步内置钩子

定位：`packages/koatty-container/src/processor/aop_processor.ts:554/704`。

`needsAsync` 只检查业务函数和 runSync，未包含 `__before` / `__after`。同步业务配异步 `__before` 时走同步管线，直接调用并丢弃 Promise。探针顺序为 `business → authorized`，而非等待鉴权；拒绝 Promise 也不能按当前管线阻止业务。普通非 async 函数返回 Promise 同样不能仅凭构造函数名判定为同步。

**整改**：统一 `run` 入口，按实际 thenable 结果串联步骤；保留全同步返回普通值的能力。覆盖异步内置钩子、返回 Promise 的普通函数、拒绝和 After 顺序，不允许业务先执行。

### D-A04 · P1 · 同步 Around 可重复执行业务

定位：`aop_processor.ts:572`。

异步管线已有 `proceedOnce`，新同步管线却每次 `proceed()` 都调用原方法。探针一个 Around 连续调用两次 proceed，业务计数为 **2**。写操作可能重复落库，也重新破坏 Phase B 的恰好一次保证。同步 Around 的异常策略还未与异步分支完整对齐。

**整改**：两条路径共用至多一次执行结果/异常状态，重复 proceed 和日志降级不能重跑；覆盖 proceed 前后抛错、`onError: 'log'` 与 Promise 结果。

### D-A05 · P1 · 新增 D-6 装饰器不支持 TC39，鉴权可静默丢失

定位：`packages/koatty-router/src/guard/index.ts:82`、`src/sse/index.ts:69`。

实现只识别 Legacy 的 `(target, key, descriptor)`。实际 TypeScript 双模式 emit 对同一 `@UseGuard(DenyGuard)` + `@SSE()` 类的结果是：Legacy `guards=1, sse=true`；TC39 `guards=0, sse=false`。TC39 的 `(method, context)` 被写入错误的 Reflect 元数据位置，路由读取不到，拒绝鉴权未进入执行链。当前公开类型也仍为 Legacy MethodDecorator。

**整改**：按照新方案删除未发布的重复模型，复用已有路由中间件与 AOP，同时补实际编译后的 HTTP 拒绝测试。复用的装饰器本身若尚未完成 TC39 支持，仍须完成兼容；不能宣称换用老名字就自动满足双模式。

### D-A06 · P1 · 既有类级 middleware 传递丢失，复用前必须补齐

定位：`packages/koatty-core/src/Component.ts:209`；`packages/koatty-router/src/utils/inject.ts:200`。

Controller 把 middleware 类转换为名称字符串；injectRouter 却只按类或带 middleware 的配置对象处理。真实 Koa HTTP + 当前 HttpRouter + 实际装饰器配置探针：同一个拒绝中间件，类级路由返回 **200 secret**，方法级路由返回 **403**；鉴权只执行一次。

这是已有路径上的问题，本次因 D-6 API 复用验收而确认，不称为 D 阶段新引入。**整改**：让两端使用一致元数据，按当前应用容器解析；覆盖类级/方法级组合和覆盖策略，特别防止子方法意外移除必需鉴权。中间件 run 是工厂 `run(options, app) → (ctx, next)`，文档不可再发明 canActivate/intercept 契约。

### D-A07 · P1 · SSE 未向生产者传递取消，且忽略背压

定位：`packages/koatty-router/src/sse/index.ts:209–237`。

AbortController 只在 helper 内部可见，传入的 source 无法获得 signal。`for await` 在等待 next 时无法因断连醒来。探针触发 req.close 后，流任务未结束、生成器 finally 未执行；只有外部主动放行待处理 Promise 后才清理。监听请求 close 也不能替代响应连接生命周期。

数据和心跳均忽略 `res.write()` 的 false 返回，探针在第一次 write=false 后仍写出三条；快生产者与慢客户端可持续积累内存。Web reader 只 releaseLock，没有显式 cancel。

**整改**：保留一个 streamSSE helper，扩展 source factory 获取 AbortSignal；监听响应关闭/错误，取消 reader、销毁流；等待 drain 或取消后再拉取数据，心跳也遵守背压。补真实 HTTP 断连、生产者取消、慢客户端和停机测试。不要声称能强制取消不配合 signal 的业务。编码还需检查 CR/LF 和 event/id 字段合法性。

### D-A08 · P1 · Loader 路径边界只做词法检查

定位：`packages/koatty-loader/src/index.ts:126–135`，`Load` 中的 require 路径。

`path.resolve/relative` 不解析符号链接。探针在项目下创建指向兄弟目录的目录链接，Load 成功 require 了根目录之外的模块。SEC-16 的安全声明因此不成立。越界输入被改成扫描整个 base 也不符合明确拒绝的语义。缓存条目只验证数组形态，加载前还缺少每项规范化路径校验。

**整改**：扫描根、每个模块与缓存文件条目在 require 前均按 realpath 验证允许边界；拒绝越界，不改成扫描更大范围。验证目录链接、文件链接、`../`、伪造缓存条目和损坏缓存回退。

### D-A09 · P2 · 扫描缓存漏掉保留时间戳的新文件

定位：`loader/src/index.ts:179–190`，`treeState` 忽略扫描根自身 mtime 的逻辑。

缓存只比较全树最大 mtime 和目录数量。扫描根增加一个旧时间戳文件（如保留时间戳的构建/复制）后，目录数不变、最大时间不增长，旧列表仍被使用。探针缓存返回 **1** 个模块，关闭缓存则为 **2** 个。`treeState` 仍完整遍历目录并 stat 文件，未证明总体冷启动收益。

**整改**：以目录成员变化与逐文件指纹可靠失效；不能以最大 mtime 代替集合一致性。补复制旧文件、重命名、删除、custom ignore/pattern、缓存损坏测试，并实际比较冷启动。

### D-A10 · P2 · 内容协商无视 q 权重

定位：`packages/koatty-router/src/negotiation/index.ts:23–35`。

实现按字符串出现顺序选择 JSON。探针 `application/json;q=0, text/plain;q=1` 仍选 JSON，违背客户端明确拒绝。**整改**：复用 Koa 的 Accept 协商能力，保留默认 text 的兼容策略；覆盖 q=0、优先级、通配符、vendor JSON、406 策略和非 HTTP 隔离。

### D-A11 · P2 · D-5 和性能验收尚未交付

`koatty-serve/src` 共 36 个 TS 文件、15,714 物理行，其中 pools 4,203 行；`package.json:84` 仍依赖 `@matrixai/quic`，核心仍包含 HTTP/3 实现。与 <5000 行、连接池替换、HTTP/3 分离的验收不符。

D-4 微基准只执行 handler，未覆盖 HTTP、控制器解析、ALS、真实中间件及并发，不能证明 RPS ≥10% / p99 不回退。D-7 只有扫描缓存，没有生产文件清单消费及 200 组件冷启动降低 ≥30% 的证据。Request 微基准测试未覆盖完整异步请求链。

**整改**：D-5 先补行为测试再分步瘦身；保留一份可比较基线，在同环境跑真实 HTTP 与冷启动基准。功能存在缺陷时不以性能指标关闭验收。

## 已执行的方案收敛

总体方案新增 ADR-108，统一修改 B/C/D/E/F 中相关说明，保留必要协议概念，避免增加同义 API：

| 原设计 | 本次修订后的目标 |
|---|---|
| UseGuard / canActivate | 既有 middleware 选项和 IMiddleware.run |
| UseInterceptor / intercept | 既有 @Around 与 IAspect.run；HTTP 前后处理沿用 middleware |
| @SSE | 既有路由 + streamSSE helper，明确取消 factory 重载待实现 |
| runSync | 同一个 run 允许同步结果或 Promise |
| 同义容器工厂、Scope 类型与 lazy 重载 | 既有构造函数、ObjectDefinitionOptions.scope、Core ALS、Autowired 入口 |
| 第二个公共启动/干跑入口 | 静态 manifest；真实启动沿用 createApplication |
| 测试 request 同义包装 | 已有 createHttpTest |
| @McpServer / @Payload / 平行 ToolContext 存储 | 配置、@Service、@Validated 显式 DTO、既有请求上下文 |
| 五种 AI 安全装饰器 | 既有 AOP + 普通服务，审批策略复用工具元数据 |
| @Tool / @Resource / @Prompt | 保留：协议发现元数据与 HTTP 路由不同，作为可选包的必要新增 |
| Phase C 的 PostConstruct / PreDestroy | 已实现接口保持兼容，优先文档化已有 initMethod/destroyMethod，不为收敛强行删 API |

这些是**已完成的设计文档修改**。源码中 guard/interceptor/SSE 装饰器、runSync、CLI manifest 对应字段、包导出及生成 API 文档仍需实施收敛，不应假称本轮已改完运行时。此前迁移说明中的“完全兼容”“请求自动隔离”“断开即取消生产者”等不实结论已撤销。

## 发布与后续验收

1. 先关闭 D-A01～D-A10 的行为缺陷，并完成 ADR-108 对应源码、测试、导出和 CLI 清单调整。
2. 完成 D-5 与性能门禁，或由维护者明确拆分阶段/版本范围，不能以当前状态标记整个 Phase D 完成。
3. 实际编译运行 Legacy/TC39 用户 fixture；真实双应用、鉴权前解析顺序、SSE 断连/背压；Linux/Node 目标矩阵及独立 tarball 消费测试。
4. 核对各包 CHANGELOG、迁移文档和 Changeset，提交子模块并更新主仓引用，再由维护者按 RELEASE-GUIDE 手动发布。本轮不执行 version/release，也不建议现在发布。

本次未复跑全仓 46 包、未运行 D 阶段真实 RPS/p99 或 200 组件冷启动基准、未执行 Linux CI 或 npm tarball 验收；不使用之前 Phase C 的全仓结果替代本轮证据。
