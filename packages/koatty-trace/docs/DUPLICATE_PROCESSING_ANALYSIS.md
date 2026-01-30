# 日志重复和 write after end 问题分析

## 🔍 问题现象

### 1. 日志重复输出
同一个 `requestId` 的日志出现两次：
```
[11:50:07.968]  INFO {"action":"GET","status":"200","startTime":"1769745007927","duration":"39","requestId":"1f392345-14a9-440b-ab1c-9cdb4a123170",...}
[11:50:07.968]  INFO {"action":"GET","status":"200","startTime":"1769745007927","duration":"40","requestId":"1f392345-14a9-440b-ab1c-9cdb4a123170",...}
```

注意：`duration` 不同（39ms vs 40ms），说明是在不同时间点记录的。

### 2. write after end 错误
```
Error: write after end
  at ServerResponse.end (node:_http_outgoing:1098:15)
  at Exception.output (/packages/koatty-exception/dist/index.js:1037:24)
```

同一个 requestId 的错误日志也出现了两次：
```
[11:50:08.041]  ERROR {...,"requestId":"72a3c613-d966-434a-99e6-722b2fe1b031",...}
[11:50:08.041]  ERROR {...,"requestId":"72a3c613-d966-434a-99e6-722b2fe1b031",...}
[11:50:08.042]  ERROR Error: write after end
```

## 🎯 根本原因

**两个问题的根本原因相同：请求被处理了两次！**

### 为什么会被处理两次？

#### 原因 1: `res.once('finish')` 被触发两次

从代码分析：
1. `HttpHandler.handle()` 在第 55 行注册了 `res.once('finish')` 监听器
2. `GrpcHandler.handle()` 在第 59 行也注册了 `res.once('finish')` 监听器
3. 虽然使用的是 `once()`，理论上只会触发一次

但在**某些特殊情况下**，`finish` 事件可能被触发多次：
- 响应已经结束，但错误处理又尝试写入
- 多个中间件或 handler 同时处理同一个请求

#### 原因 2: 错误处理流程中的重复调用

调用链分析：

```
HTTP Handler
  ├─> commonPreHandle() 
  ├─> res.once('finish', () => {
  │     └─> commonPostHandle() ──> logRequest() ──> Logger.Info() [第1次日志]
  │   })
  ├─> try {
  │     ├─> handleWithTimeout() ──> next()
  │     ├─> checkAndSetStatus() ──> throws Exception (404)
  │     └─> respond() [不会执行，因为抛出异常]
  │   }
  └─> catch(err) {
        └─> handleError() ──> catcher() ──> Exception.handler()
              ├─> log() ──> Logger.Error() [第2次错误日志]
              └─> output() ──> ctx.res.end() [第1次end]
                    └─> 触发 finish 事件 [第2次end尝试]
  }
```

**时序问题：**

1. 404 异常被抛出
2. `catch` 块调用 `handleError()` → `Exception.handler()`
3. `Exception.handler()` 记录错误日志（第1次）
4. `Exception.handler()` 调用 `output()` → `res.end()` （第1次）
5. `res.end()` 触发 `finish` 事件
6. `finish` 监听器调用 `commonPostHandle()` → `logRequest()` （第2次日志）
7. 但此时 `Exception.handler()` 可能还在执行，或者有其他地方再次调用了处理逻辑
8. 第二次尝试 `res.end()` → "write after end" 错误

## 🔧 解决方案

### 方案 1: 防止重复调用 res.end()

在 `Exception.output()` 中添加响应状态检查：

```typescript
protected output(ctx: IExceptionContext): unknown {
  // ✅ 检查响应是否已经结束
  if (ctx.res.writableEnded || ctx.res.finished) {
    Logger.Warn('Response already ended, skipping output');
    return;
  }
  
  // ... 原有逻辑
}
```

### 方案 2: 使用标志位防止重复处理

在 handler 中添加处理标志：

