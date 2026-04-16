# Koatty 框架适配 Bun.js 平台可行性评估报告

> 评估日期: 2026-04-16
> 评估范围: koatty-monorepo 全部 24 个包
> 目标平台: Bun.js (2026 LTS)

## 一、评估概要

| 维度 | 结论 |
|------|------|
| **整体可行性** | **有条件可行** — HTTP 模式基本可行，gRPC/HTTP3 模式风险较高 |
| **评估包数量** | 24 个包 |
| **无需修改** | 8 个包 (33%) |
| **需少量适配** | 10 个包 (42%) |
| **需重大改造** | 4 个包 (17%) |
| **存在阻断风险** | 2 个包 (8%) |
| **预估工作量** | 3-5 人月（含测试） |

---

## 二、逐包兼容性分析

### 第一梯队：无需修改 / 直接兼容 ✅

| 包名 | 理由 |
|------|------|
| **koatty_container** | 纯 JS 实现，无 Node.js 内置模块依赖，仅用 `lru-cache` + `reflect-metadata` + `globalThis` |
| **koatty_cacheable** | 无直接 Node.js API 调用，委托 `koatty_store` |
| **koatty_exception** | 仅用 `http.ServerResponse` 类型引用，运行时无深度依赖 |
| **koatty_validation** | 依赖 `class-validator` + `reflect-metadata` + `performance.now()`，Bun 全部支持 |
| **koatty_store** | `ioredis` + `lru-cache` + `EventEmitter`，Bun 全部兼容 |
| **koatty_swagger** | 文档生成工具，无运行时 Node 依赖 |
| **koatty_doc** | 文档工具 |
| **koatty_testing** | 仅用 `process.env`，`supertest` 兼容 |

### 第二梯队：需少量适配 ⚠️

| 包名 | 需适配项 | 工作量 |
|------|---------|--------|
| **koatty_lib** | `process.getuid()`/`process.getgid()` 需条件判断；`require(file)` 动态加载需测试 | 0.5 天 |
| **koatty_config** | `crypto.createCipheriv`/`scryptSync` 需验证 Bun crypto 兼容性；`require("run-con")` CJS 加载 | 1 天 |
| **koatty_logger** | `winston` + `winston-daily-rotate-file` 兼容但需验证文件轮转；`setImmediate` Bun 支持 | 1 天 |
| **koatty_loader** | `globby@11` (CJS) + `require()` 动态模块加载需验证 | 0.5 天 |
| **koatty_schedule** | `cron` 库兼容；`ioredis` 兼容；`@sesamecare-oss/redlock` 需验证 | 1 天 |
| **koatty_typeorm** | TypeORM 基本兼容但数据库驱动可能有边界问题；`AsyncLocalStorage` Bun 已支持 | 2 天 |
| **koatty_graphql** | `fs.readFileSync` + `graphql` 核心库，Bun 支持 | 0.5 天 |
| **koatty_serverless** | `http.IncomingMessage` + `net.Socket` 模拟，需验证 | 1 天 |
| **koatty (主包)** | `__dirname` Bun 支持；`require("../../package.json")` 需验证；`ts-morph` 需验证 | 1 天 |
| **koatty_proto** | `@grpc/proto-loader` + `protobufjs` 文件加载需验证 | 1 天 |

### 第三梯队：需重大改造 🔶

| 包名 | 核心问题 | 工作量 |
|------|---------|--------|
| **koatty_core** | 1. 继承 `Koa` (Koa@3 兼容但需全面测试) 2. `AsyncLocalStorage` (已支持) 3. `process.execArgv` 调试检测 4. `process.on('uncaughtException'/'unhandledRejection')` 全局错误处理 5. `http`/`http2`/`https` 类型系统 | 5 天 |
| **koatty_router** | 1. `@koa/router` 路由核心 2. gRPC 流式处理（ServerStreaming/ClientStreaming/Bidirectional）依赖 `@grpc/grpc-js` 3. WebSocket 路由 (`ws` 库) 4. GraphQL 路由 5. `formidable` 文件上传 | 5 天 |
| **koatty_serve** | 1. `http.createServer`/`https.createServer` (兼容) 2. `http2.createSecureServer` (Bun 有已知缺陷) 3. **`@grpc/grpc-js` gRPC 服务器** (HTTP/2 边界问题) 4. `ws` WebSocket 服务器 5. **`@matrixai/quic` HTTP/3** (高风险) 6. TLS 证书加载 | 10 天 |
| **koatty_ai** | 大量 `require()`/`__dirname`/`fs`/`child_process` 用法，CLI 工具链 | 3 天 |

