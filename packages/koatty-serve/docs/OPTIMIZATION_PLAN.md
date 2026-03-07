# koatty-serve 优化方案

> 基于深度代码评审的完整优化方案
> 版本: 1.0 | 日期: 2026-03-08

## 1. 评审总览

### 1.1 包信息

| 项目 | 详情 |
|------|------|
| 包名 | `koatty_serve` |
| 版本 | 3.1.9 |
| 描述 | 提供 HTTP/HTTPS/HTTP2/HTTP3/gRPC/WebSocket 多协议服务器 |
| 源文件 | 34 个 TypeScript 文件 |
| 测试文件 | 24 个测试文件 |
| Node.js | >=18.0.0 |

### 1.2 架构优点

- **模板方法模式**：`BaseServer` 定义生命周期骨架，六个协议子类各自实现钩子，符合开闭原则
- **统一连接池抽象**：`ConnectionPoolManager` 提供协议无关接口，含请求/释放、健康检查、指标收集
- **优雅关闭四步骤**：停止接受 → 等待完成 → 强制关闭 → 清理监控，每步有超时保护
- **RingBuffer 指标收集**：O(1) 写入，固定内存占用
- **TimerManager 定时器合并**：将多个定时器合并为三级频率执行

### 1.3 综合评分: 7/10

---

## 2. 问题分类

### 2.1 严重问题 (Critical) — 必须修复

#### C1: ConnectionPoolManager 定时器泄漏

**位置**: `src/pools/pool.ts` 第 679-689 行

**现状**:
```typescript
private startPeriodicTasks(): void {
  setInterval(() => { this.updateHealthStatus(); }, 5000);
  setInterval(() => { this.cleanupExpiredConnections(); }, 30000);
}
```

**问题**: `setInterval` 返回值未保存，`destroy()` 中无法清理。导致：
- 连接池销毁后定时器仍在运行
- 对象无法被 GC 回收（定时器持有闭包引用）
- 测试中 `--detectOpenHandles` 告警

**修复方案**:
```typescript
private healthCheckInterval?: NodeJS.Timeout;
private cleanupInterval?: NodeJS.Timeout;

private startPeriodicTasks(): void {
  this.healthCheckInterval = setInterval(() => {
    this.updateHealthStatus();
  }, 5000);
  this.healthCheckInterval.unref();

  this.cleanupInterval = setInterval(() => {
    this.cleanupExpiredConnections();
  }, 30000);
  this.cleanupInterval.unref();
}

async destroy(): Promise<void> {
  if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
  if (this.cleanupInterval) clearInterval(this.cleanupInterval);
  // ... 原有逻辑
}
```

**影响范围**: 所有协议的连接池，无破坏性变更

---

#### C2: process.setMaxListeners(0) 全局副作用

**位置**: `src/utils/terminus.ts` 第 27 行

**现状**:
```typescript
process.setMaxListeners(0); // 0 表示无限制
```

**问题**: 模块级副作用，仅 `import` 就会关闭 Node.js 内存泄漏检测。在真实监听器泄漏时开发者无法得到警告。

**修复方案**: 删除此行。配合 C3 的修复（统一信号处理），不会再出现重复注册的问题。

**影响范围**: 无破坏性变更

---

#### C3: 双重关闭竞争条件

**位置**: `src/utils/terminus.ts` + `src/utils/terminus-manager.ts` + `src/ServeComponent.ts`

**现状**: 三条关闭路径并存：
1. `TerminusManager.shutdownAll` 监听信号 → 触发 `appStop` → 调用 `destroy()`
2. `onSignal` 函数也监听信号 → 触发 `appStop` → 调用 `destroy()`
3. `ServeComponent.stopServer` 响应 `appStop` → 调用 `Stop()`

当收到 SIGTERM 时，同一服务器可能被关闭 2-3 次，`gracefulShutdown` 的 `isShuttingDown` 标志会抛出异常。

**修复方案**: 
统一为单一路径：`TerminusManager`（单例）→ `appStop` 事件 → `ServeComponent.stopServer`。

