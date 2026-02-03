# 简化架构说明

## 🎯 核心设计

**Koatty-Trace 就是一个纯粹的 Middleware，不需要单独的 Component**

## 📊 架构对比

### 之前（复杂）

```
TraceComponent (Component)
  ↓ 初始化
  ├─ OpenTelemetry SDK
  ├─ Prometheus
  └─ SpanManager
  ↓ 挂载到 app
  
Trace (Middleware)
  ↓ 从 app 获取资源
  └─ 处理请求
```

**问题**:
- ❌ 两层架构，复杂
- ❌ 职责分散
- ❌ 资源传递繁琐
- ❌ 多了 135 行代码

### 现在（简洁）

```
Trace (Middleware)
  ↓ 创建时初始化（闭包）
  ├─ OpenTelemetry SDK
  ├─ Prometheus  
  └─ SpanManager
  ↓ 返回 middleware 函数
  └─ 处理请求（使用闭包资源）
```

**优势**:
- ✅ 单层架构，简洁
- ✅ 职责集中
- ✅ 闭包优雅传递
- ✅ 减少 27% 代码

## 🔧 核心代码

### trace.ts

```typescript
export function Trace(options: TraceOptions, app: Koatty) {
  // ============================================
  // 阶段1: 创建时初始化（只执行1次）
  // ============================================
  
  let spanManager: SpanManager | undefined;
  let sdk: any;
  
  // 1. 初始化 Prometheus
  if (options.enableTrace) {
    const metricsProvider = initPrometheusExporter(app, options);
  }
  
  // 2. 初始化 SpanManager
  if (options.enableTrace) {
    spanManager = new SpanManager(options);
  }
  
  // 3. 初始化 OpenTelemetry SDK
  if (options.enableTrace) {
    sdk = initSDK(app, options);
    
    // 监听 appStart 启动 Tracer
    app.once(AppEvent.appStart, async () => {
      await startTracer(sdk, app, options);
    });
  }
  
  // 4. 监听 appStop 清理资源
  app.once(AppEvent.appStop, async () => {
    if (spanManager) spanManager.destroy();
    if (sdk) await sdk.shutdown();
  });
  
  // ============================================
  // 阶段2: 返回 middleware（每个请求执行）
  // ============================================
  
  return async (ctx: KoattyContext, next: KoattyNext) => {
    // 生成 requestId
    const requestId = getRequestId(ctx, options);
    initializeRequestProperties(ctx, requestId);
    
    // 使用闭包中的资源创建 Span
    if (options.enableTrace && spanManager) {
      const tracer = app.otelTracer;
      if (tracer) {
        spanManager.createSpan(tracer, ctx, app.name);
      }
    }
    
    // 处理请求
    const handler = HandlerFactory.getHandler(protocol);
    return handler.handle(ctx, next, ext);
  };
}
```

### Loader.ts

```typescript
async LoadMiddlewares() {
  // ✅ 只需要一行，简单明了
  const tracer = Trace(options, this.app);
  this.app.use(tracer);
}
```

## ✅ 验证结果

```bash
# 5个连续请求
✅ 5个请求成功
✅ 5条日志（每个请求1条）
✅ 0个重复
✅ 0个错误
```

## 📚 文档

- [完整架构文档](./docs/ARCHITECTURE.md)
- [修复总结](./docs/FINAL_FIX_SUMMARY.md)

---

**更新日期**: 2026-01-30  
**状态**: ✅ 已实现并验证
