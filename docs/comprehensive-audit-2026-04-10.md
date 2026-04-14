# Koatty Monorepo 综合评审报告

**评审日期**: 2026-04-10  
**评审范围**: 全部 23 个包 + 构建系统 + 变更集一致性  
**评审维度**: 功能完整性 / 特性准确性 / 组件完备性  
**前序报告**: `code-review-2026-03-12.md`, `koatty-review-2026-04-01.md`, `implementation-plan-2026-04-02.md`

---

## 一、历史 P0/P1 问题修复状态

| 编号 | 原始问题 | 状态 | 验证说明 |
|------|----------|------|----------|
| P0-1 | `this.decryption` 崩溃 (koatty-config) | **已修复** | `config.ts:34-49` 已用 try/catch 包裹，但缺少启动时上下文信息（见新发现 FA-P1-1） |
| P0-2 | `listen()` 双重 `bindProcessEvent` | **已修复** | 信号处理已完全委托给 `TerminusManager`，使用 `signalsRegistered` 防重复注册 |
| P0-3 | `captureError()` 全局移除监听器 | **已修复** | 不再使用 `removeAllListeners`，改为按引用精确移除 |
| P0-4 | AOP 循环依赖未检测 | **已修复** | `CircularDepDetector` 实现 DFS 检测，抛出 `CircularDepError`（但有新问题，见 CC-P2-1） |
| P0-5 | 缺少健康检查/就绪探针 | **部分修复** | `healthCheck.ts` 已实现 `/health` + `/ready`，但**未自动挂载**，用户必须手动注册 |
| P1-1 | `global.__KOATTY_IOC__` 污染 | **已修复** | 改用 `Symbol.for('koatty.ioc.v2')` |
| P1-2 | koatty-typeorm 硬编码凭证 | **已修复/不存在** | `defaultOptions` 中仅有 `host/port`，无凭证 |
| P1-3 | middleware callback() 内存泄漏 | **已修复** | `RouterMiddlewareManager` 使用 LRU 缓存，单例模式带 `resetInstance()` |

**结论**：8 个历史问题中 6 个完全修复，1 个部分修复（P0-5 健康检查），1 个无法复现（P1-2）。但修复过程中引入了新的问题。

---

## 二、新发现问题汇总

### 统计

| 级别 | 数量 | 说明 |
|------|------|------|
| **P0** | 3 | 数据正确性/功能完全失效 |
| **P1** | 6 | 逻辑错误/功能不可用 |
| **P2** | 15 | 可维护性/健壮性问题 |
| **P3** | 7 | 风格/建议 |

---

## 三、P0 — 严重问题（必须立即修复）

### P0-NEW-1: `attachClassMetadata` 缓存引用共享导致元数据重复累积

**文件**: `packages/koatty-container/src/container/metadata_store.ts:49-58`  
**维度**: 特性准确性

```typescript
public attachClassMetadata(...) {
  const originMap = this.getMetadataMap(type, target, propertyName);
  if (!originMap.has(decoratorNameKey)) {
    originMap.set(decoratorNameKey, []);
  }
  originMap.get(decoratorNameKey).push(data);           // ← 第一次写入 originMap 数组
  const currentValue = this.metadataCache.getClassMetadata(...) || [];
  currentValue.push(data);                               // ← 如果 currentValue 与 originMap 同引用，data 被 push 两次
  this.metadataCache.setClassMetadata(..., currentValue);
}
```

**根因**: `getClassMetadata` (line 37-44) 缓存的是 `originMap.get()` 返回的**同一数组引用**（未深拷贝）。当同一 `decoratorNameKey` 第二次调用 `attachClassMetadata` 时，line 56 的 `currentValue` 与 line 55 的 `originMap.get()` 是同一个数组，`data` 被 push 两次。

**影响**: AOP 装饰器元数据 (`@Before`/`@After`/`@Around`) 在第二个及后续同类装饰器注册时被重复累积，导致 aspect 被执行多次，可能造成事务多次提交、日志重复、幂等性破坏。