### 第四梯队：存在阻断风险 ❌

| 包名 | 阻断原因 | 严重程度 |
|------|---------|---------|
| **koatty_trace** | 1. **`@opentelemetry/sdk-node` 官方不支持 Bun**，auto-instrumentation 依赖 Node.js 模块加载钩子 2. `@opentelemetry/auto-instrumentations-node` 通过 monkey-patch 注入，Bun 行为不一致 3. `@opentelemetry/instrumentation-koa` 需要 CJS 模块拦截 4. `node:zlib` 压缩用于 gRPC 响应 5. `node:stream.Transform` 用于 gRPC 流处理 | **关键** |
| **koatty_serve (HTTP/3)** | `@matrixai/quic` 是 Rust/C++ 原生绑定（通过 `quiche`），Bun 对原生 Zig/C++ 绑定的支持与 Node-API 不完全一致 | **严重** |

---

## 三、关键依赖兼容性矩阵

| 依赖 | Bun 兼容性 | 说明 |
|------|-----------|------|
| `koa` @3 | ✅ 兼容 | Bun 作为 Node.js 兼容层运行 Koa |
| `@koa/router` | ✅ 兼容 | 纯 JS 路由匹配 |
| `koa-compose` | ✅ 兼容 | 纯 JS 中间件组合 |
| `reflect-metadata` | ⚠️ 需配置 | 必须在 `tsconfig.json` 根级显式配置 `emitDecoratorMetadata: true` |
| `@grpc/grpc-js` | ⚠️ 有风险 | 基本功能可用，但流控/代理/ALB 场景存在 HTTP/2 边界问题 |
| `@grpc/proto-loader` | ⚠️ 需验证 | 内部使用 `fs` + `protobufjs`，需测试 .proto 文件加载 |
| `@opentelemetry/sdk-node` | ❌ 不兼容 | 官方不支持 Bun，auto-instrumentation 依赖 Node.js 特有的模块加载机制 |
| `@opentelemetry/auto-instrumentations-node` | ❌ 不兼容 | 依赖 `--require` 预加载和 CJS monkey-patching |
| `@matrixai/quic` | ❌ 高风险 | Rust 原生绑定 (quiche)，Bun NAPI 兼容性未验证 |
| `ws` | ✅ 兼容 | Bun 也有原生 WebSocket，`ws` 包可通过 Node 兼容层运行 |
| `winston` | ✅ 兼容 | 自 Bun 0.6.5 起支持 |
| `winston-daily-rotate-file` | ⚠️ 需验证 | 依赖 `fs.watch`/文件系统事件 |
| `ioredis` | ✅ 兼容 | Bun 另有内置 `Bun.redis` 可选 |
| `typeorm` | ⚠️ 有风险 | 基本可用，数据库驱动层可能有边界问题 |
| `class-validator` | ✅ 兼容 | 纯 JS 实现 |
| `lru-cache` | ✅ 兼容 | 纯 JS 实现 |
| `formidable` | ⚠️ 需验证 | 文件上传解析，依赖 `fs` 临时文件 |
| `globby` @11 | ✅ 兼容 | CJS 版本，Bun 支持 |
| `ts-morph` | ⚠️ 需验证 | AST 操作，依赖 TypeScript compiler API |
| `cron` | ✅ 兼容 | 纯 JS 实现 |
| `@sesamecare-oss/redlock` | ✅ 兼容 | 基于 ioredis |
| `supertest` | ✅ 兼容 | 测试工具 |

---

## 四、Node.js API 使用情况与 Bun 支持度

