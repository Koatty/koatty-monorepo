# koatty-serve 分步构建计划

> 面向工程 LLM 的逐任务执行手册
> 版本: 1.0 | 日期: 2026-03-08
> 参考: [OPTIMIZATION_PLAN.md](./OPTIMIZATION_PLAN.md)

## 执行须知

- 每个任务独立完成，执行后运行测试验证
- 任务按依赖顺序排列，请严格按序执行
- 每个任务标注了涉及的文件、验证方法和预期结果
- `[破坏性变更]` 标签的任务提供了多个方案供选择
- 测试命令: `cd packages/koatty-serve && pnpm test`
- 构建命令: `cd packages/koatty-serve && pnpm build`

---

## Phase 1: 严重 Bug 修复 (P0)

### Task 1: 修复 ConnectionPoolManager 定时器泄漏

**问题**: `src/pools/pool.ts` 中 `startPeriodicTasks()` 的 `setInterval` 返回值未保存，`destroy()` 中无法清理，导致内存泄漏。

**涉及文件**:
- `src/pools/pool.ts`

**操作步骤**:
1. 在 `ConnectionPoolManager` 类中添加两个私有属性：
   ```typescript
   private healthCheckInterval?: NodeJS.Timeout;
   private cleanupInterval?: NodeJS.Timeout;
   ```