**修复建议**: line 56 改为 `const currentValue = [...(this.metadataCache.getClassMetadata(...) || [])]` 或在 `getClassMetadata` 返回时做浅拷贝。

---

### P0-NEW-2: 调度系统元数据迭代逻辑与数据结构不匹配，`@Scheduled` 完全失效

**文件**: `packages/koatty-schedule/src/process/schedule.ts:52-59`  
**维度**: 功能完整性

```typescript
const classMetadata = IOCContainer.getClassMetadata(
  COMPONENT_SCHEDULED, DecoratorType.SCHEDULED, component.target
);
// classMetadata 实际类型: Array<{method, cron, timezone}>  (来自 attachClassMetadata)
// 但代码将其当作 Map<string, object> 解构:
for (const [className, metadata] of classMetadata) {  // ← TypeError: {method,cron,timezone} is not iterable
```

**根因**: `@Scheduled` 装饰器 (`scheduled.ts:72-76`) 通过 `attachClassMetadata` 存储 `{method, cron, timezone}` 到数组中。但 `injectSchedule` 在 line 59 使用 `[className, metadata]` 解构，期望 Map 式的 `[key, value]` 对。对一个普通对象进行数组解构会抛 `TypeError: ... is not iterable`，被 line 105 的 catch 静默吞掉。

**影响**: **所有 `@Scheduled` 装饰器声明的 CronJob 从未被注册**。调度系统设计目标完全未实现。这是一个不会报错但功能完全缺失的静默失败。

**修复建议**: 将 line 59 改为 `for (const scheduleData of classMetadata)`，直接迭代数组元素，使用 `scheduleData.method`/`scheduleData.cron` 等字段。

---

### P0-NEW-3: `GrpcStatusCodeMap` 键值重复，UNAUTHENTICATED 覆盖 UNAVAILABLE

**文件**: `packages/koatty-exception/src/code.ts:501-503`  
**维度**: 组件完备性

```typescript
[14, "UNAVAILABLE"],
[15, "DATA_LOSS"],
[14, "UNAUTHENTICATED"],   // ← 键 14 重复，覆盖 UNAVAILABLE
```

**根因**: 复制粘贴错误，`UNAUTHENTICATED` 的正确编号应为 16（参照 gRPC 官方规范）。

**影响**: `GrpcStatusCodeMap.get(14)` 返回 `"UNAUTHENTICATED"` 而非 `"UNAVAILABLE"`，且 `UNAUTHENTICATED(16)` 无法正确查找。所有使用此 Map 做反向查找的 gRPC 错误报告均会误判错误类型。

**修复建议**: 将 line 503 改为 `[16, "UNAUTHENTICATED"]`。

---

## 四、P1 — 高优先级问题（合并前必须修复）

### P1-NEW-1: 加密配置缺失 `KOATTY_CONFIG_KEY` 时启动崩溃无上下文

**文件**: `packages/koatty-config/src/config.ts:52-61`  
**维度**: 功能完整性

当配置文件包含 `ENC(AES256:...)` 值但环境变量 `KOATTY_CONFIG_KEY` 未设置时，`decrypt()` 抛出 `"KOATTY_CONFIG_KEY environment variable is required"`。此错误未被 `decryptConfigValues()` 捕获，直接传播到 `LoadConfigs()` → `LoadAllComponents()`，应用在启动时崩溃，且错误信息不包含具体是哪个配置键触发的。

**修复建议**: 在 `decryptConfigValues()` 中 catch 并包装错误，添加配置路径信息。

---

### P1-NEW-2: gRPC 路由占位处理器抛出误导性错误

**文件**: `packages/koatty-router/src/router/grpc.ts:664-668`  
**维度**: 功能完整性

注册到 gRPC 服务的 `impl` 是占位处理器，显式抛出 `"This handler should not be called"`。实际路由通过 Koa 中间件链完成。但如果中间件链未正确匹配某个 gRPC 方法，占位处理器的错误信息对客户端完全没有诊断价值。路由契约在占位处理器和中间件链之间是脆弱的。