| Node.js API | 使用包 | Bun 支持 |
|-------------|--------|---------|
| `http.createServer` | koatty_serve | ✅ |
| `https.createServer` | koatty_serve | ✅ |
| `http2.createSecureServer` | koatty_serve | ⚠️ 有缺陷 |
| `AsyncLocalStorage` | koatty_core, koatty_trace, koatty_typeorm | ✅ |
| `AsyncResource` | koatty_trace | ✅ |
| `EventEmitter` | koatty_core, koatty_store | ✅ |
| `crypto.*` | koatty_lib, koatty_config, koatty_serve, koatty_schedule, koatty_trace | ✅ |
| `fs.*` / `fs.promises.*` | koatty_lib, koatty_config, koatty_graphql, koatty_router | ✅ |
| `path.*` | 多个包 | ✅ |
| `stream.Transform/Readable` | koatty_trace | ✅ |
| `zlib.*` | koatty_trace | ✅ |
| `util.format/inspect` | koatty_logger, koatty_trace | ✅ |
| `perf_hooks.performance` | koatty_trace, koatty_validation | ✅ |
| `net.Socket` | koatty_serverless | ✅ |
| `tls.TLSSocket` | koatty_serve | ✅ |
| `process.getuid/getgid` | koatty_lib, koatty_serve | ⚠️ 已有条件判断 |
| `process.execArgv` | koatty_core | ⚠️ 需验证 |
| `process.on('signal')` | 多个包 | ✅ |
| `setImmediate` | koatty_logger, koatty_typeorm | ✅ |
| `require()` 动态加载 | koatty, koatty_loader, koatty_lib, koatty_config | ✅ Bun 支持 CJS |
| `__dirname` | koatty, koatty_ai | ✅ Bun 支持 |
| `Buffer` | koatty_core, koatty_serve, koatty_config, koatty_serverless | ✅ |

---

## 五、核心风险评估

### 风险 1: OpenTelemetry 不兼容 (关键/阻断)

`koatty_trace` 是框架的可观测性核心，深度依赖 OpenTelemetry Node.js SDK：
- `@opentelemetry/sdk-node` 官方不支持 Bun
- auto-instrumentation 依赖 Node.js 的 `--require` 预加载和 CJS 模块拦截
- `@opentelemetry/instrumentation-koa` 需要运行时 monkey-patch Koa 中间件

**影响**: 在 Bun 上将**丢失自动链路追踪、指标采集、Prometheus 导出**等核心可观测能力。

**缓解方案**:
1. 手动初始化 OpenTelemetry SDK (Programmatic initialization)
2. 移除 auto-instrumentation，改用手动 span 创建
3. 使用 Bun `--preload` 替代 `--require`
4. 预估额外工作量：5-8 天

### 风险 2: gRPC 稳定性 (高风险)

`koatty_serve` 和 `koatty_router` 实现了完整的 gRPC 服务器：
- Bun 的 `node:http2` 实现存在已知的流控制、帧处理问题
- 在 ALB/Envoy 代理后可能出现 Protocol Error
- 双向流 (Bidirectional Streaming) 是最高风险场景

**影响**: gRPC 协议在生产环境可能**不稳定**。

**缓解方案**:
1. 仅在 HTTP/HTTPS 模式下使用 Bun
2. gRPC 服务继续使用 Node.js 运行
3. 考虑 Connect Protocol (`@connectrpc/connect-es`) 作为替代
4. 预估额外工作量：若需完整适配 gRPC，10-15 天

### 风险 3: HTTP/3 (QUIC) 不可用 (高风险)

`@matrixai/quic` 是 Rust 原生绑定：
- 通过 `quiche` C 库实现 QUIC
- Bun 的 NAPI 兼容层可能无法正确加载
- 无社区验证案例

**影响**: HTTP/3 协议在 Bun 上**几乎确定不可用**。

**缓解方案**:
1. 将 HTTP/3 标记为 Bun 不支持的实验性功能
2. 等待 Bun 原生 QUIC 支持

### 风险 4: Decorator Metadata 稳定性 (中风险)

整个框架重度依赖 `reflect-metadata` + `emitDecoratorMetadata`：
- Bun 支持但在版本更新中可能出现行为变化
- IoC 容器 (`koatty_container`) 所有注入都依赖此机制
- `@Autowired`, `@Inject`, `@Config`, `@Scheduled`, `@Transactional` 等核心装饰器均受影响

