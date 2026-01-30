# Koatty-Trace 架构设计

## 🏗️ 设计原则

**核心原则**: Koatty-Trace 是一个纯粹的 Middleware

> Koatty-Trace 整个模块就是一个中间件，不需要单独的 Component

## 📊 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      Koatty Application                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Loader.LoadMiddlewares()                      │  │
│  │  ┌──────────────────────────────────────────────┐    │  │
│  │  │  const tracer = Trace(options, app)          │    │  │
│  │  │  app.use(tracer)                             │    │  │
│  │  └──────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────┘  │
│                            ↓                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Trace(options, app) 函数                      │  │
│  │  ┌──────────────────────────────────────────────┐    │  │
│  │  │  创建阶段（执行1次）:                        │    │  │
│  │  │                                               │    │  │
│  │  │  1. 初始化 OpenTelemetry SDK                 │    │  │
│  │  │  2. 初始化 Prometheus Metrics                │    │  │
│  │  │  3. 初始化 SpanManager                       │    │  │
│  │  │  4. 监听 appStart 事件启动 Tracer            │    │  │
│  │  │  5. 监听 appStop 事件清理资源                │    │  │
│  │  │                                               │    │  │
│  │  │  ↓ 返回 middleware 函数                      │    │  │
│  │  │                                               │    │  │
│  │  │  请求处理（每个请求执行）:                   │    │  │
│  │  │                                               │    │  │
│  │  │  1. 生成 requestId                           │    │  │
│  │  │  2. 初始化请求属性（startTime等）            │    │  │
│  │  │  3. 创建 Span（使用闭包中的资源）            │    │  │
│  │  │  4. 记录拓扑关系                             │    │  │
│  │  │  5. 调用 Handler 处理请求                    │    │  │
│  │  │  6. 记录日志                                 │    │  │
│  │  │  7. 收集指标                                 │    │  │
│  │  └──────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 🔄 生命周期流程

### 应用启动流程

```
1. App.init()
     ↓
2. Loader.LoadMiddlewares()
     ↓ 创建 Trace 中间件
     ├─ tracer = Trace(options, app)
     │    ↓
     │    ├─ 初始化 Prometheus (如果启用)
     │    ├─ 初始化 SpanManager (如果启用)
     │    ├─ 初始化 OpenTelemetry SDK (如果启用)
     │    ├─ 注册 appStart 监听器（启动 Tracer）
     │    └─ 注册 appStop 监听器（清理资源）
     │    ↓
     │    └─ 返回 middleware 函数（闭包保持对资源的引用）
     │
     └─ app.use(tracer)  ← 注册中间件
     ↓
3. emit(AppEvent.appStart)
     ↓ 触发 Trace 注册的 appStart 监听器
     └─ 启动 Tracer (app.otelTracer)
     ↓
4. App.listen()
     ↓
5. 应用就绪 ✅
```

### 请求处理流程

```
HTTP/gRPC Request
     ↓
app.callback()
     ↓
Trace Middleware (每个请求都经过)
     ├─ 1. 生成 requestId
     ├─ 2. 初始化 ctx.startTime, ctx.requestId
     ├─ 3. 使用闭包中的 spanManager 和 tracer
     ├─ 4. 创建 Span（如果启用）
     ├─ 5. 调用 next() → 业务逻辑
     ├─ 6. 记录日志
     ├─ 7. 收集指标
     └─ 8. 结束 Span
     ↓
Response ✅
```

### 应用关闭流程

```
1. SIGTERM/SIGINT
     ↓
2. emit(AppEvent.appStop)
     ↓ 触发 Trace 注册的 appStop 监听器
     ├─ 清理 SpanManager
     ├─ 关闭 OpenTelemetry SDK
     ├─ 关闭 Prometheus
     └─ 清理所有追踪资源
     ↓
3. App.stop()
     ↓
4. 进程退出 ✅
```

## 📦 核心代码结构

### Trace Middleware 函数

**位置**: `src/trace/trace.ts`