具体步骤：
1. 移除 `terminus.ts` 中的 `signalHandlers` 和 `onSignal` 中的重复信号逻辑
2. `CreateTerminus` 仅注册到 `TerminusManager`（已有此行为）
3. `TerminusManager.shutdownAll` 只触发 `appStop`，不直接调用 `destroy()`
4. 让 `ServeComponent.stopServer` 成为唯一执行关闭的入口

**影响范围**: 内部行为变更，公共 API 不变

---

#### C4: 构造函数初始化时序问题

**位置**: `src/server/base.ts` + 所有子类构造函数

**现状**:
```typescript
// BaseServer
constructor(protected app, options: T) {
  this.options = { ...options };
  this.initializeServer(); // 使用原始 options
}

// HttpServer
constructor(app, options) {
  super(app, options);  // 此时 initializeServer 已执行完毕
  this.options = ConfigHelper.createHttpConfig(options); // 覆盖 options
}
```

**问题**: `initializeServer()` 在 `super()` 中执行时，子类尚未调用 `ConfigHelper` 处理配置，导致连接池和服务器实例使用的是未经处理的原始配置。

**修复方案（两种选择）**:

**方案 A（推荐）: 延迟初始化**
```typescript
// BaseServer
constructor(protected app, options: T) {
  this.options = { ...options };
  // 不在构造函数中调用 initializeServer
}

// HttpServer
constructor(app, options) {
  super(app, options);
  this.options = ConfigHelper.createHttpConfig(options);
  this.initializeServer(); // 子类配置完成后手动调用
  CreateTerminus(app, this);
}
```

**方案 B: 配置前置处理**
```typescript
// HttpServer
constructor(app, options) {
  super(app, ConfigHelper.createHttpConfig(options)); // 先处理配置再传入
  CreateTerminus(app, this);
}
```

**影响范围**: 方案 A 需要所有 6 个子类修改；方案 B 仅修改子类构造函数参数。无公共 API 变更。

---

### 2.2 重要问题 (Major) — 强烈建议修复

#### M1: createGrpcConfig 中 channelOptions 赋值错误

**位置**: `src/config/config.ts` 第 421-422 行

**现状**:
```typescript
return {
  ...options,
  channelOptions: options.connectionPool || {},  // BUG: 应为 options.channelOptions
  // ...
}
```

**问题**: 将 `connectionPool` 配置赋给了 `channelOptions`，导致 gRPC 服务器使用错误的 channel 选项。

**修复方案**:
```typescript
channelOptions: options.channelOptions || {},
```

**影响范围**: 仅 gRPC，是 bug 修复

---

#### M2: ConnectionPoolFactory 缓存键不稳定

**位置**: `src/pools/factory.ts` 第 33 行

**现状**:
```typescript
const key = `${protocol.toLowerCase()}_${JSON.stringify(config)}`;
```

**问题**: 同一配置对象键顺序不同会产生不同字符串，导致同配置创建多个连接池实例。

**修复方案**:
```typescript
const key = `${protocol.toLowerCase()}_${JSON.stringify(config, Object.keys(config).sort())}`;
```

或使用哈希函数：
```typescript
import { createHash } from 'crypto';
const configHash = createHash('md5')
  .update(JSON.stringify(config, Object.keys(config).sort()))
  .digest('hex').substring(0, 8);
const key = `${protocol.toLowerCase()}_${configHash}`;
```

**影响范围**: 内部实现，无破坏性变更

---

#### M3: errorRate 只增不减

**位置**: `src/pools/pool.ts` 第 782 行

**现状**:
```typescript
case 'error':
  this.metrics.errorRate = Math.min(this.metrics.errorRate + 0.01, 1);
  break;
```

**问题**: 每次错误 +0.01，永不衰减。长时间运行后趋近 1.0，不反映真实错误率。