**影响**: Bun 版本升级可能导致**依赖注入系统异常**。

**缓解方案**:
1. 锁定 Bun 版本
2. 确保 `tsconfig.json` 根级显式配置
3. 完善 CI 测试矩阵

---

## 六、实施路径建议

### 方案 A: 渐进式适配 (推荐)

分三个阶段，按协议模式逐步迁移：

**Phase 1 — HTTP 模式 (2-3 周)**

```
目标: 仅 HTTP/HTTPS + WebSocket 模式在 Bun 上运行
涉及包: koatty, koatty_core, koatty_serve(HTTP/WS), koatty_container,
        koatty_lib, koatty_config, koatty_loader, koatty_logger,
        koatty_router(HTTP/WS/GraphQL), koatty_validation,
        koatty_exception, koatty_store, koatty_cacheable
工作内容:
  1. 创建 Bun 兼容性测试矩阵
  2. 解决 reflect-metadata 配置问题
  3. 验证 Koa@3 + 中间件链在 Bun 下的行为
  4. 验证 WebSocket (ws 库) 兼容性
  5. 替换/适配不兼容的 process API
  6. 集成测试
```

**Phase 2 — 可观测性适配 (2-3 周)**

```
目标: koatty_trace 在 Bun 上恢复核心功能
工作内容:
  1. 移除 auto-instrumentation 依赖
  2. 实现 programmatic SDK 初始化
  3. 手动 instrument Koa 中间件
  4. 验证 Prometheus 指标导出
  5. 验证 OTLP trace 导出
  6. 使用 Bun --preload 替代 --require
```

**Phase 3 — gRPC 模式 (3-4 周，可选)**

```
目标: gRPC 服务在 Bun 上基本可用
工作内容:
  1. 验证 @grpc/grpc-js 在 Bun 下的基本 RPC
  2. 测试四种流模式 (Unary/Server/Client/Bidi)
  3. 测试 TLS 证书加载
  4. 压力测试和稳定性验证
  5. 记录已知限制和回退方案
```

### 方案 B: 双运行时支持

在框架层面引入运行时检测，同时支持 Node.js 和 Bun：

```typescript
// 运行时检测
const isBun = typeof Bun !== 'undefined';
const runtime = isBun ? 'bun' : 'node';

// 条件特性启用
const features = {
  grpc: runtime === 'node',      // gRPC 仅 Node.js
  http3: runtime === 'node',     // HTTP/3 仅 Node.js
  autoTrace: runtime === 'node', // 自动追踪仅 Node.js
  http: true,                    // HTTP 双运行时
  websocket: true,               // WebSocket 双运行时
  graphql: true,                 // GraphQL 双运行时
};
```

---

## 七、不建议迁移的功能

| 功能 | 原因 | 替代方案 |
|------|------|---------|
| HTTP/3 (QUIC) | `@matrixai/quic` 原生绑定不兼容 | 等待 Bun 原生支持或保留 Node.js |
| OpenTelemetry Auto-Instrumentation | 官方不支持，机制不兼容 | 手动 Instrumentation |
| gRPC Bidirectional Streaming | Bun HTTP/2 流控不完善 | 使用 Connect Protocol 或保留 Node.js |

---

## 八、结论

Koatty 框架适配 Bun.js **在 HTTP/WebSocket/GraphQL 模式下可行**，核心的 IoC 容器、配置管理、验证、缓存、调度等基础组件均可正常工作。

但 **gRPC 和 OpenTelemetry 是两个关键阻断点**：
- gRPC 依赖 Bun 尚未完全成熟的 HTTP/2 实现
- OpenTelemetry 官方不支持 Bun 运行时

**推荐策略**: 采用方案 A (渐进式适配)，先保障 HTTP 模式在 Bun 上的完整可用性，再根据 Bun 生态的发展逐步扩展 gRPC 支持。对于需要全协议支持的生产环境，建议采用方案 B (双运行时)，允许用户根据业务场景选择运行时。