```typescript
export function Trace(options: TraceOptions, app: Koatty) {
  options = { ...defaultOptions, ...options };
  
  // ============================================
  // 阶段1: 应用级别初始化（函数执行时，只执行1次）
  // ============================================
  let spanManager: SpanManager | undefined;
  let sdk: any;
  let metricsProvider: any;

  // 1. 初始化 Prometheus Metrics
  if (options.enableTrace && options.metricsConf?.metricsEndpoint) {
    metricsProvider = initPrometheusExporter(app, options);
  }

  // 2. 初始化 SpanManager
  if (options.enableTrace) {
    spanManager = new SpanManager(options);
    Helper.define(app, 'spanManager', spanManager);
  }

  // 3. 初始化 OpenTelemetry SDK
  if (options.enableTrace) {
    sdk = initSDK(app, options);
    Helper.define(app, 'otelSDK', sdk);

    // 4. 监听 appStart 事件启动 Tracer
    app.once(AppEvent.appStart, async () => {
      await startTracer(sdk, app, options);
      const tracer = sdk.getTracer();
      Helper.define(app, 'otelTracer', tracer);
    });
  }

  // 5. 监听 appStop 事件清理资源
  app.once(AppEvent.appStop, async () => {
    if (spanManager) spanManager.destroy();
    if (sdk) await sdk.shutdown();
    if (metricsProvider) { /* cleanup */ }
  });

  // ============================================
  // 阶段2: 返回 Middleware 函数（每个请求执行）
  // ============================================
  return async (ctx: KoattyContext, next: KoattyNext) => {
    // 1. 生成 requestId
    const requestId = getRequestId(ctx, options);
    initializeRequestProperties(ctx, requestId);

    // 2. 使用闭包中的资源创建 Span
    if (options.enableTrace && spanManager) {
      const tracer = app.otelTracer;
      if (tracer) {
        spanManager.createSpan(tracer, ctx, app.name);
      }
    }

    // 3. 处理请求
    const handler = HandlerFactory.getHandler(protocol);
    return handler.handle(ctx, next, ext);
  };
}
```

**关键特性**:
- 📍 **两阶段设计**:
  - 阶段1: 函数执行时初始化（1次）
  - 阶段2: 返回 middleware 处理请求（N次）
- 🔧 **闭包模式**: middleware 通过闭包访问初始化的资源
- 🎯 **生命周期管理**: 通过事件监听器管理资源生命周期
- 📦 **无需 Component**: 所有逻辑都在 middleware 创建函数中完成

---

### Handler (协议处理器)

**位置**: `src/handler/{http.ts, grpc.ts, ws.ts}`

**职责**:
```typescript
export class HttpHandler extends BaseHandler {
  async handle(ctx, next, ext) {
    try {
      // 处理请求
    } catch (error) {
      // 错误处理
    } finally {
      // 记录日志（只记录一次）
      // 结束追踪
      // 收集指标
    }
  }
}
```

## 🎯 关键设计决策

### 为什么不需要 Component？

**之前的复杂设计**:
```typescript
// ❌ TraceComponent.ts (已删除)
@Component('TraceComponent')
export class TraceComponent {
  @OnEvent(AppEvent.appStart)
  async run(app) {
    // 初始化 OpenTelemetry
  }
  
  @OnEvent(AppEvent.appStop)
  async stopTrace(app) {
    // 清理资源
  }
}

// Loader.ts
app.use(Trace(options, app));  // 注册中间件
```

**问题**:
1. 架构过于复杂：Component + Middleware 两层
2. 职责分散：初始化在 Component，处理在 Middleware
3. 资源传递繁琐：需要通过 app 对象传递

**现在的简洁设计**:
```typescript
// ✅ 只有 Trace Middleware
// trace.ts
export function Trace(options, app) {
  // 1. 初始化所有资源（闭包）
  const spanManager = new SpanManager();
  const sdk = initSDK(app, options);
  
  // 2. 监听生命周期事件
  app.once(AppEvent.appStart, async () => { /* 启动 */ });
  app.once(AppEvent.appStop, async () => { /* 清理 */ });
  
  // 3. 返回 middleware
  return async (ctx, next) => {
    // 使用闭包中的资源
  };
}

// Loader.ts
app.use(Trace(options, app));  // ✅ 一次搞定
```

**优势**:
1. 架构简洁：只有一个 Middleware
2. 职责集中：初始化和处理都在 Trace 函数中
3. 闭包优雅：资源自然传递，无需 app 对象

### 闭包模式 vs 全局状态

**闭包模式（当前采用）**:
```typescript
export function Trace(options, app) {
  const spanManager = new SpanManager();  // 闭包变量
  
  return async (ctx, next) => {
    spanManager.createSpan(...);  // 直接访问闭包变量
  };
}
```