**修复方案**: 使用指数移动平均（EMA）衰减：
```typescript
private errorWindow: RingBuffer<{ timestamp: number; isError: boolean }>;

// 在构造函数中
this.errorWindow = new RingBuffer<{ timestamp: number; isError: boolean }>(1000);

// 计算错误率
private calculateErrorRate(): number {
  if (this.errorWindow.length === 0) return 0;
  const errors = this.errorWindow.filter(e => e.isError).length;
  return errors / this.errorWindow.length;
}
```

**影响范围**: 内部指标计算，无破坏性变更

---

#### M4: gRPC RegisterService 硬编码 30s 超时

**位置**: `src/server/grpc.ts` 第 694 行

**现状**:
```typescript
const timeoutMs = 30000; // 30 seconds
```

**问题**: 不可配置，对长时间运行的 gRPC 流/批处理会过早超时。

**修复方案**:
```typescript
const timeoutMs = this.options.connectionPool?.requestTimeout || 30000;
```

**影响范围**: 无破坏性变更，行为更灵活

---

#### M5: HttpConnectionPoolManager 双重清理任务

**位置**: `src/pools/http.ts` 第 225-231 行 + `src/pools/pool.ts` 第 685-688 行

**现状**: `HttpConnectionPoolManager` 自身有 `startCleanupTasks()`，父类 `ConnectionPoolManager` 也有 `cleanupExpiredConnections()`。两者功能重叠。

**问题**: 
- 重复清理同一连接
- `httpCleanupInterval` 在 `destroy()` 中未被清理（子类 `destroy` 只调用 `super.destroy()`）

**修复方案**: 移除子类中的重复清理，统一使用父类逻辑。

**影响范围**: 内部实现，无破坏性变更

---

### 2.3 一般问题 (Minor) — 建议修复

#### m1: SingleProtocolServer.getHealthStatus 中 startTime 判断错误

**位置**: `src/server/serve.ts` 第 302 行

**现状**:
```typescript
const startTime = (this.serverInstance as any)?.startTime || Date.now();
```

**问题**: `startTime` 初始值为 `0`（falsy），总是回退到 `Date.now()`，导致 uptime 永远为 0。

**修复方案**:
```typescript
const startTime = (this.serverInstance as any)?.startTime ?? Date.now();
```

---

#### m2: waitingQueue 每次插入全量排序

**位置**: `src/pools/pool.ts` 第 300-305 行

**问题**: O(n log n) 排序，应改为插入时二分查找 O(log n)。

**修复方案**: 使用有序插入替代全量排序。

---

#### m3: ConfigHelper 重复的 SSL 迁移逻辑

**位置**: `src/config/config.ts` 中 5 个 `createXxxConfig` 方法

**问题**: 每个方法都有相同的 `ext.ssl → ssl` 迁移代码，违反 DRY。

**修复方案**: 提取公共方法 `migrateSSLConfig(options)`。

---

#### m4: GraphQL 协议处理逻辑重复

**位置**: `src/server/serve.ts` 第 129-136 行和第 465-483 行

**问题**: `initializeServerInstance` 和 `createServerInstance` 中都设置 `_underlyingProtocol`。

**修复方案**: 在 `createServerInstance` 中统一处理，`initializeServerInstance` 不再重复。

---

#### m5: gRPC RegisterService 日志过多

**位置**: `src/server/grpc.ts` 第 573-795 行

**问题**: 每次 gRPC 方法调用产生 5-8 条日志，含大量 `[GRPC_SERVER]` 前缀的 debug 日志。高 QPS 场景下即使不输出，参数求值也有开销。

**修复方案**: 移除开发调试日志，保留关键日志（调用开始、错误、超时）。

---

### 2.4 安全问题

#### S1: process.exit() 在库代码中

**位置**: `src/utils/terminus.ts` 和 `src/utils/terminus-manager.ts`

**问题**: 作为库不应直接调用 `process.exit()`，应将控制权交给调用者。

**修复方案（破坏性变更）**:

**选项 A（推荐，非破坏性）**: 保留 `process.exit()` 作为默认行为，但提供 `exitOnShutdown: boolean` 配置选项。