---

### P1-NEW-3: `TransactionAspect.run` 参数语义错误

**文件**: `packages/koatty-typeorm/src/decorator.ts:327-333`  
**维度**: 特性准确性

```typescript
async run(args: any[], proceed?: Function, _aspectOptions?: any): Promise<any> {
  const txOptions: TransactionOptions = args[0] || {};  // ← 错误：args 是目标方法参数
```

根据 `IAspect` 接口，`args` 是**目标方法的实际参数**（如 `[userId, data]`），事务选项应从 `_aspectOptions`（即 `@Around(TransactionAspect, options)` 传入的 options）读取。当前实现将业务参数误作事务选项，导致 `@Transactional({ isolationLevel: 'SERIALIZABLE' })` 等配置完全无效。

**修复建议**: 将 `args[0]` 改为 `_aspectOptions`。

---

### P1-NEW-4: `Inject` 装饰器 `Reflect.getMetadata` 传参错误导致 NPE

**文件**: `packages/koatty-container/src/decorator/autowired.ts:98`  
**维度**: 特性准确性

```typescript
const paramTypes = Reflect.getMetadata("design:paramtypes", target, propertyKey as string | symbol);
```

当 `propertyKey` 为 `undefined`（构造函数参数装饰器的正常情况），`Reflect.getMetadata("design:paramtypes", target, undefined)` 返回 `undefined`，下一行 `paramTypes[parameterIndex]` 抛出 `TypeError`。正确调用应为 `Reflect.getMetadata("design:paramtypes", target)`（不传第三个参数）。

---

### P1-NEW-5: `RedLocker.registerInContainer` 传入实例而非类

**文件**: `packages/koatty-schedule/src/locker/redlock.ts:81-92`  
**维度**: 特性准确性

```typescript
IOCContainer.reg('RedLocker', this, { type: 'COMPONENT', args: [] });
// this 是实例，reg() 期望类
```

`IOCContainer.reg` 验证 `target` 必须是类构造函数（`helper.isClass(target)`），传入实例会失败。虽被 catch 静默处理，但 RedLocker **从未成功注册到 IOC 容器**，破坏了单例语义。

---

### P1-NEW-6: HTTP/3 QPACK Huffman 解码未实现，返回乱码

**文件**: `packages/koatty-serve/src/utils/http3/qpack.ts:379-381`  
**维度**: 组件完备性

```typescript
if (useHuffman) {
  logger.warn('Huffman decoding not implemented, returning raw string');
}
```

所有主流 HTTP/3 客户端都使用 QPACK Huffman 编码（RFC 9204 §4.1），此处跳过解码直接返回原始字节串，导致 header 值为乱码。HTTP/3 功能在实际部署中不可用。

---

## 五、P2 — 中优先级问题

### P2-NEW-1: 循环依赖检测器状态泄漏

**文件**: `packages/koatty-container/src/container/container.ts:278-332`  
**维度**: 组件完备性

非循环依赖的注入失败时（line 295 `_injection()` 抛出非 `CircularDepError`），`finishResolving(identifier)` (line 316) 不会被调用（仅在 try 成功路径），组件永久停留在 `isResolving: true` 状态，污染后续所有 `reg()` 调用的循环依赖检测。

**修复建议**: 在 catch 块中添加 `this.circularDependencyDetector.finishResolving(identifier)`（在 re-throw 之前）。

---

### P2-NEW-2: `setImmediate(() => { throw error })` 导致服务器启动错误不可捕获

**文件**: `packages/koatty-serve/src/server/http3.ts:651`, `grpc.ts:509-513`  
**维度**: 功能完整性

服务器 `listen()` 失败时通过 `setImmediate(() => { throw error })` 抛出错误，使其变为 uncaught exception，调用方无法 try/catch。

---

### P2-NEW-3: `formatError` 丢弃 GraphQL 错误扩展字段