**优势**:
- ✅ 类型安全：TypeScript 可以推断类型
- ✅ 作用域清晰：资源只在 middleware 闭包中可见
- ✅ 无污染：不污染 app 对象
- ✅ 易测试：可以 mock 闭包变量

**全局状态（不推荐）**:
```typescript
// ❌ 不推荐
export function Trace(options, app) {
  app.spanManager = new SpanManager();  // 全局状态
  
  return async (ctx, next) => {
    app.spanManager.createSpan(...);  // 通过 app 访问
  };
}
```

**缺点**:
- ❌ 类型不安全：需要类型断言
- ❌ 污染 app：app 对象被修改
- ❌ 测试困难：需要 mock 整个 app

### 为什么在函数创建时初始化？

**备选方案1: 在 appStart 时初始化（不推荐）**
```typescript
// ❌ 延迟初始化
export function Trace(options, app) {
  let spanManager: SpanManager;
  
  app.once(AppEvent.appStart, () => {
    spanManager = new SpanManager();  // 太晚了
  });
  
  return async (ctx, next) => {
    // spanManager 可能还未初始化！
    if (spanManager) { /* ... */ }
  };
}
```

**问题**: 请求到来时资源可能还未初始化

**当前方案: 函数创建时初始化（推荐）**
```typescript
// ✅ 立即初始化
export function Trace(options, app) {
  const spanManager = new SpanManager();  // 立即初始化
  
  app.once(AppEvent.appStart, async () => {
    await startTracer(sdk, app, options);  // 只启动异步操作
  });
  
  return async (ctx, next) => {
    spanManager.createSpan(...);  // 资源一定存在
  };
}
```

**优势**: 资源在 middleware 注册时就已经可用

## 🔧 核心模块

### 1. Trace Middleware 创建函数

```typescript
export function Trace(options: TraceOptions, app: Koatty) {
  // ============================================
  // 创建阶段（执行1次）
  // ============================================
  
  // 初始化资源
  let spanManager: SpanManager | undefined;
  let sdk: any;
  let metricsProvider: any;
  
  // 设置生命周期监听
  app.once(AppEvent.appStart, async () => { /* ... */ });
  app.once(AppEvent.appStop, async () => { /* ... */ });
  
  // ============================================
  // 请求处理（每个请求执行）
  // ============================================
  
  return async (ctx: KoattyContext, next: KoattyNext) => {
    // 使用闭包中的资源处理请求
  };
}
```

**关键特性**:
- 📍 **生命周期**: 创建1次 → 处理N次请求
- 🎯 **执行次数**: 
  - 初始化: 1次
  - 请求处理: N次
- 🔧 **职责**: 
  - 初始化所有追踪基础设施
  - 处理每个请求的追踪
- 📦 **产出**: 返回 middleware 函数

---

### 2. SpanManager

**位置**: `src/opentelemetry/spanManager.ts`

**职责**: 管理 OpenTelemetry Span 的创建和生命周期

---

### 3. Handler

**位置**: `src/handler/{http.ts, grpc.ts, ws.ts}`

**职责**: 特定协议的请求处理逻辑

## 📁 文件组织

```
packages/koatty-trace/
├── src/
│   ├── trace/
│   │   └── trace.ts               ← 核心 Middleware（唯一入口）
│   ├── handler/
│   │   ├── http.ts                ← HTTP 协议处理
│   │   ├── grpc.ts                ← gRPC 协议处理
│   │   └── ws.ts                  ← WebSocket 协议处理
│   ├── opentelemetry/
│   │   ├── sdk.ts                 ← OpenTelemetry SDK 初始化
│   │   ├── spanManager.ts         ← Span 管理
│   │   └── prometheus.ts          ← Prometheus 集成
│   └── utils/
│       └── contextInit.ts         ← 上下文初始化工具
└── docs/
    └── ARCHITECTURE.md            ← 本文档
```

**注意**: 已删除 `TraceComponent.ts`，不再需要 Component

## 🔑 关键接口

### Trace 函数签名

```typescript
export function Trace(
  options: TraceOptions,
  app: Koatty
): (ctx: KoattyContext, next: KoattyNext) => Promise<any>
```

### Middleware 传递给 Handler 的上下文

```typescript
interface extensionOptions {
  debug: boolean;
  timeout: number;
  encoding: string;
  requestId: string;
  spanManager?: SpanManager;   // 从闭包传递
  globalErrorHandler: any;
  terminated: boolean;
}
```

## ✅ 设计优势

### 1. 架构简洁