**选项 B（破坏性）**: 移除 `process.exit()`，改为抛出事件，由应用层决定是否退出。需要更新 koatty 主框架的关闭流程。

---

#### S2: 证书路径未做遍历检查

**位置**: `src/utils/cert-loader.ts`

**问题**: 未验证证书路径是否在预期目录内。

**修复方案**: 添加路径规范化和基目录检查：
```typescript
import path from 'path';
function validateCertPath(certPath: string, baseDir?: string): string {
  const resolved = path.resolve(certPath);
  if (baseDir) {
    const resolvedBase = path.resolve(baseDir);
    if (!resolved.startsWith(resolvedBase)) {
      throw new Error(`Certificate path outside allowed directory: ${certPath}`);
    }
  }
  return resolved;
}
```

---

### 2.5 类型安全问题

#### T1: BaseServer.server 声明为 any

**现状**: `readonly server: any`

**修复方案**: 使用泛型：
```typescript
export abstract class BaseServer<
  T extends ListeningOptions = ListeningOptions,
  S extends NativeServer = NativeServer
> {
  readonly server: S;
}
```

#### T2: ConnectionPoolManager 事件系统使用 Function

**现状**: `eventListeners = new Map<ConnectionPoolEvent, Set<Function>>`

**修复方案**: 定义事件回调类型映射：
```typescript
type ConnectionPoolEventData = {
  [ConnectionPoolEvent.CONNECTION_ADDED]: { connectionId: string; connection: any };
  [ConnectionPoolEvent.POOL_LIMIT_REACHED]: { currentConnections: number; maxConnections: number };
  // ...
};

on<E extends ConnectionPoolEvent>(event: E, listener: (data: ConnectionPoolEventData[E]) => void): void;
```

---

## 3. 优化优先级总览

| 编号 | 优先级 | 类别 | 问题 | 预估工时 | 破坏性 |
|------|--------|------|------|----------|--------|
| C1 | P0 | 资源泄漏 | 连接池定时器泄漏 | 1h | 无 |
| C3 | P0 | 竞态条件 | 双重关闭竞争 | 3h | 无 |
| C4 | P0 | 时序错误 | 构造函数初始化时序 | 2h | 无 |
| M1 | P0 | Bug | channelOptions 赋值错误 | 0.5h | 无 |
| C2 | P1 | 全局副作用 | setMaxListeners(0) | 0.5h | 无 |
| M2 | P1 | 缓存 | 工厂缓存键不稳定 | 1h | 无 |
| M3 | P1 | 指标 | errorRate 只增不减 | 1.5h | 无 |
| M4 | P1 | 配置 | gRPC 硬编码超时 | 0.5h | 无 |
| M5 | P1 | 重复 | 双重清理任务 | 1h | 无 |
| m1 | P2 | Bug | startTime falsy 判断 | 0.5h | 无 |
| m2 | P2 | 性能 | waitingQueue 排序 | 1h | 无 |
| m3 | P2 | DRY | SSL 迁移逻辑重复 | 1h | 无 |
| m4 | P2 | DRY | GraphQL 处理重复 | 0.5h | 无 |
| m5 | P2 | 性能 | gRPC 日志过多 | 1h | 无 |
| S1 | P2 | 安全 | process.exit() 在库中 | 2h | 可选 |
| S2 | P2 | 安全 | 证书路径检查 | 1h | 无 |
| T1 | P3 | 类型 | server 声明为 any | 2h | 无 |
| T2 | P3 | 类型 | 事件系统类型安全 | 1.5h | 无 |

**总预估工时**: ~22h

---

## 4. 实施原则

1. **先修 Bug，后做优化**: P0 问题优先，确保系统稳定
2. **每次只改一处**: 每个 PR 聚焦单一问题，便于回归
3. **测试先行**: 每个修复都先写/更新测试，确认问题存在，修复后确认通过
4. **非破坏性优先**: 所有修改尽量保持 API 兼容
5. **逐步类型化**: 类型改进可以分批进行，不影响运行时行为