**文件**: `packages/koatty-router/src/router/graphql.ts:127-128`  
**维度**: 特性准确性

生产模式下 `formatError` 将错误包装为 `new Error(error.message)`，丢弃 `GraphQLError.extensions`（包含 `code`/`locations`/`path`），破坏客户端标准 GraphQL 错误处理。

---

### P2-NEW-4: `preloadMetadata()` 静默吞掉所有错误

**文件**: `packages/koatty/src/core/Loader.ts:247-252`  
**维度**: 功能完整性

空 try/catch 吞掉 IOC 预加载过程中的所有错误，包括合法的启动失败。

---

### P2-NEW-5: Trace 中间件创建时过早获取 ExceptionHandler

**文件**: `packages/koatty-trace/src/trace/trace.ts:191-192`  
**维度**: 特性准确性

`IOCContainer.getClass("ExceptionHandler", "COMPONENT")` 在中间件创建时调用（`LoadMiddlewares` 阶段），此时 `ExceptionHandler` 可能尚未注册，导致运行时错误处理失败。

---

### P2-NEW-6: gRPC 错误 `details` 可能为空字符串

**文件**: `packages/koatty-exception/src/exception.ts:395-398`  
**维度**: 特性准确性

gRPC 输出模式下 `details: JSON.stringify(ctx.body || responseBody)`，当 `responseBody` 为空字符串时客户端收到无意义的 `details: ""`。

---

### P2-NEW-7: `mockBean` 无法拦截类引用方式的 bean 查找

**文件**: `packages/koatty-testing/src/mockBean.ts:24-30`  
**维度**: 功能完整性

`String(identifier)` 将类构造函数转为 `"function UserService..."` 形式，与 `mockBean('UserService', mock)` 的字符串键不匹配。因此 `container.get(UserService)` 形式的调用绕过了 mock。

---

### P2-NEW-8: AOP 元数据缓存键不包含 container 标识

**文件**: `packages/koatty-container/src/processor/aop_processor.ts:188-300`  
**维度**: 特性准确性

`getAOPMethodMetadata` 缓存键仅含 `target.name:methodName`，在测试或多容器场景下不同容器的元数据会被混用。

---

### P2-NEW-9: 加密配置载荷长度未预检

**文件**: `packages/koatty-config/src/config.ts:38-48`  
**维度**: 功能完整性

截断的 `ENC(AES256:...)` 载荷（解码后 < 33 字节）会在 `iv`/`tag` 切片时产生不正确的 Buffer 长度，触发密码学错误。

---

### P2-NEW-10: Swagger 默认 `jsonPath: '/swagger.json'` 写入根目录失败

**文件**: `packages/koatty-swagger/src/index.ts:56-59`  
**维度**: 功能完整性

默认的绝对路径 `/swagger.json` 尝试写入文件系统根目录，必然失败（权限/路径错误），错误被静默捕获。

---

### P2-NEW-11: Swagger UI 依赖 unpkg CDN + 过时版本

**文件**: `packages/koatty-swagger/src/index.ts:116-142`  
**维度**: 功能完整性

Swagger UI HTML 硬编码加载 `unpkg.com` 的 `swagger-ui-dist@3`（当前最新为 v5），在离线环境不可用。

---

### P2-NEW-12: `checkValidated` 返回原始 args 而非验证后实例

**文件**: `packages/koatty-validation/src/decorators.ts:198-246`  
**维度**: 特性准确性

`validatedArgs` 始终是原始 `args`，class-validator 的类型转换结果存在 `validationTargets` 中但未用于方法调用，类型转换效果完全丢失。

---

### P2-NEW-13: `getArgs` 参数解析对箭头函数/解构参数失败

**文件**: `packages/koatty-cacheable/src/utils.ts:21-43`  
**维度**: 特性准确性

正则 `/.*?\(([^)]*)\)/` 无法处理解构参数 `({ id, name })` 和默认值。参数索引返回 `-1` 时缓存键退化为仅 `cacheName`，不同参数值共享同一缓存。

---

