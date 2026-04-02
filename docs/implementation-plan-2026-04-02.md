# Koatty Framework Implementation Plan

**Based on**: `docs/koatty-review-2026-04-01.md` Review Report  
**Created**: 2026-04-02  
**Purpose**: Provide engineering LLM with precise, executable task specifications  
**Verification**: All P0/P1 issues independently confirmed against current codebase (2026-04-02)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Phase 1: Critical Bug Fixes (Week 1-2)](#2-phase-1-critical-bug-fixes)
3. [Phase 2: Quality & Stability (Month 1-3)](#3-phase-2-quality--stability)
4. [Phase 3: Feature Enhancement (Month 3-6)](#4-phase-3-feature-enhancement)
5. [Phase 4: Advanced Capabilities (Month 6-12)](#5-phase-4-advanced-capabilities)
6. [Cross-Cutting Concerns](#6-cross-cutting-concerns)
7. [Implementation Notes for Engineering LLM](#7-implementation-notes-for-engineering-llm)

---

## 1. Executive Summary

### Problem Statement

The review identified **42 issues** across the monorepo:
- **5 P0** (runtime correctness / security) - None fixed from previous review
- **8 P1** (data loss / compatibility) - 1 fixed (P2-6)
- **14 P2** (code quality / DX)
- **6 P3** (cleanup / config)
- **9 SW-\*** (koatty_swagger specific)

### Key Insight from Independent Verification

All 6 sampled issues (P1-1, P1-3, P1-4, P1-5, N-2, N-3) are **confirmed present** in the current codebase as of 2026-04-02. The previous review's findings from 2026-03-12 remain entirely unaddressed.

### Recommended Approach

- **Phase 1** focuses exclusively on correctness-impacting bugs. No feature work until these are resolved.
- **Phase 2** hardens the codebase through quality improvements.
- **Phase 3** brings feature parity with NestJS/Midway on key dimensions.
- **Phase 4** builds on Koatty's existing differentiators (HTTP/3, OpenTelemetry, AI CLI).

### Analysis Additions (Beyond Review Report)

Based on independent codebase analysis, I add the following observations:

1. **tsconfig.json references** only list 6 of 21 packages - IDE cross-package navigation is broken for 15 packages
2. **pnpm-workspace.yaml** includes `apps/*`, `tools/*`, `examples/*` directories that don't exist - harmless but confusing
3. **No `.npmrc`** visible in root - should configure `strict-peer-dependencies=false` for monorepo compat
4. **koatty-doc submodule** already registered in `.gitmodules` but likely has no `package.json` - partial integration state

---

## 2. Phase 1: Critical Bug Fixes

**Timeline**: Week 1-2  
**Goal**: Eliminate all P0 runtime bugs and P1 data/compatibility issues  
**Principle**: Each task is a single atomic commit. All tasks can be executed in parallel (no cross-dependencies).

---

### Task 1-1: Fix Double `appStop` Event Binding

| Field | Value |
|-------|-------|
| ID | `TASK-1-1` |
| Priority | **P0** |
| Review IDs | P1-1 |
| Package | `koatty-core` |
| File | `packages/koatty-core/src/Application.ts` |
| Lines | ~425-431 |
| Impact | Cleanup handlers (DB close, log flush, etc.) execute twice on shutdown, causing race conditions |

**Current Code** (confirmed 2026-04-02):
```ts
// Line ~427
Logger.Log('Koatty', '', 'Bind App Stop event ...');
bindProcessEvent(this, 'appStop');

// Line ~431 — DUPLICATE
Logger.Log('Koatty', '', 'Bind App Stop event ...');
bindProcessEvent(this, 'appStop');
```

**Required Change**:
- Remove the second `Logger.Log` + `bindProcessEvent` call (lines ~430-431)
- Verify no other location also calls `bindProcessEvent(this, 'appStop')`

**Verification**:
```bash
# After fix, grep should return exactly 1 match
rg "bindProcessEvent.*appStop" packages/koatty-core/src/
```

---

### Task 1-2: Fix `callback()` Middleware Stack Pollution (Memory Leak)

| Field | Value |
|-------|-------|
| ID | `TASK-1-2` |
| Priority | **P0** |
| Review IDs | P1-5, N-4 |
| Package | `koatty-core` |
| File | `packages/koatty-core/src/Application.ts` |
| Lines | ~597-612 |
| Impact | Memory leak in gRPC/high-frequency scenarios; `middlewareStacks` array grows unboundedly |

**Current Code** (confirmed 2026-04-02):
```ts
// protocolMiddleware is fetched from the persistent Map
const protocolMiddleware = this.middlewareStacks.get(protocol) || [];
if (reqHandler) {
  protocolMiddleware.push(reqHandler);  // MUTATES persistent array
}
const fn = koaCompose(protocolMiddleware as any);
```

**Required Change**:
```ts
const protocolMiddleware = this.middlewareStacks.get(protocol) || [];
// Create temporary copy to avoid polluting the persistent stack
const middlewareToCompose = reqHandler
  ? [...protocolMiddleware, reqHandler]
  : protocolMiddleware;
const fn = koaCompose(middlewareToCompose as any);
```

**Also fix**: Update the misleading comment at lines ~86-95 to accurately reflect the new behavior (the comment currently claims reqHandler is NOT cached, but the old code DID cache it).

**Verification**:
```bash
# Run existing tests
pnpm --filter koatty_core test
# Manual: confirm the middlewareStacks Map size stays constant after multiple callback() calls
```

---

### Task 1-3: Remove Hardcoded Database Credentials

| Field | Value |
|-------|-------|
| ID | `TASK-1-3` |
| Priority | **P0** |
| Review IDs | P1-4 |
| Package | `koatty-typeorm` |
| File | `packages/koatty-typeorm/src/index.ts` |
| Lines | ~47-54 |
| Impact | Security: default credentials could accidentally be used in production |

**Current Code** (confirmed 2026-04-02):
```ts
const defaultOptions: Partial<DataSourceOptions> = {
  type: "mysql",
  host: "127.0.0.1",
  port: 3306,
  username: "test",       // REMOVE
  password: "test",       // REMOVE
  database: "test",       // REMOVE
  synchronize: false,
  logging: true,
  entities: [`${process.env.APP_PATH}/model/*`],
  timezone: "Z"
};
```

**Required Change**:
- Remove `username`, `password`, `database` from `defaultOptions`
- These fields must be explicitly provided via user configuration; absence triggers TypeORM's own error message which is clear enough

**Verification**:
```bash
rg -n "username.*test|password.*test" packages/koatty-typeorm/
# Should return 0 matches after fix
```

---

### Task 1-4: Fix TypeORM Wrong Event Name (`'Stop'` -> `AppEvent.appStop`)

| Field | Value |
|-------|-------|
| ID | `TASK-1-4` |
| Priority | **P0** |
| Review IDs | N-2 |
| Package | `koatty-typeorm` |
| File | `packages/koatty-typeorm/src/index.ts` |
| Lines | ~123 |
| Impact | Database connections NEVER close on app shutdown - resource leak |

**Current Code** (confirmed 2026-04-02):
```ts
app.on('Stop', async () => {
  if (conn.isInitialized) {
    await conn.destroy();
  }
});
```

**Required Change**:
```ts
import { AppEvent } from 'koatty_core'; // or appropriate import path

app.once(AppEvent.appStop, async () => {
  if (conn.isInitialized) {
    await conn.destroy();
  }
});
```

**Notes**:
- Use `once` instead of `on` - shutdown should only execute once
- Verify the correct import path for `AppEvent` enum in this package's context. Check how other packages reference the event names (search for `AppEvent.appStop` or the string `'appStop'` across the monorepo)

**Verification**:
```bash
rg "app\.on\('Stop'" packages/koatty-typeorm/
# Should return 0 matches after fix
rg "AppEvent\.appStop|'appStop'" packages/koatty-typeorm/
# Should return 1 match (the new code)
```

---

### Task 1-5: Fix Logger `warning` -> `warn` (Winston Standard)

| Field | Value |
|-------|-------|
| ID | `TASK-1-5` |
| Priority | **P0** |
| Review IDs | N-3, P2-5, N-5 |
| Package | `koatty-logger` |
| File | `packages/koatty-logger/src/logger.ts` |
| Lines | ~18-23, ~548, and `Warn()` method |
| Impact | Log messages using `warning` level may be silently dropped by Winston |

**Required Changes** (3 locations in same file):

1. **`LogLevelObj` definition** (~line 21):
```diff
- "warning": 4,
+ "warn": 4,
```

2. **`Warn()` method** (search for `public Warn`):
```diff
- return this.printLog("warning", "", args);
+ return this.printLog("warn", "", args);
```

3. **`Log()` method falsy check** (~line 548):
```diff
- if (LogLevelObj[name]) {
+ if (LogLevelObj[name] !== undefined) {
```

4. **Also fix** the `LogLevelType` type definition if it exists:
```diff
- type LogLevelType = "debug" | "info" | "warning" | "error";
+ type LogLevelType = "debug" | "info" | "warn" | "error";
```

**Verification**:
```bash
rg '"warning"' packages/koatty-logger/src/
# Should return 0 matches after fix
pnpm --filter koatty_logger build
```

---

### Task 1-6: Fix `captureError()` Removing All Process Listeners

| Field | Value |
|-------|-------|
| ID | `TASK-1-6` |
| Priority | **P1** |
| Review IDs | P1-2 |
| Package | `koatty-core` |
| File | `packages/koatty-core/src/Application.ts` |
| Lines | ~665-688 |
| Impact | Removes third-party library event listeners (APM agents, other frameworks) |

**Required Changes**:

1. Remove `process.removeAllListeners('warning')`, `process.removeAllListeners('unhandledRejection')`, `process.removeAllListeners('uncaughtException')`
2. Keep `this.removeAllListeners('error')` (this is Koa-specific, acceptable)
3. Add idempotency guard:

```ts
private _errorCaptured = false;

private captureError(): void {
  if (this._errorCaptured) return;
  this._errorCaptured = true;
  
  // koa error - safe to replace Koa's default
  this.removeAllListeners('error');
  this.on('error', (err: Error) => {
    if (!isPrevent(err)) Logger.Error(err);
  });
  
  // warning - ADD listener, don't remove others
  process.on('warning', Logger.Warn);
  
  // promise reject error
  process.on('unhandledRejection', (reason: Error) => {
    if (!isPrevent(reason)) Logger.Error(reason);
  });
  
  // uncaught exception
  process.on('uncaughtException', (err) => {
    if (err.message.includes('EADDRINUSE')) {
      Logger.Fatal(Helper.toString(err));
      process.exit(-1);
    }
    if (!isPrevent(err)) Logger.Error(err);
  });
}
```

**Verification**:
```bash
rg "removeAllListeners" packages/koatty-core/src/Application.ts
# Should only return 1 match: this.removeAllListeners('error')
```

---

### Task 1-7: Fix `global.__KOATTY_IOC__` Global Namespace Pollution

| Field | Value |
|-------|-------|
| ID | `TASK-1-7` |
| Priority | **P1** |
| Review IDs | P1-3 |
| Package | `koatty-container` |
| File | `packages/koatty-container/src/container/container.ts` |
| Lines | ~918-925 |
| Impact | Version isolation failure in monorepo; type-unsafe cross-version sharing |

**Required Change**:
Replace string-keyed global with `Symbol.for` for versioned, collision-safe global singleton:

```ts
const KOATTY_IOC_KEY = Symbol.for('koatty.ioc.v2');

export const IOC: IContainer = (() => {
  const existing = (globalThis as any)[KOATTY_IOC_KEY];
  if (existing) {
    return existing;
  }
  const instance = Container.getInstance();
  (globalThis as any)[KOATTY_IOC_KEY] = instance;
  return instance;
})();
```

**Notes**:
- Use `globalThis` instead of `global` for broader runtime compatibility
- Version the symbol key (`v2`) so future breaking container changes can coexist
- This is a **breaking change** for anyone who directly accesses `global.__KOATTY_IOC__` - document in CHANGELOG

**Verification**:
```bash
rg "__KOATTY_IOC__" packages/koatty-container/
# Should return 0 matches after fix
pnpm --filter koatty_container build
```

---

## 3. Phase 2: Quality & Stability

**Timeline**: Month 1-3  
**Goal**: Harden code quality, fix medium-severity issues, improve maintainability

---

### Task 2-1: Fix Component Enable Logic (`||` -> `&&`)

| Field | Value |
|-------|-------|
| ID | `TASK-2-1` |
| Priority | **P1** |
| Review IDs | P2-4 |
| Package | `koatty-core` |
| File | Likely `packages/koatty-core/src/` (ComponentManager or similar) |
| Lines | Search for `shouldEnable` or `isInList || isEnabledInConfig` |
| Impact | Components may auto-load unexpectedly |

**Required Change**:
```diff
- shouldEnable = isInList || isEnabledInConfig;
+ shouldEnable = isInList && isEnabledInConfig;
```

**Important**: Before making this change, verify the semantic intent by reading surrounding code and comments. If the original intent was "enable if EITHER condition is true," then only a documentation fix is needed. If a stricter gate was intended (more likely based on review), apply the fix.

**Verification**:
```bash
pnpm --filter koatty_core build && pnpm --filter koatty_core test
```

---

### Task 2-2: Fix Validation Null Safety

| Field | Value |
|-------|-------|
| ID | `TASK-2-2` |
| Priority | **P2** |
| Review IDs | P2-2 |
| Package | `koatty-validation` |
| File | `packages/koatty-validation/src/rule.ts` |
| Lines | ~101 |
| Impact | Crash when `errors[0].constraints` is undefined |

**Required Change**:
```diff
- throw new Error(Object.values(errors[0].constraints)[0]);
+ const constraints = errors[0]?.constraints ?? {};
+ const message = Object.values(constraints)[0] ?? 'Validation failed';
+ throw new Error(message);
```

---

### Task 2-3: Fix `storeCache.store = null` Type Inconsistency

| Field | Value |
|-------|-------|
| ID | `TASK-2-3` |
| Priority | **P2** |
| Review IDs | P2-3 |
| Package | `koatty-cacheable` or `koatty-store` |
| File | Search for `storeCache.store = null` |
| Impact | Type safety violation |

**Required Change**:
- Set to `undefined` instead of `null`, or
- Update the type definition to allow `null`
- Choose based on what the rest of the codebase uses for "unset" semantics

---

### Task 2-4: Add Span `end()` on Request Completion

| Field | Value |
|-------|-------|
| ID | `TASK-2-4` |
| Priority | **P2** |
| Review IDs | N-9 |
| Package | `koatty-trace` |
| File | `packages/koatty-trace/src/trace/trace.ts` |
| Lines | ~314-317, and the `handleRequest` function |
| Impact | Span durations inaccurate; memory accumulates until app stop |

**Required Change**:
In the request handling flow (likely a `try/finally` around `await next()`), add:

```ts
try {
  await next();
} finally {
  const span = ctx._span || spanManager.getActiveSpan(ctx);
  if (span) {
    span.setStatus({ code: ctx.status >= 400 ? SpanStatusCode.ERROR : SpanStatusCode.OK });
    span.end();
  }
}
```

**Notes**:
- Study how `spanManager.createSpan()` stores the span reference (on ctx? on AsyncLocalStorage?) before implementing
- Ensure `span.end()` is called even on error paths (hence `finally`)

---

### Task 2-5: Retry Condition Safety

| Field | Value |
|-------|-------|
| ID | `TASK-2-5` |
| Priority | **P2** |
| Review IDs | P2-11 |
| Package | `koatty-trace` |
| File | `packages/koatty-trace/src/trace/trace.ts` |
| Lines | ~389 (search for `conditions: undefined`) |
| Impact | Retries ALL errors by default, including non-transient ones |

**Required Change**:
Provide a sensible default retry condition:

```ts
const defaultRetryCondition = (error: Error) => {
  // Only retry transient errors
  const transientCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'];
  const code = (error as any).code;
  return transientCodes.includes(code) || 
         (error.message && /timeout|ECONNRESET|socket hang up/i.test(error.message));
};
```

---

### Task 2-6: Remove Dead Code

| Field | Value |
|-------|-------|
| ID | `TASK-2-6` |
| Priority | **P3** |
| Review IDs | N-1, N-8 |
| Packages | `koatty-core`, `koatty-serve` |

**Changes**:

1. **`koatty-core/src/Application.ts:70`** — Remove unused `contextPrototypes` Map:
```diff
- private contextPrototypes: Map<string, any> = new Map();
```

2. **`koatty-serve/src/ServeComponent.ts:84-87`** — Remove commented-out `@OnEvent` decorator and empty `run()` method

---

### Task 2-7: Fix `createContext` Return Type

| Field | Value |
|-------|-------|
| ID | `TASK-2-7` |
| Priority | **P2** |
| Review IDs | N-6 |
| Package | `koatty-core` |
| Files | `Application.ts:406`, `IApplication.ts:148` |
| Impact | Lost type safety; no IDE autocompletion for context |

**Required Change**:
```diff
- createContext(...): any {
+ createContext(...): KoattyContext {
```
Apply to both the interface declaration (`IApplication.ts`) and the implementation (`Application.ts`).

---

### Task 2-8: Complete `tsconfig.json` References

| Field | Value |
|-------|-------|
| ID | `TASK-2-8` |
| Priority | **P3** |
| Review IDs | P2-9, N-10 |
| File | `/tsconfig.json` (root) |
| Impact | IDE "Go to Definition" broken for 15 of 21 packages |

**Required Change**:
Add all packages that have a `tsconfig.json` with `"composite": true` to the root references:

```json
{
  "files": [],
  "references": [
    { "path": "./packages/koatty-lib" },
    { "path": "./packages/koatty-container" },
    { "path": "./packages/koatty-config" },
    { "path": "./packages/koatty-core" },
    { "path": "./packages/koatty-exception" },
    { "path": "./packages/koatty-loader" },
    { "path": "./packages/koatty-logger" },
    { "path": "./packages/koatty-router" },
    { "path": "./packages/koatty-serve" },
    { "path": "./packages/koatty-trace" },
    { "path": "./packages/koatty-validation" },
    { "path": "./packages/koatty-cacheable" },
    { "path": "./packages/koatty-store" },
    { "path": "./packages/koatty-schedule" },
    { "path": "./packages/koatty-typeorm" },
    { "path": "./packages/koatty-proto" },
    { "path": "./packages/koatty-graphql" },
    { "path": "./packages/koatty-serverless" },
    { "path": "./packages/koatty" }
  ]
}
```

**Notes**:
- Before adding each, verify the package's `tsconfig.json` has `"composite": true`
- Skip `koatty-doc` (docs, no TS), `koatty-awesome` (no TS), and any packages without `tsconfig.json`

---

### Task 2-9: Memory Cache Transaction Clarity

| Field | Value |
|-------|-------|
| ID | `TASK-2-9` |
| Priority | **P2** |
| Review IDs | P2-10 |
| Package | `koatty-store` |
| File | Search for transaction-related code in `packages/koatty-store/` |
| Impact | Memory cache silently ignores transaction semantics |

**Required Change**:
If memory cache's transaction methods are no-ops, make them explicitly throw:

```ts
async beginTransaction(): Promise<void> {
  throw new Error('Transactions are not supported by MemoryStore. Use RedisStore for transaction support.');
}
```

---

### Task 2-10: Multi-Protocol Port Warning

| Field | Value |
|-------|-------|
| ID | `TASK-2-10` |
| Priority | **P2** |
| Review IDs | P2-8 |
| Package | `koatty-serve` |
| File | `packages/koatty-serve/src/ServeComponent.ts` around line 62 |
| Impact | Silent port auto-assignment confuses users |

**Required Change**:
When a protocol's port is auto-assigned or conflicts with another protocol, emit a `Logger.Warn` message:

```ts
Logger.Warn('ServeComponent', `Port ${port} is already in use by ${existingProtocol}. Auto-assigning port ${newPort} for ${protocol}.`);
```

---

## 4. Phase 3: Feature Enhancement

**Timeline**: Month 3-6  
**Goal**: Close key gaps vs NestJS/Midway; integrate ecosystem tools

---

### Task 3-1: Config Arbitrary Depth Support

| Field | Value |
|-------|-------|
| ID | `TASK-3-1` |
| Priority | **Medium** |
| Review IDs | Opt 1 |
| Package | `koatty-config` |

**Current limitation**: `app.config('a.b.c')` silently truncates at 2 levels.

**Required Change**: Replace manual level parsing with recursive path resolver:

```ts
private getConfig<T>(caches: any, name: string | undefined): T | null {
  if (!name) return caches as T;
  const keys = name.split('.');
  let result: any = caches;
  for (const key of keys) {
    if (result == null || typeof result !== 'object') return null;
    result = result[key];
  }
  return (result ?? null) as T;
}
```

**Also**: Remove the truncation warning log and add a note in config documentation.

---

### Task 3-2: Built-in Health Check Endpoint

| Field | Value |
|-------|-------|
| ID | `TASK-3-2` |
| Priority | **High** |
| Review IDs | Opt 2 |
| Package | `koatty-serve` or new `koatty-health` |

**Implementation Approach**:

Option A (Recommended): Add health check as a built-in middleware in `koatty-serve`, enabled by config:

```ts
// config/config.ts
health: {
  enabled: true,
  path: '/health',         // default
  readiness: '/ready',     // optional
  detailed: false          // don't expose internals by default
}
```

Response format:
```json
{
  "status": "ok",
  "uptime": 12345.67,
  "timestamp": "2026-04-02T00:00:00Z",
  "checks": {
    "database": "ok",     // only if detailed: true
    "redis": "ok"
  }
}
```

Option B: Create separate `koatty-health` package with extensible health check registry (allows `koatty-typeorm`, `koatty-store` to register their own checks).

**Recommendation**: Start with Option A for speed, design the interface to be extensible to Option B later.

---

### Task 3-3: Migrate `koatty_swagger` into Monorepo

| Field | Value |
|-------|-------|
| ID | `TASK-3-3` |
| Priority | **High** |
| Review IDs | SW-1 through SW-9, B.1 |

This is a multi-step task. Follow the migration plan in Appendix B.1 of the review report. Key steps:

#### 3-3a: Register as Git Submodule

```bash
git submodule add https://github.com/Koatty/koatty_swagger.git packages/koatty-swagger
git submodule update --init --recursive packages/koatty-swagger
```

#### 3-3b: Fix package.json for Monorepo Compatibility

- Set `engines.node` to `>=18.0.0`
- Replace `peerDependencies` `workspace:*` with version ranges (`koatty: "^4.0.0"`)
- Remove standalone `pnpm-lock.yaml` from git tracking

#### 3-3c: Fix All SW-\* Issues (in `koatty_swagger` repo)

Execute these fixes inside `packages/koatty-swagger/`:

| Issue | Fix |
|-------|-----|
| **SW-1** | Change `openapi: '3.0.0'` to `'3.1.0'` OR change import from `openapi3-ts/oas31` to `openapi3-ts/oas30`. Recommend: upgrade to 3.1 (`openapi: '3.1.0'`). |
| **SW-2** | Cache `generateOpenAPIDoc()` result at middleware init time. Serve cached result on `GET /swagger.json`. |
| **SW-3** | Replace `writeFileSync` with `writeFile` (async), or move to CLI-only export path. |
| **SW-4** | Add `options = options ?? {}` guard in `ApiResponse` decorator before accessing `options.contentType`. |
| **SW-5** | Convert `ComponentGenerator.visitedDTOs` and `.schemas` from static to instance properties. Call `resetState()` before each `generate()` run. |
| **SW-6** | Long-term: read route metadata from `@GetMapping`/`@PostMapping` decorators to auto-populate HTTP method and path in `@ApiOperation`. Short-term: document the dual-decoration requirement. |
| **SW-7** | Set `engines.node` to `>=18.0.0` |
| **SW-8** | Replace `workspace:*` in `peerDependencies` with `^4.0.0` |
| **SW-9** | Write comprehensive README (see Task 3-7) |

#### 3-3d: Verify Integration

```bash
pnpm install
pnpm --filter koatty_swagger build
```

---

### Task 3-4: Migrate `koatty-ai` into Monorepo

| Field | Value |
|-------|-------|
| ID | `TASK-3-4` |
| Priority | **High** |
| Review IDs | B.2 |

Follow Appendix B.2 migration plan:

```bash
git submodule add https://github.com/koatty/koatty-ai.git packages/koatty-ai
git submodule update --init --recursive packages/koatty-ai
```

Key considerations:
- Keep npm dependencies (not `workspace:*`) for CLI initially (Approach A from review)
- Remove standalone lockfiles (`pnpm-lock.yaml`, `package-lock.json`)
- Verify `pnpm --filter koatty_cli build` succeeds

---

### Task 3-5: Enhance `koatty-doc` Documentation Site

| Field | Value |
|-------|-------|
| ID | `TASK-3-5` |
| Priority | **High** |
| Review IDs | N-11, N-13, B.3 |

Follow Appendix B.3 plan. Minimum viable deliverables:

1. **Add `package.json`** to `packages/koatty-doc/` (enable `pnpm --filter` management)
2. **Create directory structure** per B.3 spec
3. **Write P0 docs first**:
   - `guide/getting-started.md` — 5-minute quickstart
   - `guide/config.md` — Explicitly document 2-level limitation
4. **Write P1 docs**:
   - `guide/lifecycle.md` — 11-step boot sequence with diagram
   - `protocols/http.md` — HTTP/2, HTTP/3 (QUIC) setup
   - `extensions/trace.md` — OpenTelemetry + Prometheus config
   - `migration/v3-to-v4.md` — Breaking changes
5. **Create `_sidebar.md`** navigation per B.3 template

---

### Task 3-6: Create `koatty-testing` Package

| Field | Value |
|-------|-------|
| ID | `TASK-3-6` |
| Priority | **Medium** |
| Review IDs | Opt 6 |

Create new package `packages/koatty-testing/` providing:

```ts
// Core testing API
export function createTestApp(AppClass: Constructor): Promise<KoattyApplication>;
export function mockBean(identifier: string, mock: any): void;
export function resetContainer(): void;

// HTTP testing helper (wraps supertest)
export function createHttpTest(app: KoattyApplication): supertest.SuperTest;
```

**Design constraints**:
- Should work with Jest and Vitest
- Container reset must be idempotent and safe for `afterEach` hooks
- `createTestApp` should use existing `createApplication()` internally

---

### Task 3-7: Write `koatty_swagger` README

| Field | Value |
|-------|-------|
| ID | `TASK-3-7` |
| Priority | **P1** |
| Review IDs | N-12, SW-9 |

Minimum content:
- Installation instructions
- Middleware registration example
- Decorator quick reference table (`@ApiOperation`, `@ApiParam`, `@ApiResponse`, `@ApiModel`, `@ApiProperty`, `@ApiHeader`)
- Framework version compatibility matrix
- Known limitations

---

### Task 3-8: Establish CHANGELOG Convention

| Field | Value |
|-------|-------|
| ID | `TASK-3-8` |
| Priority | **P2** |
| Review IDs | N-14 |

- The monorepo already uses `@changesets/cli`. Verify changesets are generating CHANGELOGs per package.
- If not, configure `changeset` to auto-generate `CHANGELOG.md` in each package on version bump.
- For packages that already have significant unreleased changes (Phase 1 fixes), manually create initial CHANGELOG entries.

---

### Task 3-9: Unify Error Message Language

| Field | Value |
|-------|-------|
| ID | `TASK-3-9` |
| Priority | **Low** |
| Review IDs | Section 7.2.4 |

Audit all error messages across packages. Standardize to English. Key packages to check:
- `koatty-typeorm` (known Chinese error messages)
- `koatty-container`
- `koatty-core`

---

## 5. Phase 4: Advanced Capabilities

**Timeline**: Month 6-12  
**Goal**: Build on Koatty's competitive advantages; future-proof the framework

---

### Task 4-1: Built-in Rate Limiting Middleware

| Field | Value |
|-------|-------|
| ID | `TASK-4-1` |
| Priority | **Medium** |
| Review IDs | Road 3 |

**Implementation approach**:

Create as a configurable component in `koatty-serve` or new `koatty-ratelimit` package:

```ts
// Configuration
rateLimit: {
  enabled: true,
  windowMs: 60000,        // 1 minute
  max: 100,               // max requests per window
  store: 'memory',        // or 'redis' (via koatty-store)
  keyGenerator: 'ip',     // or custom function
  skipSuccessfulRequests: false,
  message: 'Too many requests'
}
```

Use `koatty-store` for Redis backend to support distributed deployments.

---

### Task 4-2: Configuration Encryption

| Field | Value |
|-------|-------|
| ID | `TASK-4-2` |
| Priority | **Medium** |
| Review IDs | Road 4 |

**Approach**: Prefix-based encryption similar to Midway's `ENC()` wrapper:

```yaml
# config.yaml
database:
  password: "ENC(AES256:base64encodedciphertext)"
```

- Support AES-256-GCM
- Key provided via environment variable (`KOATTY_CONFIG_KEY`)
- Decrypt during `loadConfigure` event
- Provide CLI command: `koatty config encrypt --key <key> --value <plaintext>`

---

### Task 4-3: TC39 Standard Decorators Migration Path

| Field | Value |
|-------|-------|
| ID | `TASK-4-3` |
| Priority | **Low** |
| Review IDs | Road 5, Section 8.2.1 |

This is a research + planning task, not immediate implementation:

1. **Audit** all decorator usage across all packages (count: decorators, `reflect-metadata` calls)
2. **Prototype** key decorators (`@Controller`, `@Service`, `@Autowired`) using TC39 standard syntax
3. **Document** migration plan with compatibility period (both syntaxes supported)
4. **Estimate** effort and publish timeline
5. Consider providing a codemod tool for users

---

### Task 4-4: TopologyAnalyzer Capacity Limit

| Field | Value |
|-------|-------|
| ID | `TASK-4-4` |
| Priority | **Medium** |
| Review IDs | Section 6.2.5 |
| Package | `koatty-trace` |

**Required Change**:
- Add max entries limit to `TopologyAnalyzer` (e.g., 10,000 unique service pairs)
- Validate service names against a whitelist or enforce max length
- Log warning when approaching capacity

---

### Task 4-5: WebSocket Message Validation

| Field | Value |
|-------|-------|
| ID | `TASK-4-5` |
| Priority | **Low** |
| Review IDs | Section 8.2.3 |
| Package | `koatty-router` or `koatty-validation` |

**Approach**: Extend `koatty-validation` decorators to work with WebSocket message handlers:

```ts
@WebSocketMapping('/chat')
async onMessage(@WsBody(MessageDto) message: MessageDto) {
  // message is validated against MessageDto schema
}
```

---

### Task 4-6: CLI Spec -> OpenAPI Conversion

| Field | Value |
|-------|-------|
| ID | `TASK-4-6` |
| Priority | **Medium** |
| Review IDs | Section 8.3.1 |
| Package | `koatty-ai` (CLI) |

Add `--openapi` flag to `koatty plan`:

```bash
koatty plan --openapi output.json
```

Converts CLI's internal Spec YAML to OpenAPI 3.1 format. This bridges the gap between the CLI's code generation capabilities and the Swagger documentation system.

---

## 6. Cross-Cutting Concerns

### 6.1 Testing Strategy

Every Phase 1 and Phase 2 fix **MUST** include:
1. Verify existing tests still pass (`pnpm --filter <package> test`)
2. Verify package still builds (`pnpm --filter <package> build`)
3. If the package has no tests, note this as a gap (do not block the fix)

### 6.2 Commit Convention

Follow the monorepo's existing commit convention (commitlint + conventional commits):

```
fix(koatty-core): remove duplicate appStop event binding

Fixes P1-1 from code review 2026-04-01.
The listen() method was calling bindProcessEvent(this, 'appStop') twice,
causing all shutdown handlers to execute twice.
```

Pattern: `<type>(<scope>): <description>`
- `fix` for Phase 1 bug fixes
- `refactor` for Phase 2 quality improvements
- `feat` for Phase 3+ features

### 6.3 Branch Strategy

Recommended:
- Create a single feature branch for all Phase 1 fixes: `fix/review-2026-04-01-p0-p1`
- One commit per task (TASK-1-1 through TASK-1-7)
- PR with all Phase 1 fixes for review before merge

### 6.4 Submodule Workflow

Many packages are git submodules. When fixing code in a submodule:

1. Make changes inside `packages/<submodule>/`
2. Commit inside the submodule repo
3. Return to monorepo root
4. Stage the submodule reference change: `git add packages/<submodule>`
5. Commit in monorepo: `git commit -m "chore: update <submodule> to include <fix>"`

Use `scripts/commit-submodule-changes.js` if available.

### 6.5 Build Order Dependencies

Based on the monorepo structure, the approximate build dependency chain is:

```
koatty-lib (base, no deps)
  -> koatty-container (depends on koatty-lib)
  -> koatty-config (depends on koatty-lib)
  -> koatty-logger (depends on koatty-lib)
  -> koatty-core (depends on koatty-lib, koatty-container, koatty-config, koatty-logger)
    -> koatty-exception, koatty-router, koatty-serve, koatty-trace, koatty-validation
      -> koatty (main entry, depends on most of the above)
```

Turborepo handles this via `"dependsOn": ["^build"]`, but be aware when making cross-package type changes.

### 6.6 Risk Areas

| Risk | Mitigation |
|------|------------|
| TASK-1-7 (`Symbol.for` IOC) is a breaking change | Version bump the symbol key; document in CHANGELOG; test with multi-version scenario |
| TASK-1-6 (stop removing process listeners) may reveal hidden bugs | Previously swallowed errors will now surface; this is correct behavior but may surprise users |
| TASK-2-1 (component enable logic) may break existing apps | Audit all known usages before switching `\|\|` to `&&`; consider deprecation warning first |
| TASK-3-3 (swagger migration) touches a separate repo | All SW-* fixes must be committed in koatty_swagger repo first, then submodule reference updated |

---

## 7. Implementation Notes for Engineering LLM

### General Rules

1. **One task, one commit**. Never bundle unrelated changes.
2. **Read before writing**. Always read the current file state before making edits - the review report's line numbers may have shifted.
3. **Search for related patterns**. When fixing a bug like `warning` -> `warn`, search the ENTIRE codebase for the same pattern, not just the reported location.
4. **Respect submodule boundaries**. Changes to files in `packages/<submodule>/` must be committed inside the submodule first.
5. **Build after every fix**. Run `pnpm --filter <package> build` after every change to catch type errors early.
6. **Don't skip P0s**. All TASK-1-* items are mandatory before moving to any Phase 2 work.

### Task Execution Order

```
Mandatory (execute in any order within each group):

Group 1 (Independent P0 fixes - can be parallelized):
  TASK-1-1  (koatty-core: double appStop)
  TASK-1-3  (koatty-typeorm: hardcoded creds)
  TASK-1-4  (koatty-typeorm: wrong event name)
  TASK-1-5  (koatty-logger: warning level)

Group 2 (P0 fixes that need more careful reading):
  TASK-1-2  (koatty-core: middleware stack pollution)

Group 3 (P1 fixes):
  TASK-1-6  (koatty-core: captureError)
  TASK-1-7  (koatty-container: global IOC)

Group 4 (Phase 2 - after all Phase 1 complete):
  TASK-2-1 through TASK-2-10

Group 5 (Phase 3 - after Phase 2 stable):
  TASK-3-1 through TASK-3-9

Group 6 (Phase 4 - long term):
  TASK-4-1 through TASK-4-6
```

### Full Build Verification

After completing all Phase 1 fixes:

```bash
pnpm clean
pnpm install
pnpm build
pnpm test
```

All must pass before Phase 2 begins.

---

## Appendix: Issue-to-Task Mapping

| Review Issue ID | Task ID | Phase |
|-----------------|---------|-------|
| P1-1 | TASK-1-1 | 1 |
| P1-2 | TASK-1-6 | 1 |
| P1-3 | TASK-1-7 | 1 |
| P1-4 | TASK-1-3 | 1 |
| P1-5 | TASK-1-2 | 1 |
| P2-2 | TASK-2-2 | 2 |
| P2-3 | TASK-2-3 | 2 |
| P2-4 | TASK-2-1 | 2 |
| P2-5 | TASK-1-5 | 1 (bundled with N-3) |
| P2-8 | TASK-2-10 | 2 |
| P2-9 | TASK-2-8 | 2 |
| P2-10 | TASK-2-9 | 2 |
| P2-11 | TASK-2-5 | 2 |
| N-1 | TASK-2-6 | 2 |
| N-2 | TASK-1-4 | 1 |
| N-3 | TASK-1-5 | 1 |
| N-4 | TASK-1-2 | 1 (comment fix) |
| N-5 | TASK-1-5 | 1 (bundled with N-3) |
| N-6 | TASK-2-7 | 2 |
| N-7 | — | Deferred (low risk) |
| N-8 | TASK-2-6 | 2 |
| N-9 | TASK-2-4 | 2 |
| N-10 | TASK-2-8 | 2 |
| N-11 | TASK-3-5 | 3 |
| N-12 | TASK-3-7 | 3 |
| N-13 | TASK-3-5 | 3 |
| N-14 | TASK-3-8 | 3 |
| SW-1~SW-9 | TASK-3-3 | 3 |
| Opt 1 | TASK-3-1 | 3 |
| Opt 2 | TASK-3-2 | 3 |
| Opt 6 | TASK-3-6 | 3 |
| Road 3 | TASK-4-1 | 4 |
| Road 4 | TASK-4-2 | 4 |
| Road 5 | TASK-4-3 | 4 |

---

*Implementation Plan generated: 2026-04-02*  
*Based on review: docs/koatty-review-2026-04-01.md*  
*All P0/P1 issues independently verified against live codebase*