```typescript
export class HttpHandler extends BaseHandler implements Handler {
  async handle(ctx: KoattyContext, next: Function, ext?: extensionOptions): Promise<any> {
    // ✅ 添加处理标志
    if ((ctx as any)._handlerCalled) {
      Logger.Warn('Handler already called for this request');
      return;
    }
    (ctx as any)._handlerCalled = true;
    
    // ... 原有逻辑
  }
}
```

### 方案 3: 移除finish事件中的日志（推荐）

将日志记录移到更合适的位置，而不是依赖 `finish` 事件：

```typescript
export class HttpHandler extends BaseHandler implements Handler {
  async handle(ctx: KoattyContext, next: Function, ext?: extensionOptions): Promise<any> {
    const timeout = ext.timeout || 10000;

    this.commonPreHandle(ctx, ext);
    
    // ❌ 移除这个监听器（会导致重复日志）
    // ctx?.res?.once('finish', () => {
    //   const now = Date.now();
    //   const msg = `...`;
    //   this.commonPostHandle(ctx, ext, msg);
    // });

    try {
      await this.handleWithTimeout(ctx, next, ext, timeout);
      this.checkAndSetStatus(ctx);
      
      // ✅ 成功情况下记录日志
      const now = Date.now();
      const msg = `{"action":"${ctx.method}","status":"${ctx.status}","startTime":"${ctx.startTime}","duration":"${(now - ctx.startTime) || 0}","requestId":"${ctx.requestId}","endTime":"${now}","path":"${ctx.originalPath || '/'}"}`;
      Logger.Info(msg);
      
      return respond(ctx, ext);
    } catch (err: any) {
      // ✅ 错误情况下的日志由Exception.handler()处理
      return this.handleError(err, ctx, ext);
    }
  }
}
```

### 方案 4: 统一在 finally 块中记录日志

```typescript
export class HttpHandler extends BaseHandler implements Handler {
  async handle(ctx: KoattyContext, next: Function, ext?: extensionOptions): Promise<any> {
    const timeout = ext.timeout || 10000;
    let error: any = null;

    this.commonPreHandle(ctx, ext);

    try {
      await this.handleWithTimeout(ctx, next, ext, timeout);
      this.checkAndSetStatus(ctx);
      return respond(ctx, ext);
    } catch (err: any) {
      error = err;
      return this.handleError(err, ctx, ext);
    } finally {
      // ✅ 统一在这里记录日志（无论成功还是失败）
      if (!error || ctx.status < 400) {
        const now = Date.now();
        const msg = `{"action":"${ctx.method}","status":"${ctx.status}","startTime":"${ctx.startTime}","duration":"${(now - ctx.startTime) || 0}","requestId":"${ctx.requestId}","endTime":"${now}","path":"${ctx.originalPath || '/'}"}`;
        Logger[(ctx.status >= 400 ? 'Error' : 'Info')](msg);
      }
      // 错误情况的日志已经由 Exception.handler() 记录过了
    }
  }
}
```

## 🎯 推荐方案

**组合方案：方案1 + 方案3**

1. **在 Exception.output() 中添加响应状态检查**（防御性编程）
2. **移除 finish 事件监听器**，改为在正确的位置记录日志
3. **错误日志由 Exception.handler() 统一处理**

这样可以：
- ✅ 消除日志重复
- ✅ 避免 "write after end" 错误
- ✅ 保持日志的一致性和完整性
- ✅ 减少事件监听器的复杂性

## 📋 实施步骤

1. **修改 koatty-exception 包**
   - 在 `Exception.output()` 中添加响应状态检查

2. **修改 koatty-trace 包**
   - 修改 `HttpHandler.handle()`：移除 finish 监听器，在 try-finally 块中记录日志
   - 修改 `GrpcHandler.handle()`：同样处理

3. **测试验证**
   - 测试正常请求（200）
   - 测试错误请求（404, 500）
   - 测试多协议场景
   - 确认日志不重复
   - 确认没有 "write after end" 错误

## 🔄 向后兼容性

这个修改不会影响：
- ✅ API 接口
- ✅ 现有功能
- ✅ 日志格式
- ✅ 性能

只是改变了日志记录的时机，从事件驱动改为直接调用。