### P2-NEW-14: `TransactionManager.createSavepoint` 忽略用户传入的 `name`

**文件**: `packages/koatty-typeorm/src/decorator.ts:279-284`  
**维度**: 特性准确性

`_name` 参数被忽略，总是生成随机名称，使嵌套事务调试困难。

---

### P2-NEW-15: `getPerformanceMetrics()` 死代码未清理

**文件**: `packages/koatty-core/src/Application.ts:526-533`  
**维度**: 组件完备性

方法不在 `KoattyApplication` 接口中，`connectionPools` 永远为空，Phase 2 变更集声称"删除死代码"但此方法仍存在。

---

## 六、P3 — 低优先级（建议改进）

| 编号 | 位置 | 问题 |
|------|------|------|
| P3-1 | `koatty-trace/src/trace/trace.ts:440` | `Logger.warn` (小写) 应为 `Logger.Warn` |
| P3-2 | `koatty-ai/src/cli/index.ts:37-39` | `program.parse()` 后的帮助显示逻辑为死代码 |
| P3-3 | Health check 中间件未自动挂载到 `ServeComponent` | 降低开箱即用体验 |
| P3-4 | `koatty-core/IApplication.ts:283` | `GraphQLSchemaDefinition = any`（TODO stub）|
| P3-5 | `koatty-core/IApplication.ts:250` | `KoattyServer.options: any` 缺失类型安全 |
| P3-6 | `koatty-core/Application.ts:681-702` | 22 行注释掉的 Proxy 代码未清理 |
| P3-7 | `koatty-logger/src/logger.ts:406-430` | `validateLogPath` 限制日志路径必须在 `./logs/`，容器化部署常见绝对路径被拒 |

---

## 七、变更集(Changeset)一致性验证

Phase 1 和 Phase 2 的 changeset 描述与实际代码状态存在不一致：

| 变更集声明 | 实际状态 | 说明 |
|-----------|----------|------|
| Phase 1: Symbol.for IOC (TASK-1-7) | **已实施** | `container.ts:912` 使用 `Symbol.for('koatty.ioc.v2')` |
| Phase 1: Logger warn 修复 (TASK-1-5) | **误导** | 代码已是正确的，无需修复 |
| Phase 1: TypeORM 凭证移除 (TASK-1-3) | **误导** | 源码中无硬编码凭证 |
| Phase 1: TypeORM 事件名 (TASK-1-4) | **已实施** | 使用 `AppEvent.appStop` |
| Phase 2: 组件 enable AND 逻辑 (TASK-2-1) | **已实施** | `ComponentManager.ts:132` |
| Phase 2: createContext 返回类型 (TASK-2-7) | **误导** | 已经是 `KoattyContext`，无需修改 |
| Phase 2: 死代码移除 (TASK-2-6) | **部分实施** | `getPerformanceMetrics()` 仍存在 |
| Phase 2: Span 生命周期 (TASK-2-4) | **已实施** | `trace.ts:448` 调用 `endSpan()` |
| Phase 2: Validation null safety (TASK-2-2) | **已实施** | 使用可选链 `?.` |
| Phase 2: Store type 一致性 (TASK-2-3) | **已实施** | `CacheStore | null` |
| Phase 2: 端口冲突警告 (TASK-2-10) | **已实施** | `ServeComponent.ts:67-72` |
| Phase 2: tsconfig references (TASK-2-8) | **部分实施** | 19/24 包，缺 5 个 |
| Phase 2: 内存缓存事务 (TASK-2-9) | **已实施** | 抛出明确错误 |

**问题**: 3 个变更集描述了不存在或已修复的 bug（TASK-1-3, TASK-1-5, TASK-2-7），2 个变更集未完全实施（TASK-2-6, TASK-2-8）。变更集管理流程需要加入**代码状态验证**步骤。

---

## 八、功能完整性矩阵