2. 修改 `startPeriodicTasks()` 方法，将 `setInterval` 返回值保存到这两个属性中
3. 对两个 interval 调用 `.unref()`，确保定时器不阻止进程退出
4. 在 `destroy()` 方法的 **最前面**（清理等待队列之前）添加清理逻辑：
   ```typescript
   if (this.healthCheckInterval) {
     clearInterval(this.healthCheckInterval);
     this.healthCheckInterval = undefined;
   }
   if (this.cleanupInterval) {
     clearInterval(this.cleanupInterval);
     this.cleanupInterval = undefined;
   }
   ```

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="pools/pool"` 通过
- 确认测试无 `--detectOpenHandles` 告警

**预期结果**: 连接池销毁后不再有残留定时器

---

### Task 2: 修复 createGrpcConfig 中 channelOptions 赋值错误

**问题**: `src/config/config.ts` 的 `createGrpcConfig` 方法中，`channelOptions` 被错误地赋值为 `options.connectionPool`，应为 `options.channelOptions`。

**涉及文件**:
- `src/config/config.ts`

**操作步骤**:
1. 找到 `createGrpcConfig` 方法中的 return 对象
2. 将 `channelOptions: options.connectionPool || {}` 修改为 `channelOptions: options.channelOptions || {}`

**当前代码** (约第 421 行):
```typescript
return {
  ...options,
  channelOptions: options.connectionPool || {},  // BUG
```

**修复后**:
```typescript
return {
  ...options,
  channelOptions: options.channelOptions || {},
```

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="config"` 通过
- 运行 `pnpm test -- --testPathPattern="server/grpc"` 通过

**预期结果**: gRPC 服务器使用正确的 channel 选项

---

### Task 3: 修复构造函数初始化时序 — BaseServer

**问题**: `BaseServer` 构造函数中调用 `initializeServer()`，但此时子类尚未完成配置处理，导致连接池使用未经处理的原始配置。

**涉及文件**:
- `src/server/base.ts`

**[破坏性变更 — 请选择方案]**

**方案 A（推荐 — 延迟初始化）**:
1. 在 `BaseServer` 构造函数中**移除** `this.initializeServer()` 调用
2. 将 `initializeServer()` 的访问修饰符从 `protected` 改为 `protected`（保持不变，但明确标注子类需要手动调用）
3. 在方法上方添加 JSDoc：`子类必须在构造函数最后手动调用此方法`

**方案 B（配置前置处理）**:
1. 保留 `BaseServer` 构造函数中的 `this.initializeServer()` 调用不变
2. 在 Task 4 中修改各子类将配置处理前置到 `super()` 调用之前

**操作步骤（方案 A）**:
1. 在 `BaseServer` 构造函数中删除 `this.initializeServer();` 这一行
2. 确保 `initializeServer()` 方法仍为 `protected`

**验证方法**:
- 此任务单独不能通过测试（子类还需更新），结合 Task 4 一起验证
- 确认 `pnpm run build` 编译无错误

**预期结果**: `BaseServer` 不再在构造函数中自动调用初始化

---

### Task 4: 修复构造函数初始化时序 — 所有子类

**问题**: 接续 Task 3，需要在所有协议子类中，在配置处理完成后手动调用 `initializeServer()`。

**涉及文件** (6 个子类):
- `src/server/http.ts`
- `src/server/https.ts`
- `src/server/http2.ts`
- `src/server/http3.ts`
- `src/server/grpc.ts`
- `src/server/ws.ts`

**操作步骤（配合 Task 3 方案 A）**:

对每个子类的构造函数，调整为以下顺序：
```typescript
constructor(app: KoattyApplication, options: XxxServerOptions) {
  super(app, options);                          // 1. 调用父类（不再自动初始化）
  this.options = ConfigHelper.createXxxConfig(options); // 2. 处理配置
  this.initializeServer();                      // 3. 手动初始化（配置已就绪）
  CreateTerminus(app, this);                    // 4. 注册 terminus
}
```

**操作步骤（配合 Task 3 方案 B）**:

对每个子类的构造函数，将配置处理移至 `super()` 之前：
```typescript
constructor(app: KoattyApplication, options: XxxServerOptions) {
  const processedOptions = ConfigHelper.createXxxConfig(options);
  super(app, processedOptions);                 // 配置已处理
  CreateTerminus(app, this);
}
```

注意：方案 B 中子类构造函数中不再需要 `this.options = ...` 赋值。

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="server/"` 全部通过
- 运行 `pnpm test` 全部通过

**预期结果**: 所有协议服务器使用正确处理后的配置初始化连接池

---

### Task 5: 统一关闭路径 — 移除 onSignal 中的重复信号逻辑

**问题**: `terminus.ts` 中的 `onSignal` 和 `TerminusManager.shutdownAll` 都会触发 `appStop` 并调用 `destroy()`，导致双重关闭。

**涉及文件**:
- `src/utils/terminus.ts`

**操作步骤**:
1. 移除 `terminus.ts` 中模块级的 `signalHandlers` Map 变量
2. 简化 `onSignal` 函数：不再自行触发 `appStop` 和 `process.exit`，改为仅被 `TerminusManager` 调用时的回调（保留函数签名以保持向后兼容，但清空内部信号处理逻辑）
3. 保留 `CreateTerminus` 仅注册到 `TerminusManager`（已是当前行为）
4. 保留 `BindProcessEvent` 和 `asyncEvent` 函数不变

**具体修改**:
- `onSignal` 函数改为：仅设置 `server.status = 503`，调用 `server.destroy()` 或 `server.Stop()`，不再调用 `asyncEvent(app, 'appStop')` 和 `process.exit()`
- 因为 `TerminusManager.shutdownAll` 已经负责这些工作

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="terminus"` 通过
- 运行 `pnpm test` 全部通过

**预期结果**: 信号处理只有一条路径，不再重复关闭

---

### Task 6: 统一关闭路径 — 调整 TerminusManager

**问题**: `TerminusManager.shutdownAll` 既触发 `appStop` 事件又直接调用 `server.destroy()`，与 `ServeComponent.stopServer`（监听 `appStop`）冲突。

**涉及文件**:
- `src/utils/terminus-manager.ts`

**操作步骤**:
1. 修改 `shutdownAll` 方法：
   - 保留触发 `appStop` 事件（`await asyncEvent(this.app, 'appStop')`）
   - **移除**直接调用 `server.destroy()` / `server.Stop()` 的循环
   - 因为 `ServeComponent.stopServer` 已监听 `appStop` 并负责停止所有服务器
2. 调整超时逻辑：在触发 `appStop` 后等待关闭完成，超时则强制退出

**修改后的 shutdownAll 核心逻辑**:
```typescript
private async shutdownAll(signal: string): Promise<void> {
  if (this.isShuttingDown) return;
  this.isShuttingDown = true;
  
  const forceTimeout = setTimeout(() => {
    Logger.Fatal('Could not close in time, forcefully shutting down');
    process.exit(1);
  }, 60000);

  try {
    if (this.app) {
      await asyncEvent(this.app, 'appStop');
      await asyncEvent(process, 'beforeExit');
    }
    clearTimeout(forceTimeout);
    process.exit(0);
  } catch (error) {
    clearTimeout(forceTimeout);
    process.exit(1);
  }
}
```

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="terminus"` 通过
- 运行 `pnpm test` 全部通过

**预期结果**: 关闭流程清晰：信号 → TerminusManager → appStop 事件 → ServeComponent.stopServer → 各服务器 Stop

---

### Task 7: 移除 process.setMaxListeners(0)

**问题**: `terminus.ts` 中模块级的 `process.setMaxListeners(0)` 关闭了 Node.js 内存泄漏检测。

**涉及文件**:
- `src/utils/terminus.ts`

**操作步骤**:
1. 删除 `process.setMaxListeners(0);` 这一行（约第 27 行）
2. 删除其上方的注释行

**前置条件**: Task 5 和 Task 6 已完成（统一信号处理后不再有重复注册问题）

**验证方法**:
- 运行 `pnpm test` 全部通过
- 确认无 MaxListenersExceededWarning 警告

**预期结果**: Node.js 恢复正常的监听器泄漏检测能力

---

## Phase 2: 重要问题修复 (P1)

### Task 8: 修复 ConnectionPoolFactory 缓存键不稳定

**问题**: `JSON.stringify` 对相同对象键顺序不同会产生不同字符串。

**涉及文件**:
- `src/pools/factory.ts`

**操作步骤**:
1. 找到 `create` 方法中的 `key` 计算（约第 33 行）
2. 添加排序键的辅助函数：
   ```typescript
   private static stableStringify(obj: any): string {
     if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
     if (Array.isArray(obj)) return JSON.stringify(obj.map(i => this.stableStringify(i)));
     const sortedKeys = Object.keys(obj).sort();
     return '{' + sortedKeys.map(k => `${JSON.stringify(k)}:${this.stableStringify(obj[k])}`).join(',') + '}';
   }
   ```
3. 将 `const key = ...` 修改为：
   ```typescript
   const key = `${protocol.toLowerCase()}_${ConnectionPoolFactory.stableStringify(config)}`;
   ```

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="pools/factory"` 通过
- 添加测试用例验证 `{ a:1, b:2 }` 和 `{ b:2, a:1 }` 产生相同缓存键

**预期结果**: 相同配置不同键顺序返回同一连接池实例

---

### Task 9: 修复 errorRate 只增不减

**问题**: 错误率只会增加到 1.0，永不衰减。

**涉及文件**:
- `src/pools/pool.ts`

**操作步骤**:
1. 在 `ConnectionPoolManager` 中添加错误窗口属性：
   ```typescript
   private errorWindow: RingBuffer<boolean>;  // true = error, false = success
   ```
2. 在构造函数中初始化：
   ```typescript
   this.errorWindow = new RingBuffer<boolean>(500);
   ```
3. 修改 `recordConnectionEvent` 方法：
   - `'added'` 事件: `this.errorWindow.push(false);`
   - `'error'` 事件: `this.errorWindow.push(true);`
   - 移除原有的 `this.metrics.errorRate = Math.min(...)` 逻辑
4. 添加私有方法计算滑动窗口错误率：
   ```typescript
   private calculateErrorRate(): number {
     if (this.errorWindow.length === 0) return 0;
     const errors = this.errorWindow.filter(isError => isError).length;
     return errors / this.errorWindow.length;
   }
   ```
5. 在 `updatePerformanceMetrics` 中调用：
   ```typescript
   this.metrics.errorRate = this.calculateErrorRate();
   ```

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="pools/pool"` 通过
- 验证：记录 10 个 error + 90 个 success → errorRate ≈ 0.1

**预期结果**: errorRate 反映真实的滑动窗口错误率

---

### Task 10: 修复 gRPC RegisterService 硬编码超时

**问题**: gRPC 方法调用超时硬编码为 30000ms。

**涉及文件**:
- `src/server/grpc.ts`

**操作步骤**:
1. 找到 `RegisterService` 方法中的 `const timeoutMs = 30000;`（约第 694 行）
2. 修改为从配置读取：
   ```typescript
   const timeoutMs = this.options.connectionPool?.requestTimeout || 30000;
   ```

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="server/grpc"` 通过

**预期结果**: gRPC 超时可通过 `connectionPool.requestTimeout` 配置

---

### Task 11: 移除 HttpConnectionPoolManager 重复清理任务

**问题**: 子类和父类都有清理空闲连接的定时器，功能重叠。

**涉及文件**:
- `src/pools/http.ts`

**操作步骤**:
1. 移除 `httpCleanupInterval` 属性
2. 移除 `startCleanupTasks()` 方法
3. 移除 `cleanupIdleConnections()` 方法
4. 从构造函数中移除 `this.startCleanupTasks()` 调用
5. `destroy()` 方法简化为仅调用 `super.destroy()`（已是如此，但移除多余代码后更清晰）

**原因**: 父类 `ConnectionPoolManager.startPeriodicTasks()` 已包含 `cleanupExpiredConnections()` 定时器，逻辑相同。

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="pools/http"` 通过
- 确认空闲连接仍能被正常清理（由父类定时器负责）

**预期结果**: 消除重复清理，减少一个 setInterval

---

## Phase 3: 一般问题修复 (P2)

### Task 12: 修复 startTime falsy 判断

**问题**: `startTime` 初始值为 0（falsy），`||` 运算符总是回退到 `Date.now()`。

**涉及文件**:
- `src/server/serve.ts`

**操作步骤**:
1. 找到 `getHealthStatus()` 方法中的（约第 302 行）：
   ```typescript
   const startTime = (this.serverInstance as any)?.startTime || Date.now();
   ```
2. 修改为使用空值合并运算符：
   ```typescript
   const startTime = (this.serverInstance as any)?.startTime ?? Date.now();
   ```

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="server/serve"` 通过

**预期结果**: 服务器启动后 uptime 正确计算，不再永远为 0

---

### Task 13: 提取 ConfigHelper 公共 SSL 迁移逻辑

**问题**: 5 个 `createXxxConfig` 方法中都有相同的 `ext.ssl → ssl` 迁移代码。

**涉及文件**:
- `src/config/config.ts`

**操作步骤**:
1. 在 `ConfigHelper` 类中添加私有静态方法：
   ```typescript
   private static migrateSSLFromExt(options: any): void {
     if (!options.ext) return;
     
     if (options.ext.ssl && !options.ssl) {
       this.logger.warn('options.ext.ssl is deprecated, please use options.ssl instead', {
         migration: 'Automatically migrated to options.ssl'
       });
       options.ssl = options.ext.ssl;
     }
     
     if (options.ext.ssl && options.ssl) {
       this.logger.warn('Both options.ssl and options.ext.ssl are set, using options.ssl', {
         note: 'options.ext.ssl is ignored'
       });
     }
   }
   ```
2. 在 `createHttpsConfig`、`createHttp2Config`、`createGrpcConfig`、`createHttp3Config`、`createWebSocketConfig` 中替换重复的迁移代码为 `this.migrateSSLFromExt(options);`

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="config"` 通过
- 运行 `pnpm test` 全部通过

**预期结果**: 消除重复代码，SSL 迁移逻辑集中在一处

---

### Task 14: 消除 GraphQL 协议处理重复

**问题**: `initializeServerInstance` 和 `createServerInstance` 中都设置 `_underlyingProtocol`。

**涉及文件**:
- `src/server/serve.ts`

**操作步骤**:
1. 在 `initializeServerInstance()` 方法中，移除 GraphQL 的 `_underlyingProtocol` 设置（约第 129-136 行的 if 块）
2. 保留 `createServerInstance()` 中的 GraphQL 处理逻辑作为唯一处理点
3. 确保 `initializeServerInstance` 中只保留 `ConfigHelper.configureSSLForProtocol` 调用和 `createServerInstance` 调用

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="server/serve"` 通过

**预期结果**: GraphQL 底层协议判断只在 `createServerInstance` 中执行

---

### Task 15: 精简 gRPC RegisterService 日志

**问题**: 每次 gRPC 调用产生过多 debug 日志，含 `[GRPC_SERVER]` 前缀。

**涉及文件**:
- `src/server/grpc.ts`

**操作步骤**:
1. 在 `RegisterService` 方法中，移除所有 `[GRPC_SERVER]` 前缀的 debug 日志（约 6-8 处）:
   - `'[GRPC_SERVER] Building wrapped implementation'`
   - `'[GRPC_SERVER] Wrapping method'`
   - `'[GRPC_SERVER] ⚡ Wrapped method called!'`
   - `'[GRPC_SERVER] Setting up timeout'`
   - `'[GRPC_SERVER] About to call app.callback("grpc")'`
   - `'[GRPC_SERVER] Calling app.callback("grpc") middleware handler'`
   - `'[GRPC_SERVER] app.callback middleware handler completed'`
   - `'[GRPC_SERVER] About to call server.addService'`
2. 保留以下关键日志不变：
   - `'Registering gRPC service'`（服务注册，info 级别）
   - `'gRPC method call started'`（调用开始，debug 级别）
   - `'gRPC method error'`（错误，error 级别）
   - `'gRPC method timeout'`（超时，error 级别）
   - `'gRPC method success'`（成功，debug 级别）
   - `'gRPC service registered successfully'`（注册完成，debug 级别）

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="server/grpc"` 通过

**预期结果**: 减少约 60% 的日志量，保留有意义的诊断信息

---

### Task 16: 优化 waitingQueue 插入排序

**问题**: 每次入队后 `O(n log n)` 全量排序。

**涉及文件**:
- `src/pools/pool.ts`

**操作步骤**:
1. 找到 `requestConnection` 方法中的排序代码（约第 300-305 行）
2. 移除全量排序代码块
3. 替换为有序插入：
   ```typescript
   // 按优先级有序插入（高优先级在前）
   const priorityWeight = { low: 1, normal: 2, high: 3 };
   const newPriority = priorityWeight[options.priority || 'normal'];
   
   let insertIndex = this.waitingQueue.length;
   for (let i = 0; i < this.waitingQueue.length; i++) {
     const existingPriority = priorityWeight[this.waitingQueue[i].options.priority || 'normal'];
     if (newPriority > existingPriority) {
       insertIndex = i;
       break;
     }
   }
   
   this.waitingQueue.splice(insertIndex, 0, { resolve, reject, options, timestamp: startTime });
   ```
4. 移除原有的 `this.waitingQueue.push(...)` 和 `this.waitingQueue.sort(...)` 调用

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="pools/pool"` 通过
- 验证：依次入队 low、high、normal → 出队顺序为 high、normal、low

**预期结果**: 插入操作从 O(n log n) 降为 O(n)

---

### Task 17: 添加证书路径安全检查

**问题**: 证书加载未做路径遍历检查。

**涉及文件**:
- `src/utils/cert-loader.ts`

**操作步骤**:
1. 在文件中添加路径验证辅助函数：
   ```typescript
   import path from 'path';
   
   function sanitizeCertPath(certPath: string): string {
     const resolved = path.resolve(certPath);
     // 防止路径遍历：确保解析后的路径不包含 '..' 组件
     if (resolved.includes('..') || certPath.includes('\0')) {
       throw new Error(`Invalid certificate path: potential path traversal detected`);
     }
     return resolved;
   }
   ```
2. 在 `loadCertificate` 函数（或同等入口函数）中，在读取文件之前调用 `sanitizeCertPath`
3. 如果函数 `isCertificateContent` 判定输入为内容（非路径），则跳过路径检查

**验证方法**:
- 运行 `pnpm test` 全部通过
- 验证：传入 `../../etc/passwd` 等路径时抛出错误

**预期结果**: 恶意证书路径被拒绝

---

## Phase 4: 安全与设计改进 (P2-P3)

### Task 18: 为 process.exit 添加可配置开关

**问题**: 库代码中直接调用 `process.exit()` 不符合库的最佳实践。

**涉及文件**:
- `src/utils/terminus-manager.ts`

**[破坏性变更 — 请选择方案]**

**方案 A（推荐 — 非破坏性）**:
1. 在 `TerminusManager` 中添加配置属性：
   ```typescript
   private exitOnShutdown = true;
   
   setExitOnShutdown(value: boolean): void {
     this.exitOnShutdown = value;
   }
   ```
2. 在 `shutdownAll` 中将 `process.exit(0)` 替换为：
   ```typescript
   if (this.exitOnShutdown) {
     process.exit(0);
   }
   ```
3. 对 `process.exit(1)` 做同样处理

**方案 B（破坏性）**:
1. 完全移除 `process.exit()` 调用
2. 改为 emit 事件，由应用层决定退出行为
3. 需要更新 koatty 主框架

**验证方法**:
- 运行 `pnpm test -- --testPathPattern="terminus"` 通过
- 默认行为不变（`exitOnShutdown = true`）

**预期结果**: 用户可选择是否在关闭时退出进程

---

### Task 19: BaseServer.server 类型改进

**问题**: `readonly server: any` 缺乏类型安全。

**涉及文件**:
- `src/server/base.ts`
- `src/server/http.ts`
- `src/server/https.ts`
- `src/server/http2.ts`
- `src/server/http3.ts`
- `src/server/grpc.ts`
- `src/server/ws.ts`

**操作步骤**:
1. 修改 `BaseServer` 泛型签名：
   ```typescript
   export abstract class BaseServer<
     T extends ListeningOptions = ListeningOptions,
     S = any
   > implements KoattyServer {
     readonly server: S;
   ```
2. 各子类指定具体类型：
   - `HttpServer extends BaseServer<HttpServerOptions, Server>`
   - `GrpcServer extends BaseServer<GrpcServerOptions, GrpcJsServer>`
   - `WsServer extends BaseServer<WebSocketServerOptions, WsServer>`
   - 等等
3. 逐步移除子类中的 `(this as any).server = ...` 断言

**注意**: 这是渐进式改进，可以先添加泛型参数但默认为 `any`，不影响现有代码编译。

**验证方法**:
- `pnpm run build` 编译通过
- `pnpm test` 全部通过

**预期结果**: 服务器实例的类型更精确，IDE 提供更好的自动补全

---

### Task 20: ConnectionPoolManager 事件类型安全

**问题**: 事件系统使用 `Function` 和 `any`，缺乏类型约束。

**涉及文件**:
- `src/pools/pool.ts`

**操作步骤**:
1. 定义事件数据类型映射：
   ```typescript
   export interface ConnectionPoolEventMap {
     [ConnectionPoolEvent.CONNECTION_ADDED]: { connectionId: string };
     [ConnectionPoolEvent.CONNECTION_REMOVED]: { connectionId: string; reason?: string };
     [ConnectionPoolEvent.CONNECTION_TIMEOUT]: { connectionId: string; timeout: number };
     [ConnectionPoolEvent.CONNECTION_ERROR]: { connectionId?: string; error: Error };
     [ConnectionPoolEvent.POOL_LIMIT_REACHED]: { currentConnections: number; maxConnections?: number };
     [ConnectionPoolEvent.HEALTH_STATUS_CHANGED]: { oldStatus: ConnectionPoolStatus; newStatus: ConnectionPoolStatus; health: ConnectionPoolHealth };
   }
   ```
2. 修改事件方法签名：
   ```typescript
   on<E extends ConnectionPoolEvent>(event: E, listener: (data: ConnectionPoolEventMap[E]) => void): void;
   off<E extends ConnectionPoolEvent>(event: E, listener: (data: ConnectionPoolEventMap[E]) => void): void;
   ```
3. 将 `eventListeners` 类型更新为：
   ```typescript
   protected eventListeners = new Map<ConnectionPoolEvent, Set<(data: any) => void>>();
   ```
4. 将 `eventListenerErrors` 的计数逻辑保持不变

**验证方法**:
- `pnpm run build` 编译通过
- `pnpm test` 全部通过

**预期结果**: 事件监听器有类型约束，IDE 能推断回调参数类型

---

## Phase 5: 回归验证

### Task 21: 完整回归测试

**问题**: 确保所有修改不破坏现有功能。

**操作步骤**:
1. 运行全量测试：`pnpm test`
2. 运行构建：`pnpm build`
3. 检查 lint：`pnpm run lint`
4. 检查是否有 skipped 测试可以恢复
5. 确认无 `--detectOpenHandles` 告警

**验证方法**:
- 所有测试通过
- 构建成功
- lint 无新增错误

**预期结果**: 所有优化完成，系统稳定

---

## 任务依赖图

```
Phase 1 (P0 Bug 修复):
  Task 1 (定时器泄漏)        ← 独立，可首先执行
  Task 2 (channelOptions)     ← 独立
  Task 3 (BaseServer 时序)    ← 独立，但需配合 Task 4
  Task 4 (子类时序)           ← 依赖 Task 3
  Task 5 (terminus 简化)      ← 独立，但建议与 Task 6 连续执行
  Task 6 (TerminusManager)    ← 依赖 Task 5
  Task 7 (setMaxListeners)    ← 依赖 Task 5 + Task 6

Phase 2 (P1 重要修复):
  Task 8 (缓存键)             ← 独立
  Task 9 (errorRate)          ← 独立，但与 Task 1 同文件，建议在其后
  Task 10 (gRPC 超时)         ← 独立
  Task 11 (重复清理)          ← 依赖 Task 1（确保父类定时器正常）

Phase 3 (P2 一般修复):
  Task 12 (startTime)         ← 独立
  Task 13 (SSL 迁移)          ← 独立
  Task 14 (GraphQL 重复)      ← 独立
  Task 15 (gRPC 日志)         ← 独立
  Task 16 (队列排序)          ← 独立，但与 Task 9 同文件
  Task 17 (证书安全)          ← 独立

Phase 4 (P2-P3 设计改进):
  Task 18 (exit 开关)         ← 依赖 Task 6
  Task 19 (server 类型)       ← 依赖 Task 4
  Task 20 (事件类型)          ← 依赖 Task 9

Phase 5 (回归):
  Task 21 (回归测试)          ← 依赖所有前序任务
```

---

## 执行检查清单

| # | 任务 | Phase | 依赖 | 状态 |
|---|------|-------|------|------|
| 1 | 修复连接池定时器泄漏 | P0 | 无 | ☐ |
| 2 | 修复 channelOptions 赋值 | P0 | 无 | ☐ |
| 3 | 修复 BaseServer 时序 | P0 | 无 | ☐ |
| 4 | 修复所有子类时序 | P0 | Task 3 | ☐ |
| 5 | 简化 terminus.ts | P0 | 无 | ☐ |
| 6 | 调整 TerminusManager | P0 | Task 5 | ☐ |
| 7 | 移除 setMaxListeners(0) | P0 | Task 5,6 | ☐ |
| 8 | 修复缓存键不稳定 | P1 | 无 | ☐ |
| 9 | 修复 errorRate 只增不减 | P1 | Task 1 | ☐ |
| 10 | gRPC 超时可配置 | P1 | 无 | ☐ |
| 11 | 移除重复清理任务 | P1 | Task 1 | ☐ |
| 12 | 修复 startTime 判断 | P2 | 无 | ☐ |
| 13 | 提取 SSL 迁移逻辑 | P2 | 无 | ☐ |
| 14 | 消除 GraphQL 重复 | P2 | 无 | ☐ |
| 15 | 精简 gRPC 日志 | P2 | 无 | ☐ |
| 16 | 优化队列排序 | P2 | 无 | ☐ |
| 17 | 证书路径安全检查 | P2 | 无 | ☐ |
| 18 | process.exit 开关 | P2 | Task 6 | ☐ |
| 19 | server 类型改进 | P3 | Task 4 | ☐ |
| 20 | 事件类型安全 | P3 | Task 9 | ☐ |
| 21 | 完整回归测试 | 回归 | 全部 | ☐ |
