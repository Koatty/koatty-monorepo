# koatty-router Optimization Plan

> Version: 2.1.9 -> 2.2.0  
> Date: 2026-03-08  
> Author: Code Review Team  
> Scope: packages/koatty-router

---

## Table of Contents

1. [Overview](#1-overview)
2. [Issue Classification](#2-issue-classification)
3. [Critical Fixes](#3-critical-fixes)
4. [Major Fixes](#4-major-fixes)
5. [Minor Fixes](#5-minor-fixes)
6. [Performance Optimizations](#6-performance-optimizations)
7. [Code Quality Improvements](#7-code-quality-improvements)
8. [Breaking Changes & Migration](#8-breaking-changes--migration)

---

## 1. Overview

### Current State

koatty-router is a multi-protocol routing component supporting HTTP/HTTPS/HTTP2/HTTP3, WebSocket, gRPC, and GraphQL. The architecture uses Factory + Strategy + Decorator patterns. The codebase has ~5,000 lines of TypeScript across 28 source files.

### Optimization Goals

| Goal | Priority | Impact |
|------|----------|--------|
| Fix runtime bugs that cause incorrect behavior | P0 | Correctness |
| Fix security vulnerabilities | P0 | Security |
| Remove dead/placeholder code | P1 | Maintainability |
| Fix logic defects in protocol handlers | P1 | Reliability |
| Improve performance on hot paths | P2 | Performance |
| Improve code quality and consistency | P3 | Maintainability |

### Non-Goals

- Redesigning the overall architecture (Factory + Strategy is appropriate)
- Adding new protocol support
- Changing the public API surface (decorators, RouterOptions, etc.)

---

## 2. Issue Classification

| ID | Severity | File | Description |
|----|----------|------|-------------|
| C-1 | Critical | `grpc.ts` | Connection pool & batch processor are placeholder stubs |
| C-2 | Critical | `grpc.ts` | Stream state update uses stale closure reference |
| C-3 | Critical | `factory.ts` | `hasShutdown` flag prevents re-initialization after hot restart |
| M-1 | Major | `ws.ts` | WebSocket framing logic is fundamentally flawed |
| M-2 | Major | `graphql.ts` | GraphiQL endpoint has XSS vulnerability |
| M-3 | Major | `inject.ts` | `ts-morph` creates new Project per controller in debug mode |
| M-4 | Major | `manager.ts` | `performCacheCleanup()` is a no-op |
| M-5 | Major | `http.ts`, `ws.ts` | `SetRouter` does not null-check optional `impl` parameter |
| M-6 | Major | `grpc.ts` | Bidirectional streaming creates new Context per message |
| m-1 | Minor | `types.ts` | `validateProtocolConfig` rejects http2/http3 as unknown |
| m-2 | Minor | `graphql.ts` | `SetRouter` called repeatedly in loop with same path |
| m-3 | Minor | Various | Mixed Chinese/English comments |
| m-4 | Minor | `inject.ts` | `injectParam` returns `number` instead of `void` |
| m-5 | Minor | `payload.ts` | `bodyParser` silently swallows errors |
| m-6 | Minor | `manager.ts` | `createGroup` does not await async `register` |
| m-7 | Minor | `grpc.ts` | `GrpcBatchProcessor.addRequest` can leak Promises |
| m-8 | Minor | `inject.ts` | `getControllerPath` hard-codes directory structure |
| P-1 | Perf | `grpc.ts` | `JSON.stringify` used for buffer size estimation |
| P-2 | Perf | `payload.ts` | Content-type matching can be further optimized |

---

## 3. Critical Fixes

### C-1: Remove Placeholder gRPC Connection Pool & Batch Processor

**Problem:**  
`GrpcConnectionPool.create()` returns a fake stub object. `GrpcBatchProcessor.processBatch()` immediately resolves all requests with fake success data. If any code path reaches these, it produces silently incorrect results.

**Root Cause:**  
The classes were added as design placeholders for future features but were never implemented. They are currently unused by the main routing flow (gRPC routing goes through Koa middleware chain, not through the pool/batch).

**Solution:**  
Remove both classes entirely. The gRPC router currently works through the Koa middleware chain and `app.createContext()`. These placeholder classes add complexity without value.

**Changes:**
- `src/router/grpc.ts`: Remove `GrpcConnectionPool` class (lines 73-182)
- `src/router/grpc.ts`: Remove `GrpcBatchProcessor` class (lines 187-310)
- `src/router/grpc.ts`: Remove `StreamManager` class if only used with pool/batch; OR keep if used independently
- `src/router/grpc.ts`: In `GrpcRouter` constructor, remove `connectionPool` and `batchProcessor` fields
- `src/router/grpc.ts`: In `GrpcRouter.cleanup()`, remove pool/batch cleanup calls
- Update related tests

**Breaking Change:** None. These classes are not exported and are unused in the routing flow.

---

### C-2: Fix gRPC Stream State Update Using Stale Closure Reference

**Problem:**  
In `handleClientStreaming` and `handleBidirectionalStreaming`, the `data` event handler captures `streamState` from `registerStream()`. Although `updateStream()` uses `Object.assign` on the same reference, the code uses `streamState.messageCount + 1` which reads the current value. This works by coincidence but is fragile and unclear.

**Solution:**  
Refactor to explicitly read from the Map and use direct mutation:

```typescript
// Before (fragile):
this.streamManager.updateStream(streamId, { 
  messageCount: streamState.messageCount + 1 
});

// After (explicit):
const currentState = this.streamManager.getStreamState(streamId);
if (currentState) {
  currentState.messageCount++;
  currentState.bufferSize += estimateSize(data);
}
```

**Changes:**
- `src/router/grpc.ts`: Add `getStreamState(id)` method to `StreamManager`
- `src/router/grpc.ts`: Refactor all `updateStream` calls in `handleClientStreaming`, `handleBidirectionalStreaming`
- Update related tests

---

### C-3: Fix RouterFactory Singleton Cannot Re-initialize After Shutdown

**Problem:**  
`RouterFactory` sets `hasShutdown = true` after `shutdownAll()`. There is no way to reset this flag. If the application performs a hot restart (re-initialize without process restart), new routers cannot be properly shut down.

**Solution:**  
Add a `resetShutdownState()` method and call it in `create()`:

```typescript
public create(...): KoattyRouter {
  // Reset shutdown state when creating new routers
  if (this.hasShutdown) {
    this.hasShutdown = false;
  }
  // ...existing code
}
```

**Changes:**
- `src/router/factory.ts`: Reset `hasShutdown` in `create()` method
- Add unit test for re-initialization after shutdown

---

## 4. Major Fixes

### M-1: Rewrite WebSocket Message Handler

**Problem:**  
The WebSocket `websocketHandler` has multiple design flaws:

1. **Unnecessary manual framing**: WebSocket `message` events already deliver complete messages. The chunking logic based on `maxFrameSize` is wrong.
2. **Completion detection is broken**: `bufferData.length % chunkSize !== 0` fails for exact-multiple-sized messages.
3. **Promise resolves only once**: The handler wraps everything in `new Promise()` and calls `resolve()` on first message, ignoring subsequent messages.

**Solution: Two Options**

**Option A (Recommended): Simplify to per-message handler**
Remove framing logic. Process each `message` event independently. Return a Promise that resolves when the WebSocket connection closes.

```typescript
private websocketHandler(...): Promise<any> {
  return new Promise((resolve, reject) => {
    // Connection setup, heartbeat, memory limits...
    
    ctx.websocket.on('message', async (data: Buffer | string) => {
      try {
        const message = typeof data === 'string' ? data : data.toString('utf8');
        ctx.message = message;
        await Handler(app, ctx, ctl, method, params, ctlParamsValue, composedMiddleware);
      } catch (error) {
        Logger.Error(`Error processing message: ${error}`);
      }
    });
    
    ctx.websocket.on('close', () => { resolve(undefined); cleanup(); });
    ctx.websocket.on('error', (err) => { reject(err); cleanup(); });
  });
}
```

**Option B: Keep framing but fix the logic**
If large binary message splitting is genuinely needed (unlikely for WebSocket), fix the chunking detection and use a proper accumulation buffer with explicit end-of-message signals.

**Breaking Change:** Behavioral change in how WebSocket messages are processed. Applications that depend on the old (broken) framing behavior may need updates, though this is unlikely since the old behavior was incorrect.

---

### M-2: Fix GraphiQL XSS Vulnerability

**Problem:**  
In `renderGraphiQL()`, the `endpoint` string is interpolated directly into a JavaScript string literal without escaping:

```javascript
url: '${endpoint}',
```

If endpoint contains `'` or `\`, it can break out of the string and inject arbitrary JavaScript.

**Solution:**  
Escape the endpoint string for safe JavaScript embedding:

```typescript
private escapeJsString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/</g, '\\x3c')
    .replace(/>/g, '\\x3e')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

private renderGraphiQL(endpoint: string): string {
  const safeEndpoint = this.escapeJsString(endpoint);
  // ...use safeEndpoint in template
}
```

**Changes:**
- `src/router/graphql.ts`: Add `escapeJsString` utility method
- `src/router/graphql.ts`: Use escaped endpoint in `renderGraphiQL`
- Add test case with special characters in endpoint

---

### M-3: Cache ts-morph Project Instance in Debug Mode

**Problem:**  
`getPublicMethods()` creates a new `ts-morph` `Project` instance for every controller class, which is expensive (~100-500ms per parse).

**Solution:**  
Cache the `Project` instance at module level:

```typescript
let cachedProject: Project | null = null;

function getProject(): Project {
  if (!cachedProject) {
    cachedProject = new Project();
  }
  return cachedProject;
}
```

Also cache the results per class file:

```typescript
const publicMethodsCache = new Map<string, string[]>();

export function getPublicMethods(classFilePath: string, className: string): string[] {
  const cacheKey = `${classFilePath}::${className}`;
  if (publicMethodsCache.has(cacheKey)) {
    return publicMethodsCache.get(cacheKey)!;
  }
  // ...parse and cache
}
```

**Changes:**
- `src/utils/inject.ts`: Add module-level `Project` cache
- `src/utils/inject.ts`: Add results cache for `getPublicMethods`
- Add test for caching behavior

---

### M-4: Implement or Remove Cache Cleanup in MiddlewareManager

**Problem:**  
`performCacheCleanup()` in `RouterMiddlewareManager` does nothing between recording `beforeSize` and `afterSize`. The timer runs every 5 minutes for no purpose.

**Solution:**  
Since LRU caches auto-evict, the cleanup timer is unnecessary. Remove it entirely:

```typescript
// Remove:
// - private cacheCleanupTimer
// - private CACHE_CLEANUP_INTERVAL
// - startCacheCleanup()
// - performCacheCleanup()
// Also remove cleanup timer stop from destroy()
```

OR implement meaningful cleanup (e.g., purge entries for unregistered middleware).

**Changes:**
- `src/middleware/manager.ts`: Remove the no-op cleanup timer and related code
- Update `destroy()` method accordingly

---

### M-5: Add Null Check for Optional `impl` Parameter in SetRouter

**Problem:**  
`HttpRouter.SetRouter()` and `WebsocketRouter.SetRouter()` declare `impl` as optional (`impl?`) but access `impl.path` without null checking, causing `TypeError` when called without the second argument.

**Solution:**

```typescript
SetRouter(name: string, impl?: RouterImplementation) {
  if (!impl || Helper.isEmpty(impl.path)) return;
  // ...
}
```

**Changes:**
- `src/router/http.ts`: Add null check in `SetRouter`
- `src/router/ws.ts`: Add null check in `SetRouter`
- Add test cases for `SetRouter(name)` without impl

---

### M-6: Optimize Bidirectional Stream Context Creation

**Problem:**  
`handleBidirectionalStreaming` creates a new `app.createContext(call, null, 'grpc')` and `IOC.getInsByClass(ctlItem.ctl, [ctx])` for every incoming message. This generates significant GC pressure under high message rates.

**Solution:**  
Create the context and controller instance once, then reuse for each message:

```typescript
private handleBidirectionalStreaming(...): void {
  // Create context once
  const ctx = app.createContext(call, null, 'grpc');
  const ctl = IOC.getInsByClass(ctlItem.ctl, [ctx]);
  
  // Add stream helpers to ctx
  ctx.writeStream = (data: any) => { call.write(data); return true; };
  ctx.endStream = () => { call.end(); };
  
  call.on('data', async (data: any) => {
    ctx.streamMessage = data;  // Update message on existing context
    await Handler(app, ctx, ctl, ctlItem.method, ...);
  });
}
```

**Breaking Change:** Controllers that depend on a fresh context per message will behave differently. This is an improvement, but should be documented.

---

## 5. Minor Fixes

### m-1: Add http2/http3 to validateProtocolConfig

**Changes:**  
- `src/router/types.ts`: Add `case 'http2': case 'http3':` to the switch statement, falling through to the `http/https` handler.

### m-2: Move GraphQL SetRouter Outside Loop

**Changes:**  
- `src/router/graphql.ts`: Move `this.SetRouter()` call after the controller loop, calling it once with the fully-built `rootValue`.

### m-3: Unify Comments Language to English

**Changes:**  
- All `.ts` files in `src/`: Replace Chinese comments with English equivalents. This is a cosmetic change with no behavioral impact.

### m-4: Fix injectParam Return Type

**Changes:**  
- `src/utils/inject.ts`: Change `return descriptor;` to just `return;` in `injectParam`, or remove the return statement entirely.

### m-5: Make bodyParser Error Handling Configurable

**Changes:**  
- `src/payload/payload.ts`: Add `throwOnError` option to `PayloadOptions`. When true, re-throw parse errors instead of returning `{}`.
- `src/payload/interface.ts`: Add `throwOnError?: boolean` to `PayloadOptions`.

**Breaking Change:** Default behavior stays the same (return `{}`). The new option is opt-in.

### m-6: Await register in createGroup

**Changes:**  
- `src/middleware/manager.ts`: Make `createGroup` async and await `this.register()`.

### m-7: Add Error Handling to GrpcBatchProcessor.processBatch

**Note:** If C-1 is implemented (remove placeholder classes), this becomes unnecessary.

### m-8: Make getControllerPath Configurable

**Changes:**  
- `src/utils/inject.ts`: Accept controller path pattern from app configuration instead of hard-coding `"/controller/" + className + ".ts"`.

---

## 6. Performance Optimizations

### P-1: Replace JSON.stringify with Buffer.byteLength for gRPC Size Estimation

**Problem:**  
`JSON.stringify(data).length` is used to estimate buffer size in gRPC stream handlers. This is O(n) in the serialized size and allocates a temporary string.

**Solution:**

```typescript
function estimateSize(data: any): number {
  if (Buffer.isBuffer(data)) return data.length;
  if (typeof data === 'string') return Buffer.byteLength(data);
  // For objects, use a rough estimation
  return Buffer.byteLength(JSON.stringify(data));
}
```

**Note:** If C-1 removes the classes using this, this optimization becomes unnecessary. However, the stream handlers in `handleClientStreaming` and `handleBidirectionalStreaming` also use this pattern and should be fixed regardless.

### P-2: Optimize Content-Type Matching

The current implementation uses regex matching via `contentTypeRegex` on every request. Consider using `String.startsWith()` checks against known prefixes for common types as a fast path:

```typescript
// Fast path for common content types
const FAST_TYPE_MAP: [string, string][] = [
  ['application/json', 'application/json'],
  ['text/plain', 'text/plain'],
  ['multipart/form-data', 'multipart/form-data'],
];

public getContentType(contentType: string): string | null {
  // Fast path: direct prefix match
  for (const [prefix, result] of FAST_TYPE_MAP) {
    if (contentType.startsWith(prefix)) return result;
  }
  // Fallback to regex
  // ...
}
```

---

## 7. Code Quality Improvements

### Q-1: Remove Unused Imports

Several files import utilities that are not used. A lint pass should clean these up.

### Q-2: Standardize Error Message Format

Error messages use inconsistent formats:
- Some use template literals with emoji: `❌ Failed to find...`
- Some use plain strings: `Controller not found.`
- Some include suggestion hints: `→ To enable...`

Standardize to a consistent format without emoji for log parsability.

### Q-3: Consolidate Duplicate StreamConfig Types

`StreamConfig` is defined in both `src/router/types.ts` and `src/router/grpc.ts` with slightly different field names. Consolidate to a single definition.

### Q-4: Add JSDoc to All Public APIs

Several exported functions and interfaces lack JSDoc documentation. All public API surfaces should have complete JSDoc with `@param`, `@returns`, `@throws`, and `@example`.

---

## 8. Breaking Changes & Migration

### Summary of Breaking Changes

| Change | Impact | Migration |
|--------|--------|-----------|
| C-1: Remove GrpcConnectionPool/BatchProcessor | None (internal, unused) | No action needed |
| M-1: WebSocket message handler rewrite | Behavioral | WebSocket handlers now receive each message as a separate invocation. Controllers using `ctx.message` continue to work. |
| M-6: Bidirectional stream context reuse | Behavioral | Controllers get the same context across messages. Store per-message state in `ctx.streamMessage` not `ctx`. |
| m-5: bodyParser throwOnError option | Additive | Default unchanged. Opt-in via `throwOnError: true`. |

### Version Bump Strategy

- If only non-breaking fixes are applied: **patch** (2.1.10)
- If M-1 or M-6 are applied: **minor** (2.2.0) with changelog noting behavioral changes
- All changes together: **minor** (2.2.0)

---

## Appendix: File Change Summary

| File | Changes |
|------|---------|
| `src/router/grpc.ts` | C-1, C-2, M-6, P-1, Q-3 |
| `src/router/factory.ts` | C-3 |
| `src/router/ws.ts` | M-1, M-5 |
| `src/router/graphql.ts` | M-2, m-2 |
| `src/router/http.ts` | M-5 |
| `src/router/types.ts` | m-1, Q-3 |
| `src/utils/inject.ts` | M-3, m-4, m-8 |
| `src/middleware/manager.ts` | M-4, m-6 |
| `src/payload/payload.ts` | m-5 |
| `src/payload/interface.ts` | m-5 |
| `src/params/mapping.ts` | (no changes) |
| `src/params/params.ts` | (no changes) |
| `src/utils/strategy-extractor.ts` | (no changes) |
| `src/utils/param-extractors.ts` | (no changes) |
| Various | m-3 (comment language) |