| 功能 | 状态 | 说明 |
|------|------|------|
| Bootstrap 生命周期 | **OK** | 11 步序列完整 |
| HTTP 服务器 | **OK** | 完整实现 |
| HTTPS 服务器 | **OK** | SSL/TLS 证书加载 |
| HTTP/2 服务器 | **OK** | h2 支持 |
| HTTP/3 服务器 | **不可用** | Huffman 解码未实现，实际部署必然乱码（P1-NEW-6）|
| gRPC 服务器 | **OK** | 4 种流类型，元数据，截止时间 |
| WebSocket 服务器 | **OK** | 心跳、背压、内存限制 |
| GraphQL 服务器 | **部分** | formatError 丢弃扩展字段（P2-NEW-3） |
| 路由 (HTTP) | **OK** | 完整参数提取 |
| 路由 (gRPC) | **部分** | 占位处理器契约脆弱（P1-NEW-2） |
| 路由 (WebSocket) | **OK** | 帧/缓冲管理 |
| 路由 (GraphQL) | **部分** | 错误格式不合规 |
| 配置加载 | **OK** | 环境变量注入、文件合并 |
| 加密配置 | **部分** | 缺少密钥时崩溃无上下文（P1-NEW-1） |
| IoC/DI 容器 | **OK** | 单例、原型、懒代理 |
| 循环依赖检测 | **部分** | 非循环错误会污染状态（P2-NEW-1） |
| AOP | **有缺陷** | 元数据双写导致 aspect 重复执行（P0-NEW-1） |
| 调度系统 | **失效** | `@Scheduled` 装饰器从未注册 CronJob（P0-NEW-2） |
| 分布式锁 (RedLock) | **部分** | IOC 注册失败（P1-NEW-5） |
| 异常层级 | **OK** | 协议感知输出 |
| gRPC 状态码映射 | **有缺陷** | UNAUTHENTICATED/UNAVAILABLE 映射错误（P0-NEW-3） |
| OpenTelemetry | **OK** | SDK、Span、采样、批量导出 |
| Prometheus 指标 | **OK** | 内置收集器 |
| 健康检查 | **部分** | 存在但未自动挂载 |
| 事务管理 | **部分** | 参数语义错误（P1-NEW-3）、保存点名称被忽略（P2-NEW-14） |
| 验证系统 | **部分** | 类型转换结果未传递（P2-NEW-12） |
| 缓存系统 | **部分** | 参数解析对解构失败（P2-NEW-13） |
| 测试工具 | **部分** | mockBean 不拦截类引用查找（P2-NEW-7） |
| CLI 脚手架 | **OK** | 命令结构完整 |
| Swagger/OpenAPI | **部分** | CDN 依赖、默认路径错误（P2-NEW-10/11） |
| TypeORM 集成 | **OK** | 无硬编码凭证，正确配置 |

---

## 九、组件完备性评分

| 包 | 完备度 | 关键缺失 |
|----|--------|----------|
| koatty (主入口) | 92% | preloadMetadata 错误吞掉 |
| koatty-core | 93% | 死方法、GraphQL 类型 stub、optional 方法隐式契约 |
| koatty-container | 85% | **P0: 元数据双写**、循环检测器状态泄漏、Inject NPE |
| koatty-router | 90% | gRPC 占位处理器、GraphQL formatError |
| koatty-serve | 82% | **HTTP/3 Huffman 未实现**、启动错误不可捕获、健康检查未自动挂载 |
| koatty-exception | 88% | **P0: 状态码映射错误**、gRPC details 可能为空 |
| koatty-trace | 92% | ExceptionHandler 过早获取 |
| koatty-config | 90% | 加密配置错误无上下文、载荷长度未预检 |
| koatty-schedule | 40% | **P0: @Scheduled 完全失效**、RedLock 注册失败 |
| koatty-typeorm | 80% | **TransactionAspect 参数错误**、保存点名称忽略 |
| koatty-validation | 85% | 类型转换结果丢失、WS 验证死代码 |
| koatty-cacheable | 82% | 参数解析正则缺陷、日志方法大小写不一致 |
| koatty-testing | 80% | mockBean 无法拦截类引用 |
| koatty-swagger | 75% | CDN 依赖、默认路径错误、过时版本 |
| koatty-store | 95% | 类型已修复 |
| koatty-logger | 95% | 日志路径过度限制 |
| koatty-loader | 95% | — |
| koatty-lib | 98% | — |
| koatty-proto | 93% | parseProtoRoot 可能返回 undefined |
| koatty-graphql | 95% | — |
| koatty-serverless | 90% | 需验证各平台适配器 |
| koatty-ai | 88% | AI 功能依赖外部服务、死代码 |