| 设计 | 文件数 | 复杂度 | 可维护性 |
|------|--------|--------|----------|
| 旧设计 (Component + Middleware) | 2个核心文件 | 高 | 中 |
| 新设计 (纯 Middleware) | 1个核心文件 | 低 | 高 |

### 2. 代码更少

```
旧设计:
- TraceComponent.ts: ~135 行
- trace.ts: ~370 行
- 总计: ~505 行

新设计:
- trace.ts: ~370 行（包含所有逻辑）
- 总计: ~370 行

减少: ~135 行 (-27%)
```

### 3. 易于理解

```typescript
// ✅ 新设计：一目了然
const tracer = Trace(options, app);  // 创建 + 初始化
app.use(tracer);                     // 注册

// ❌ 旧设计：需要理解两个模块
// 1. TraceComponent 负责初始化
// 2. Trace Middleware 负责处理
// 3. 它们如何通信？
```

### 4. 闭包优雅

```typescript
// ✅ 闭包：资源自然传递
function Trace(options, app) {
  const resource = init();  // 创建资源
  
  return async (ctx, next) => {
    resource.use();  // 直接使用，类型安全
  };
}

// ❌ 全局状态：需要类型断言
function Trace(options, app) {
  app.resource = init();
  
  return async (ctx, next) {
    (app as any).resource.use();  // 类型不安全
  };
}
```

## 🚫 反模式（应避免）

### ❌ 反模式 1: 创建单独的 Component

```typescript
// ❌ 不要这样做
@Component('TraceComponent')
export class TraceComponent {
  @OnEvent(AppEvent.appStart)
  async init(app) {
    // 初始化
  }
}
```

**为什么错误**: koatty-trace 本质上就是一个中间件，不需要 Component

### ❌ 反模式 2: 在 middleware 中延迟初始化

```typescript
// ❌ 不要这样做
export function Trace(options, app) {
  return async (ctx, next) => {
    // 每个请求都初始化？性能灾难！
    const spanManager = new SpanManager();
  };
}
```

**为什么错误**: 初始化应该在创建时完成，不是每个请求

### ❌ 反模式 3: 通过全局变量共享状态

```typescript
// ❌ 不要这样做
let globalSpanManager: SpanManager;

export function Trace(options, app) {
  globalSpanManager = new SpanManager();
  
  return async (ctx, next) => {
    globalSpanManager.createSpan(...);
  };
}
```

**为什么错误**: 全局变量导致测试困难，多实例冲突

## 📖 最佳实践

### 1. Middleware 设计

```typescript
export function Trace(options, app) {
  // ✅ 创建时初始化资源
  const resource = initResource();
  
  // ✅ 监听生命周期事件
  app.once(AppEvent.appStart, async () => { /* 启动 */ });
  app.once(AppEvent.appStop, async () => { /* 清理 */ });
  
  // ✅ 返回 middleware 函数
  return async (ctx, next) => {
    // ✅ 使用闭包中的资源
    resource.track(ctx);
    await next();
  };
}
```

### 2. Loader 注册

```typescript
// ✅ 在 Loader 中统一注册
async LoadMiddlewares() {
  const tracer = Trace(options, this.app);
  this.app.use(tracer);
}
```

### 3. 错误处理

```typescript
// ✅ 优雅降级
if (options.enableTrace) {
  try {
    spanManager = new SpanManager(options);
  } catch (error) {
    Logger.Error('Failed to initialize SpanManager:', error);
    // 继续执行，只是没有追踪功能
  }
}
```

## 🎯 总结

### 新架构的核心优势

1. **架构简洁**: 只有 Middleware，无需 Component
2. **代码更少**: 减少 27% 代码量
3. **易于理解**: 单一入口，清晰的两阶段设计
4. **闭包优雅**: 资源自然传递，类型安全
5. **性能优化**: 初始化1次，请求处理无额外开销

### 关键原则

> **Koatty-Trace 就是一个 Middleware**  
> 
> - 在创建时初始化所有资源  
> - 通过闭包保持对资源的引用  
> - 通过事件监听器管理生命周期  
> - 返回 middleware 函数处理请求

---

**设计日期**: 2026-01-30  
**设计者**: @richen & AI Assistant  
**状态**: ✅ 已实现并验证  

**参考**:
- [修复总结](./FINAL_FIX_SUMMARY.md)
- [快速参考](./QUICK_REFERENCE.md)
- [变更日志](../CHANGELOG_2.0.7.md)