---

## 十、修复优先级建议

### 第一批 — 立即修复（阻塞发布）

| 优先级 | 编号 | 预估工作量 | 修复包 |
|--------|------|-----------|--------|
| P0 | P0-NEW-1: 元数据双写 | 1h | koatty-container |
| P0 | P0-NEW-2: 调度迭代逻辑 | 2h | koatty-schedule |
| P0 | P0-NEW-3: gRPC 状态码映射 | 10min | koatty-exception |
| P1 | P1-NEW-3: TransactionAspect 参数 | 30min | koatty-typeorm |
| P1 | P1-NEW-4: Inject 装饰器 NPE | 30min | koatty-container |
| P1 | P1-NEW-5: RedLocker 注册 | 1h | koatty-schedule |

### 第二批 — 合并前修复

| 优先级 | 编号 | 预估工作量 | 修复包 |
|--------|------|-----------|--------|
| P1 | P1-NEW-1: 加密配置错误上下文 | 1h | koatty-config |
| P1 | P1-NEW-2: gRPC 占位处理器 | 2h | koatty-router |
| P1 | P1-NEW-6: HTTP/3 Huffman | 8h+ | koatty-serve |
| P2 | P2-NEW-1: 循环检测器 finishResolving | 30min | koatty-container |
| P2 | P2-NEW-3: GraphQL formatError | 1h | koatty-router |
| P2 | P2-NEW-7: mockBean 类引用 | 2h | koatty-testing |
| P2 | P2-NEW-12: 验证类型转换 | 2h | koatty-validation |
| P2 | P2-NEW-13: 缓存参数解析 | 2h | koatty-cacheable |

### 第三批 — 后续迭代

所有其余 P2 和 P3 问题。

---

## 十一、整体评审结论

**判定：REJECT — 不建议当前状态发布**

### 核心问题

1. **调度系统完全失效** (P0-NEW-2): `@Scheduled` 装饰器是框架核心卖点之一，但由于元数据结构与迭代逻辑不匹配，所有 CronJob 从未被注册。这是一个静默失败，用户不会收到任何错误提示。

2. **AOP 元数据重复累积** (P0-NEW-1): IoC/DI 容器是整个框架的基石，元数据存储的引用共享 bug 会导致 `@Before`/`@After`/`@Around` aspect 被重复执行，在生产环境可能造成数据一致性问题。

3. **gRPC 状态码映射错误** (P0-NEW-3): 作为声称支持多协议的框架，gRPC 错误处理是不可或缺的基础设施，UNAUTHENTICATED/UNAVAILABLE 混淆会导致客户端无法正确处理错误。

### 积极面

- 历史 P0 问题（进程信号处理、全局命名空间污染）已全部修复
- Bootstrap 生命周期、HTTP/HTTPS/HTTP2/gRPC/WebSocket 服务器核心路径稳定
- OpenTelemetry/Prometheus 可观测性集成质量高
- 循环依赖检测、TerminusManager 等新组件设计合理
- 代码结构清晰，包职责划分明确

### 建议

1. **修复 3 个 P0 + 6 个 P1 后重新提交评审**
2. 建立变更集验证流程 — 每个 changeset 描述必须附带代码 diff 或验证截图
3. HTTP/3 如暂无 Huffman 支持，应在文档和启动日志中明确标注为**实验性功能**
4. 考虑为核心子系统（调度、事务、缓存）补充集成测试，覆盖端到端场景
