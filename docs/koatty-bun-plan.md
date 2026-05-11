# koatty-bun 完整方案

> 状态：草案 v2  
> 日期：2026-05-10  
> 作者：richenlin  
> 修订：基于代码库实际结构 + Bun 1.3.x API + 兼容性评估报告优化  
>
> ⚠️ **本方案已被整合到** [`koatty-bun-tc39-integrated-plan.md`](./koatty-bun-tc39-integrated-plan.md)（2026-05-11）  
> 整合方案在阶段路线图、ADR、风险登记上**优先于本文档**。  
> 本文档保留作为 Bun 协议层细节、`BunXxxServer` 实现、可观测性方案的详细参考。  
> 实施前请先阅读整合方案 §1-§4 章节。

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [整体架构](#2-整体架构)
3. [Phase 1 — packages/koatty-bun](#3-phase-1--packageskoatty-bun)
4. [Phase 2 — 各组件 bun 分支](#4-phase-2--各组件-bun-分支)
5. [Phase 3 — 协议服务器适配详解](#5-phase-3--协议服务器适配详解)
6. [Phase 4 — 可观测性适配](#6-phase-4--可观测性适配)
7. [Phase 5 — koatty-ai 适配](#7-phase-5--koatty-ai-适配)
8. [Phase 6 — Monorepo 基础设施](#8-phase-6--monorepo-基础设施)
9. [风险登记与缓解措施](#9-风险登记与缓解措施)
10. [性能基准测试计划](#10-性能基准测试计划)
11. [测试策略](#11-测试策略)
12. [开发工作流与调试指南](#12-开发工作流与调试指南)
13. [实施顺序与优先级](#13-实施顺序与优先级)
14. [技术决策记录](#14-技术决策记录)

---

## 1. 背景与目标

### 1.1 背景

koatty 框架核心依赖链：

```
koatty
  └── koatty_core  (继承 Koa，基于 Node.js http 模块)
  └── koatty_serve (Node.js http/https/http2/http3/grpc/ws 实现)
```

Bun runtime 的 HTTP 服务器使用 Web 标准 `fetch` API（`Request / Response`），与 Node.js 的 `IncomingMessage / ServerResponse` 事件模型完全不同，无法直接运行。

**关键事实**（基于 `bun-compatibility-assessment-2026-04-16.md`）：

- 24 个包中 8 个（33%）无需修改
- 10 个（42%）需少量适配
- 4 个（17%）需重大改造
- 2 个（8%）存在阻断风险（`koatty_trace` OpenTelemetry、`koatty_serve` HTTP/3）

### 1.2 目标

1. 创建 `koatty-bun` 子项目——koatty 框架在 Bun runtime 下的适配版本
2. 各核心组件如需 Bun 适配，在独立仓库创建 `bun` 分支
3. `koatty-ai` 脚手架新增 `--runtime bun` 参数，生成的项目依赖来自 `bun` 分支的组件版本
4. **新增**：提供 koatty_trace 在 Bun 下的可观测性降级方案

### 1.3 设计原则

- **用户 0 改动**：应用代码只需将 `import from 'koatty'` 替换为 `import from 'koatty-bun'`
- **渐进落地**：P0 协议（HTTP/WS）优先，HTTP/3 降级处理，gRPC 兼容运行
- **接口稳定**：所有 Bun 服务器类继承 `BaseServer<T, S>`，实现全部抽象方法
- **可回退**：任何 Bun 适配均不破坏 Node.js 原有实现，用户可随时切回

### 1.4 范围边界

| 包含 | 不包含 |
|------|--------|
| HTTP/HTTPS/HTTP2/WS/WSS 原生 Bun 服务器 | HTTP/3 原生实现（降级到 HTTP/2） |
| gRPC 经 Node compat 层运行 | gRPC Bun 原生实现 |
| OpenTelemetry 手动 Instrumentation | OpenTelemetry Auto-Instrumentation |
| Koa 中间件链兼容运行 | Koa 替代方案 |

---

## 2. 整体架构

### 2.1 用户视角

```typescript
// Node.js 项目（不变）
import { Koatty, Controller, Service } from 'koatty';

// Bun 项目（仅替换入口包）
import { Koatty, Controller, Service } from 'koatty-bun';
```

### 2.2 包依赖关系

```
koatty-bun (新包, packages/koatty-bun)
  ├── re-exports: koatty (所有装饰器、DI、AOP 等)
  ├── overrides:  BunBootstrap (Bootstrap 的 Bun 感知版)
  ├── depends on: koatty_serve@bun   ← bun 分支版本
  └── depends on: koatty_core@bun    ← bun 分支版本
         └── depends on: koatty_loader@bun
                          koatty_config@bun
                          (其余不变)
```

### 2.3 运行时分发（koatty_serve/bun 分支）

```
SingleProtocolServer.createServerInstance()
  │
  ├─ typeof Bun !== 'undefined' ?
  │    ├── http     → BunHttpServer      (Bun.serve fetch handler)
  │    ├── https    → BunHttpsServer     (Bun.serve + tls)
  │    ├── http2    → BunHttp2Server     (Bun.serve + tls, ALPN 自动 h2)
  │    ├── http3    → BunHttp3Server     (内部降级 → BunHttp2Server + warning)
  │    ├── ws/wss   → BunWsServer        (Bun.serve websocket handler)
  │    ├── grpc     → GrpcServer         (原实现，经 Node compat 层)
  │    └── graphql  → BunHttpServer      (底层复用 HTTP)
  │
  └─ Node.js 原有实现（不变）
       ├── http/graphql → HttpServer
       ├── https        → HttpsServer
       ├── http2        → Http2Server
       ├── http3        → Http3Server
       ├── ws/wss       → WsServer
       └── grpc         → GrpcServer
```

### 2.4 Bun 服务器类继承体系

```
BaseServer<T, S> (koatty_serve/src/server/base.ts)
  │
  ├── HttpServer<HttpServerOptions, http.Server>              ← 现有 Node.js
  ├── HttpsServer<HttpsServerOptions, https.Server>           ← 现有 Node.js
  ├── Http2Server<Http2ServerOptions, Http2SecureServer>       ← 现有 Node.js
  ├── Http3Server<Http3ServerOptions, ...>                     ← 现有 Node.js
  ├── WsServer<WebSocketServerOptions, WS.WebSocketServer>     ← 现有 Node.js
  ├── GrpcServer<GrpcServerOptions, gRPCServer>                ← 现有 Node.js (Bun 复用)
  │
  ├── BunHttpServer<HttpServerOptions, BunServer>              ← 新增 Bun
  ├── BunHttpsServer<HttpsServerOptions, BunServer>            ← 新增 Bun
  ├── BunHttp2Server<Http2ServerOptions, BunServer>            ← 新增 Bun
  ├── BunHttp3Server<Http3ServerOptions, BunServer>            ← 新增 Bun (降级)
  └── BunWsServer<WebSocketServerOptions, BunServer>           ← 新增 Bun
```

> **关键约束**：所有 Bun 服务器必须实现 `BaseServer` 的全部抽象方法，包括连接池管理、优雅关闭、配置热更新。

---

## 3. Phase 1 — packages/koatty-bun

### 3.1 目录结构

```
packages/koatty-bun/
├── src/
│   ├── index.ts                    # 主入口：re-export koatty + 覆盖 Bun 专用实现
│   ├── bootstrap/
│   │   └── BunBootstrap.ts         # ExecBootStrap 的 Bun 感知版本
│   └── types.ts                    # Bun 特有类型扩展
├── package.json
├── tsconfig.json
└── README.md
```

### 3.2 `index.ts`

```typescript
// 复用 koatty 全部能力（DI、AOP、装饰器等）
export * from 'koatty';

// 覆盖 Bootstrap，提供 Bun 感知版本
export { ExecBootStrap, createApplication } from './bootstrap/BunBootstrap';
```

### 3.3 `BunBootstrap.ts`

对照现有 `packages/koatty/src/core/Bootstrap.ts` 的实际实现：

```typescript
import { Koatty, KoattyApplication } from 'koatty_core';
import { IOC } from 'koatty_container';
import { Loader } from 'koatty/core/Loader';
import { checkRuntime } from 'koatty/util/Helper';

/**
 * Bun 感知的 bootstrapApplication
 * 与原版逻辑一致，但在启动前检测 Bun 运行时
 */
async function bootstrapApplication(
  target: any,
  bootFunc?: (...args: any[]) => any,
  isInitiative = false,
): Promise<KoattyApplication> {
  const app = Reflect.construct(target, []) as KoattyApplication;

  // Bun 环境检测与版本校验（由 koatty_core/bun 分支的 checkRuntime 处理）
  checkRuntime();

  if (typeof Bun !== 'undefined') {
    app.env('RUNTIME', 'bun');
    app.env('RUNTIME_VERSION', Bun.version);
    console.log(`[koatty-bun] Running on Bun ${Bun.version}`);
  }

  // 以下与原 bootstrapApplication 逻辑完全一致
  Loader.initialize(app);
  if (bootFunc) {
    await bootFunc(app);
  }
  IOC.setApp(app);
  Loader.CheckAllComponents(app, target);
  await Loader.LoadAllComponents(app, target);
  app.markReady();

  return app;
}

/**
 * 执行引导（启动服务器监听）
 */
async function executeBootstrap(
  target: any,
  bootFunc?: (...args: any[]) => any,
  isInitiative = true,
): Promise<void> {
  const app = await bootstrapApplication(target, bootFunc, isInitiative);
  // 服务器层由 koatty_serve/bun 分支的运行时分发自动切换到 Bun 实现
  app.listen();
}

/**
 * ExecBootStrap 装饰器
 */
export function ExecBootStrap(bootFunc?: (...args: any[]) => any) {
  return (target: any) => {
    if (!(target.prototype instanceof Koatty)) {
      throw new Error(`class ${target.name} does not inherit from Koatty`);
    }
    return executeBootstrap(target, bootFunc, true);
  };
}

/**
 * 创建应用实例但不监听（用于 serverless / 测试场景）
 */
export async function createApplication(
  target: any,
  bootFunc?: (...args: any[]) => any,
): Promise<KoattyApplication> {
  return bootstrapApplication(target, bootFunc, false);
}
```

### 3.4 `types.ts`

```typescript
import type { Server as BunNativeServer } from 'bun';

/**
 * 扩展 NativeServer 类型以包含 Bun Server
 * koatty_core/bun 分支需在 IApplication.ts 中添加此类型
 */
export type BunServer = BunNativeServer;

/**
 * Bun 运行时检测
 */
export function isBunRuntime(): boolean {
  return typeof globalThis.Bun !== 'undefined';
}

/**
 * 获取 Bun 版本，非 Bun 环境返回 null
 */
export function getBunVersion(): string | null {
  return isBunRuntime() ? Bun.version : null;
}
```

### 3.5 `package.json`

```json
{
  "name": "koatty-bun",
  "version": "1.0.0",
  "description": "koatty loves bun — Koatty framework adaptation for Bun runtime",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types":   "./dist/index.d.ts",
      "import":  "./dist/index.mjs",
      "require": "./dist/index.js"
    }
  },
  "engines": {
    "bun":  ">=1.1.0",
    "node": ">=18.0.0"
  },
  "keywords": ["koatty", "bun", "framework", "typescript"],
  "license": "BSD-3-Clause",
  "dependencies": {
    "koatty":          "workspace:*",
    "koatty_core":     "workspace:*",
    "koatty_serve":    "workspace:*"
  },
  "peerDependencies": {
    "bun-types": ">=1.1.0"
  },
  "peerDependenciesMeta": {
    "bun-types": { "optional": true }
  }
}
```

> **说明**：`koatty_core` 和 `koatty_serve` 在 monorepo 中使用 `workspace:*`；发布时锁定为各自 `bun` tag 版本（`koatty_serve@bun`）。

---

## 4. Phase 2 — 各组件 bun 分支

### 4.1 各组件适配优先级

| 组件 | 独立仓库 | bun 分支必要性 | 改动内容 |
|------|---------|--------------|---------|
| `koatty_serve` | github.com/Koatty/koatty_serve | **P0 必须** | 新增全部 BunXxxServer 实现 + 运行时分发 |
| `koatty_core` | github.com/Koatty/koatty_core | **P0 必须** | `NativeServer` 类型扩展、`checkRuntime()` 支持 Bun、移除 Node.js 硬限制 |
| `koatty_trace` | github.com/Koatty/koatty_trace | **P0 必须** | 手动 Instrumentation 替代 Auto-Instrumentation（详见 Phase 4） |
| `koatty_loader` | github.com/Koatty/koatty_loader | P1 | 用 `Bun.file()` 替换 `fs.readFile`，加速启动扫描 |
| `koatty_config` | github.com/Koatty/koatty_config | P1 | `Bun.file()` 加速配置文件读取 |
| `koatty_logger` | github.com/Koatty/koatty_logger | P2 | Bun console 彩色输出优化；验证 `winston-daily-rotate-file` 兼容性 |
| `koatty_router` | github.com/Koatty/koatty_router | P2 | 仅 `engines` 字段更新，路由逻辑无需改动 |
| `koatty_container` | — | **不需要** | 纯 TS IoC，无 Node.js API 依赖 |
| `koatty_lib` | — | **不需要** | 纯工具函数（`process.getuid/getgid` 已有条件判断） |
| `koatty_exception` | — | **不需要** | 纯错误处理 |
| `koatty_validation` | — | **不需要** | 纯参数验证 |
| `koatty_store` | — | **不需要** | `ioredis` + `lru-cache`，Bun 全兼容 |

### 4.2 bun 分支发布策略

各组件的 `bun` 分支发布到 npm 时使用 `bun` dist-tag：

```bash
# 在各组件仓库的 bun 分支上
npm publish --tag bun

# 安装时
npm install koatty_serve@bun
```

`koatty-bun` 的 `package.json` 在发布时锁定各依赖的 `bun` tag：

```json
{
  "dependencies": {
    "koatty_serve": "3.3.0-bun.1",
    "koatty_core":  "2.3.0-bun.1",
    "koatty_trace": "1.5.0-bun.1"
  }
}
```

### 4.3 koatty_core/bun 分支关键改动

#### 4.3.1 checkRuntime() 增加 Bun 支持

```typescript
// src/Utils.ts — checkRuntime()
export function checkRuntime() {
  // Bun runtime 跳过 Node.js 版本检查
  if (typeof Bun !== 'undefined') {
    const bunVersion = Bun.version;
    const minBun = '1.1.0';
    if (semverLt(bunVersion, minBun)) {
      Logger.Fatal(`koatty requires Bun >= ${minBun}, current: ${bunVersion}`);
    }
    return;
  }
  // 原有 Node.js 版本检查逻辑不变
  // ...
}
```

#### 4.3.2 NativeServer 类型扩展

```typescript
// src/IApplication.ts — NativeServer 类型
import type { Server as BunNativeServer } from 'bun';

// 原有类型
type NodeNativeServer = Server | SecureServer | Http2SecureServer | gRPCServer | WebSocketServer;

// 扩展后类型：在 Bun 环境下接受 BunNativeServer
type NativeServer = NodeNativeServer | BunNativeServer;
```

> **注意**：需要在 `peerDependencies` 中添加 `bun-types`（optional），确保类型编译不报错。

#### 4.3.3 process.execArgv 兼容

```typescript
// Bun 不支持 process.execArgv，需条件判断
const isDebugMode = typeof process.execArgv !== 'undefined'
  ? process.execArgv.some(arg => /--inspect|--debug/.test(arg))
  : false;
```

### 4.4 koatty_loader/bun 分支关键改动

```typescript
// 用 Bun.file() 替换 fs.readFile，提升文件扫描性能
async function readFileContent(filePath: string): Promise<string> {
  if (typeof Bun !== 'undefined') {
    return await Bun.file(filePath).text();   // 比 fs.readFile 快 ~2x
  }
  return await fs.promises.readFile(filePath, 'utf-8');
}
```

---

## 5. Phase 3 — 协议服务器适配详解

### 5.1 Bun 能力矩阵（基于 Bun 1.3.x）

| 协议 | Bun 原生支持 | 底层机制 | 与 Node.js 关键差异 |
|------|------------|---------|------------------|
| **http** | ✅ 完整 | `Bun.serve({ fetch })` | fetch handler vs 事件回调 |
| **https** | ✅ 完整 | `Bun.serve({ tls, fetch })` | TLS 配置使用 `Bun.file()` |
| **http2** | ✅ 完整 | TLS + ALPN 自动协商 h2 | 无需显式 http2 开关，TLS 自动支持 |
| **http3** | ❌ 不支持 | QUIC 未实现 | 降级到 HTTP/2 + 告警 |
| **ws** | ✅ 完整 | `Bun.serve({ websocket })` | WS 与 HTTP **共享同一端口** |
| **wss** | ✅ 完整 | 同上 + TLS | 同上 |
| **grpc** | ⚠️ 兼容 | `@grpc/grpc-js` 经 Node compat 层 | 性能略有损耗，双向流存在风险 |
| **graphql** | ✅ 完整 | 底层复用 BunHttpServer | 与 HTTP 处理一致 |

---

### 5.2 Koa Bridge（所有 HTTP 协议的核心适配）

所有 HTTP 类协议（http/https/http2/graphql）都依赖此桥接层。

**文件**：`koatty_serve/bun branch: src/adapter/bun-koa-bridge.ts`

#### 方案 A — 直接使用 node:http compat（推荐，快速落地）

Bun 内置完整的 `node:http` 兼容实现。**核心思路**：不使用 `Bun.serve()` 的 fetch handler，而是直接调用 `http.createServer()` / `https.createServer()`，让 Koa 零改动运行在 Bun 的 Node compat 层上。

```typescript
// 方案 A：BunHttpServer 直接复用 Node.js 路径
// 此方案下 BunHttpServer 与 HttpServer 几乎相同，
// 区别仅在于构造函数添加 Bun 运行时提示

import { createServer, Server } from 'node:http';  // Bun 的 node:http 兼容实现
import { KoattyApplication, NativeServer } from 'koatty_core';
import { BaseServer } from './base';
import { HttpServerOptions } from '../config/config';

export class BunHttpServer extends BaseServer<HttpServerOptions, Server> {
  protected createProtocolServer(): void {
    if (typeof Bun !== 'undefined') {
      this.logger.info(`[BunHttpServer] Using Bun ${Bun.version} node:http compat layer`);
    }

    // 直接使用 node:http API — Koa 零改动
    this.server = createServer(async (req, res) => {
      try {
        await healthMiddleware(req, res, async () => {
          this.app.callback()(req, res);
        });
      } catch (error) {
        this.logger.error('Request handling error', {}, error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      }
    });
  }
}
```

**优势**：工程量极小（~50 行差异），Koa 中间件链零适配，连接池/优雅关闭逻辑可完全复用 `HttpServer`。

**劣势**：无法利用 Bun 原生 `fetch` handler 的性能优势（约 10~15% 性能损耗）。

#### 方案 B — Bun.serve() 原生 + Request/Response 桥接（最优性能）

使用 `Bun.serve()` 的原生 `fetch` handler，手动将 Web 标准 `Request` 转换为 Node.js `IncomingMessage`，将 Koa 产出的响应转换回 Web 标准 `Response`。

```typescript
import type { Server as BunServer } from 'bun';

/**
 * 将 Bun Web Request 转换为 Node.js IncomingMessage 兼容对象
 */
function createNodeRequest(bunReq: Request): NodeIncomingMessageLike {
  const url = new URL(bunReq.url);
  return {
    method:  bunReq.method,
    url:     url.pathname + url.search,
    headers: Object.fromEntries(bunReq.headers.entries()),
    // body stream 适配
    on(event: string, handler: (...args: any[]) => void) {
      if (event === 'data') {
        bunReq.body?.pipeTo(new WritableStream({
          write(chunk) { handler(Buffer.from(chunk)); }
        }));
      }
      if (event === 'end') {
        bunReq.body?.pipeTo(new WritableStream({
          close() { handler(); }
        })).catch(() => handler());
        if (!bunReq.body) queueMicrotask(() => handler());
      }
    },
    socket: {
      remoteAddress: '0.0.0.0',  // Bun 无法直接获取，需从 server.requestIP(req) 获取
      remotePort:    0,
      encrypted:     url.protocol === 'https:',
    },
  } as any;
}

/**
 * 创建 Node.js ServerResponse mock，收集响应数据后构建 Web Response
 */
function createNodeResponse(): {
  res: NodeServerResponseLike;
  getResponse: () => Response;
} {
  let statusCode = 200;
  const headers = new Headers();
  const bodyChunks: Uint8Array[] = [];

  const res = {
    statusCode,
    setHeader(name: string, value: string) { headers.set(name, value); },
    getHeader(name: string) { return headers.get(name); },
    removeHeader(name: string) { headers.delete(name); },
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code;
      if (hdrs) Object.entries(hdrs).forEach(([k, v]) => headers.set(k, v));
    },
    write(chunk: any) {
      bodyChunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
      return true;
    },
    end(chunk?: any) {
      if (chunk) this.write(chunk);
      this.finished = true;
      // 触发 finish 事件
      this._finishCallbacks?.forEach((cb: () => void) => cb());
    },
    finished: false,
    headersSent: false,
    _finishCallbacks: [] as (() => void)[],
    on(event: string, cb: (...args: any[]) => void) {
      if (event === 'finish') this._finishCallbacks.push(cb);
      return this;
    },
  } as any;

  const getResponse = (): Response => {
    const body = bodyChunks.length > 0
      ? new Blob(bodyChunks)
      : null;
    return new Response(body, { status: statusCode, headers });
  };

  return { res, getResponse };
}

/**
 * Bun Request → Koa 中间件链 → Bun Response
 */
export async function bunKoaBridge(
  app: KoattyApplication,
  bunRequest: Request,
  server: BunServer,
): Promise<Response> {
  const req = createNodeRequest(bunRequest);
  const { res, getResponse } = createNodeResponse();

  // 注入 Bun 特有信息（如客户端 IP）
  const clientIP = server.requestIP(bunRequest);
  if (clientIP) {
    (req as any).socket.remoteAddress = clientIP.address;
    (req as any).socket.remotePort = clientIP.port;
  }

  await new Promise<void>((resolve, reject) => {
    res.on('finish', resolve);
    res.on('error', reject);
    try {
      app.callback()(req as any, res as any);
    } catch (e) {
      reject(e);
    }
  });

  return getResponse();
}
```

**优势**：利用 Bun 原生 HTTP 栈性能（约 2.5x Node.js 吞吐）。

**劣势**：IncomingMessage/ServerResponse mock 约 400~600 行，需覆盖所有 Koa 使用的属性和方法；需要完整的集成测试验证边界情况。

> **落地建议**：Phase 1 使用方案 A 快速跑通；通过 benchmark 验证性能差距后（见第 10 章），决定是否迁移到方案 B。

---

### 5.3 HTTP → BunHttpServer（方案 B 实现）

**文件**：`src/server/bun-http.ts`

以下为方案 B 的完整实现（方案 A 见 5.2 节，结构更简单）。

```typescript
import type { Server as BunServer, Serve } from 'bun';
import { KoattyApplication, NativeServer } from 'koatty_core';
import { generateTraceId } from '../utils/logger';
import { BaseServer, ConfigChangeAnalysis } from './base';
import { ConfigHelper, HttpServerOptions, ListeningOptions } from '../config/config';
import { createHealthCheckMiddleware } from '../middleware/healthCheck';
import { bunKoaBridge } from '../adapter/bun-koa-bridge';

export class BunHttpServer extends BaseServer<HttpServerOptions, BunServer> {
  // Bun 内建连接管理，使用简化的请求计数器替代 Node.js 连接池
  private activeRequests = 0;
  private totalRequests = 0;

  constructor(app: KoattyApplication, options: HttpServerOptions) {
    super(app, options);
    this.options = ConfigHelper.createHttpConfig(options);
    this.initializeServer();
  }

  // ============= 实现 BaseServer 抽象方法 =============

  protected initializeConnectionPool(): void {
    // Bun 内部管理 HTTP 连接，不需要用户态连接池
    // 使用 activeRequests 计数器追踪请求数
    this.logger.debug('Bun manages connections internally, using request counter');
  }

  protected createProtocolServer(): void {
    const healthMiddleware = createHealthCheckMiddleware(this.options.health);

    this.server = Bun.serve({
      port:     this.options.port,
      hostname: this.options.hostname,

      fetch: async (req: Request, server: BunServer): Promise<Response> => {
        this.activeRequests++;
        this.totalRequests++;

        try {
          // 健康检查短路（Web 标准 Request → Response）
          const healthRes = await healthMiddleware.handleBunRequest?.(req);
          if (healthRes) return healthRes;

          return await bunKoaBridge(this.app, req, server);
        } catch (error) {
          this.logger.error('Request handling error', {}, error);
          return new Response(
            JSON.stringify({ error: 'Internal Server Error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        } finally {
          this.activeRequests--;
        }
      },

      // Bun 全局错误处理器
      error(error: Error): Response | Promise<Response> {
        console.error('[BunHttpServer] Unhandled error:', error);
        return new Response('Internal Server Error', { status: 500 });
      },
    });
  }

  protected configureServerOptions(): void {
    // Bun.serve() 在创建时已配置完毕，无额外配置步骤
  }

  protected analyzeConfigChanges(
    changedKeys: (keyof HttpServerOptions)[],
    oldConfig: HttpServerOptions,
    newConfig: HttpServerOptions,
  ): ConfigChangeAnalysis {
    const criticalKeys: (keyof ListeningOptions)[] = ['hostname', 'port', 'protocol'];
    if (changedKeys.some(key => criticalKeys.includes(key as keyof ListeningOptions))) {
      return {
        requiresRestart: true,
        changedKeys: changedKeys as string[],
        restartReason: 'Critical network configuration changed',
        canApplyRuntime: false,
      };
    }
    return {
      requiresRestart: false,
      changedKeys: changedKeys as string[],
      canApplyRuntime: true,
    };
  }

  protected onRuntimeConfigChange(
    _analysis: ConfigChangeAnalysis,
    _newConfig: Partial<HttpServerOptions>,
    traceId: string,
  ): void {
    this.logger.info('Bun HTTP server runtime config updated', { traceId });
  }

  protected extractRelevantConfig(config: HttpServerOptions) {
    return {
      hostname: config.hostname,
      port:     config.port,
      protocol: config.protocol,
    };
  }

  // ============= 优雅关闭（利用 Bun server.stop() API）=============

  protected async stopAcceptingNewConnections(traceId: string): Promise<void> {
    this.logger.info('Stopping acceptance of new connections', { traceId });
    // Bun server.stop() 默认会等待 in-flight 请求完成
    // 先标记状态，实际 stop 在 forceCloseRemainingConnections 中执行
    this.status = 0;
  }

  protected async waitForConnectionCompletion(timeout: number, traceId: string): Promise<void> {
    this.logger.info('Waiting for in-flight requests to complete', { traceId }, {
      activeRequests: this.activeRequests,
      timeout,
    });

    const startTime = Date.now();
    while (this.activeRequests > 0) {
      if (Date.now() - startTime >= timeout) {
        this.logger.warn('Request completion timeout', { traceId }, {
          remaining: this.activeRequests,
        });
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  protected async forceCloseRemainingConnections(traceId: string): Promise<void> {
    if (this.server) {
      if (this.activeRequests > 0) {
        // 强制关闭：server.stop(true) 立即终止所有连接
        this.logger.warn('Force stopping with active requests', { traceId }, {
          activeRequests: this.activeRequests,
        });
        await this.server.stop(true);
      } else {
        // 优雅关闭：等待 in-flight 请求完成
        await this.server.stop();
      }
    }
  }

  protected forceShutdown(traceId: string): void {
    this.logger.warn('Force shutdown initiated', { traceId });
    this.server?.stop(true);
    this.stopMonitoringAndCleanup(traceId);
  }

  // ============= KoattyServer 接口 =============

  Start(listenCallback?: () => void): any {
    this.startTime = Date.now();
    this.status = 200;

    const protocolUpper = this.options.protocol.toUpperCase();
    const serverUrl = `http://${this.options.hostname || '127.0.0.1'}:${this.options.port}/`;
    this.logger.info(`Server: ${protocolUpper} running at ${serverUrl}`, {});

    listenCallback?.();
    return this.server;
  }

  getStatus(): number {
    return this.status;
  }

  getNativeServer(): NativeServer {
    return this.server as any;
  }

  async destroy(): Promise<void> {
    const traceId = generateTraceId();
    this.logger.info('Destroying Bun HTTP server', { traceId });
    try {
      await this.gracefulShutdown();
    } catch (error) {
      this.logger.error('Error destroying server', { traceId }, error);
      throw error;
    }
  }
}
```

---

### 5.4 HTTPS → BunHttpsServer

**文件**：`src/server/bun-https.ts`

```typescript
import type { Server as BunServer } from 'bun';
import { BaseServer } from './base';
import { HttpsServerOptions } from '../config/config';
import { bunKoaBridge } from '../adapter/bun-koa-bridge';

export class BunHttpsServer extends BaseServer<HttpsServerOptions, BunServer> {

  protected createProtocolServer(): void {
    // Bun TLS 配置：推荐使用 Bun.file() 读取证书，性能最优
    const keyPath  = this.options.ssl?.key;
    const certPath = this.options.ssl?.cert;

    if (!keyPath || !certPath) {
      throw new Error('SSL key and cert paths are required for HTTPS');
    }

    this.server = Bun.serve({
      port:     this.options.port,
      hostname: this.options.hostname,

      tls: {
        key:  Bun.file(keyPath),    // Bun.file() 懒读取，比 fs.readFileSync 更高效
        cert: Bun.file(certPath),
        ca:   this.options.ssl?.ca ? Bun.file(this.options.ssl.ca) : undefined,
        passphrase:         this.options.ssl?.passphrase,
        rejectUnauthorized: this.options.ssl?.rejectUnauthorized ?? true,
      },

      fetch: async (req, server) => {
        this.activeRequests++;
        this.totalRequests++;
        try {
          return await bunKoaBridge(this.app, req, server);
        } catch (error) {
          this.logger.error('Request handling error', {}, error);
          return new Response('Internal Server Error', { status: 500 });
        } finally {
          this.activeRequests--;
        }
      },

      error(error: Error): Response {
        console.error('[BunHttpsServer] Unhandled error:', error);
        return new Response('Internal Server Error', { status: 500 });
      },
    });
  }

  // ... 其余抽象方法实现与 BunHttpServer 结构一致，继承相同模式
}
```

---

### 5.5 HTTP/2 → BunHttp2Server

**文件**：`src/server/bun-http2.ts`

**关键差异**：Bun **不需要显式开启 HTTP/2**。配置了 TLS 后，Bun 通过 ALPN 自动协商 `h2 / http/1.1`，底层实现与 `BunHttpsServer` 相同，仅 protocol 标识不同。

```typescript
export class BunHttp2Server extends BaseServer<Http2ServerOptions, BunServer> {

  protected createProtocolServer(): void {
    // Bun TLS 服务器自动支持 HTTP/2（ALPN h2），无需额外配置
    // 实现与 BunHttpsServer 相同
    this.server = Bun.serve({
      port:     this.options.port,
      hostname: this.options.hostname,
      tls:      this.buildTlsOptions(),
      fetch:    async (req, server) => {
        this.activeRequests++;
        try {
          return await bunKoaBridge(this.app, req, server);
        } finally {
          this.activeRequests--;
        }
      },
      error: (error) => {
        this.logger.error('Unhandled error', {}, error);
        return new Response('Internal Server Error', { status: 500 });
      },
    });
    // 此 server 同时支持 HTTP/1.1 + HTTP/2（由客户端 ALPN 决定）
  }

  private buildTlsOptions() {
    const keyPath  = this.options.ssl?.key;
    const certPath = this.options.ssl?.cert;
    if (!keyPath || !certPath) {
      throw new Error('TLS key and cert are required for HTTP/2');
    }
    return {
      key:  Bun.file(keyPath),
      cert: Bun.file(certPath),
      ca:   this.options.ssl?.ca ? Bun.file(this.options.ssl.ca) : undefined,
    };
  }
}
```

---

### 5.6 HTTP/3 → BunHttp3Server（降级）

**文件**：`src/server/bun-http3.ts`

Bun 不支持 HTTP/3/QUIC，提供带警告的降级实现：

```typescript
export class BunHttp3Server extends BaseServer<Http3ServerOptions, BunServer> {

  protected createProtocolServer(): void {
    this.logger.warn(
      '[BunHttp3Server] HTTP/3 (QUIC) is not supported by Bun ' +
      `${typeof Bun !== 'undefined' ? Bun.version : 'unknown'}. ` +
      'Automatically falling back to HTTP/2 (TLS). ' +
      'Track upstream: https://github.com/oven-sh/bun/issues/887'
    );

    // HTTP/3 配置必然包含 TLS，直接复用 HTTP/2 实现
    this.server = Bun.serve({
      port:     this.options.port,
      hostname: this.options.hostname,
      tls:      this.buildTlsOptions(),
      fetch:    async (req, server) => {
        this.activeRequests++;
        try {
          return await bunKoaBridge(this.app, req, server);
        } finally {
          this.activeRequests--;
        }
      },
      error: (error) => {
        this.logger.error('Unhandled error', {}, error);
        return new Response('Internal Server Error', { status: 500 });
      },
    });
  }

  private buildTlsOptions() {
    const keyPath  = this.options.ssl?.key;
    const certPath = this.options.ssl?.cert;
    if (!keyPath || !certPath) {
      throw new Error('TLS key and cert are required');
    }
    return {
      key:  Bun.file(keyPath),
      cert: Bun.file(certPath),
      ca:   this.options.ssl?.ca ? Bun.file(this.options.ssl.ca) : undefined,
    };
  }
}
```

---

### 5.7 WebSocket/WSS → BunWsServer（架构变化最大）

**文件**：`src/server/bun-ws.ts`

**核心架构差异**：

| | 现有 WsServer（Node.js） | BunWsServer |
|--|--|--|
| 底层 | `ws` 库 + 独立 HTTP server | Bun.serve() 内建 WebSocket |
| 端口 | WS 与 HTTP 可分离 | **必须共享同一端口** |
| 升级 | HTTP server 发出 `upgrade` 事件 | `fetch` handler 中调用 `server.upgrade(req)` |
| 消息 | EventEmitter（`ws.on('message', ...)`) | 回调函数（`websocket.message(ws, msg)`） |
| 发布/订阅 | 需手动实现 | Bun 内建 `ws.subscribe()`/`server.publish()` |

```typescript
import type { Server as BunServer, ServerWebSocket } from 'bun';
import { EventEmitter } from 'node:events';
import { KoattyApplication, NativeServer } from 'koatty_core';
import { generateTraceId } from '../utils/logger';
import { BaseServer, ConfigChangeAnalysis } from './base';
import { ConfigHelper, ListeningOptions, WebSocketServerOptions } from '../config/config';
import { bunKoaBridge } from '../adapter/bun-koa-bridge';

// WebSocket 连接元数据
interface WsConnectionData {
  connectionId: string;
  url: string;
  headers: Record<string, string>;
  connectedAt: number;
}

export class BunWsServer extends BaseServer<WebSocketServerOptions, BunServer> {
  private activeWsConnections = new Map<string, ServerWebSocket<WsConnectionData>>();
  private activeRequests = 0;

  constructor(app: KoattyApplication, options: WebSocketServerOptions) {
    super(app, options);
    this.options = ConfigHelper.createWebSocketConfig(options);
    this.initializeServer();
  }

  protected initializeConnectionPool(): void {
    // Bun 内部管理 WebSocket 连接
    this.logger.debug('Bun manages WebSocket connections internally');
  }

  protected createProtocolServer(): void {
    const isSecure = this.options.protocol === 'wss';

    this.server = Bun.serve({
      port:     this.options.port,
      hostname: this.options.hostname,
      tls:      isSecure ? this.buildTlsOptions() : undefined,

      // HTTP 请求走 Koa；WebSocket 握手在此触发升级
      fetch: async (req: Request, server: BunServer): Promise<Response | undefined> => {
        if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
          const connectionId = generateTraceId();
          const upgraded = server.upgrade(req, {
            data: {
              connectionId,
              url:         req.url,
              headers:     Object.fromEntries(req.headers.entries()),
              connectedAt: Date.now(),
            } satisfies WsConnectionData,
          });
          if (upgraded) return undefined; // 已升级，Bun 不需要返回 Response
          return new Response('WebSocket upgrade failed', { status: 400 });
        }

        // 普通 HTTP 请求走 Koa 中间件链
        this.activeRequests++;
        try {
          return await bunKoaBridge(this.app, req, server);
        } finally {
          this.activeRequests--;
        }
      },

      // Bun 原生 WebSocket 处理器
      websocket: {
        maxPayloadLength: this.options.wsOptions?.maxPayload as number ?? 16 * 1024 * 1024,
        idleTimeout:      120,

        open: (ws: ServerWebSocket<WsConnectionData>) => {
          this.activeWsConnections.set(ws.data.connectionId, ws);
          this.logger.debug('WebSocket connected', {}, {
            connectionId: ws.data.connectionId,
            total: this.activeWsConnections.size,
          });

          // 将 Bun ServerWebSocket 适配为 koatty 需要的接口
          const adapted = new BunWsAdapter(ws);
          (this.app as any).emit('connection', adapted, {
            url: ws.data.url,
            headers: ws.data.headers,
          });
        },

        message: (ws: ServerWebSocket<WsConnectionData>, message: string | Buffer) => {
          const adapted = new BunWsAdapter(ws);
          this.handleWsMessage(adapted, message, ws.data);
        },

        close: (ws: ServerWebSocket<WsConnectionData>, code: number, reason: string) => {
          this.activeWsConnections.delete(ws.data.connectionId);
          this.logger.debug('WebSocket disconnected', {}, {
            connectionId: ws.data.connectionId,
            code,
            reason,
            remaining: this.activeWsConnections.size,
          });
        },

        drain: (_ws: ServerWebSocket<WsConnectionData>) => {
          // 背压释放，可恢复发送
        },
      },

      error: (error: Error) => {
        this.logger.error('Server error', {}, error);
        return new Response('Internal Server Error', { status: 500 });
      },
    });
  }

  /**
   * 处理 WebSocket 消息，通过 app.callback('ws') 走中间件链
   */
  private handleWsMessage(
    adapted: BunWsAdapter,
    message: string | Buffer,
    data: WsConnectionData,
  ): void {
    // 构建伪 req/res 对象，与现有 WsServer 的 message handler 行为一致
    const pseudoReq: any = {
      method: 'MESSAGE',
      url: '/',
      headers: data.headers,
      socket: adapted,
      websocket: adapted,
      wsData: message,
      wsConnectionId: data.connectionId,
    };

    const pseudoRes: any = {
      writeHead: () => {},
      setHeader: () => {},
      end: (responseData?: any) => {
        if (responseData != null) {
          try {
            adapted.send(typeof responseData === 'string'
              ? responseData
              : JSON.stringify(responseData));
          } catch (error) {
            this.logger.error('Error sending WS response', {}, error);
          }
        }
      },
      websocket: adapted,
      finished: false,
    };

    const wsHandler = this.app.callback('ws');
    wsHandler(pseudoReq, pseudoRes).catch((error: Error) => {
      this.logger.error('WS message handling error', {}, {
        connectionId: data.connectionId,
        error: error.message,
      });
    });
  }

  // ... 其余抽象方法实现与 BunHttpServer 结构一致

  protected configureServerOptions(): void { /* Bun 在创建时配置完毕 */ }

  protected analyzeConfigChanges(
    changedKeys: (keyof WebSocketServerOptions)[],
    _oldConfig: WebSocketServerOptions,
    _newConfig: WebSocketServerOptions,
  ): ConfigChangeAnalysis {
    const criticalKeys: (keyof ListeningOptions)[] = ['hostname', 'port', 'protocol'];
    if (changedKeys.some(key => criticalKeys.includes(key as keyof ListeningOptions))) {
      return {
        requiresRestart: true,
        changedKeys: changedKeys as string[],
        restartReason: 'Critical network configuration changed',
        canApplyRuntime: false,
      };
    }
    return { requiresRestart: false, changedKeys: changedKeys as string[], canApplyRuntime: true };
  }

  protected onRuntimeConfigChange(
    _analysis: ConfigChangeAnalysis,
    _newConfig: Partial<WebSocketServerOptions>,
    traceId: string,
  ): void {
    this.logger.info('Bun WS runtime config updated', { traceId });
  }

  protected extractRelevantConfig(config: WebSocketServerOptions) {
    return {
      hostname: config.hostname,
      port: config.port,
      protocol: config.protocol,
      isSecure: config.protocol === 'wss',
    };
  }

  protected async stopAcceptingNewConnections(traceId: string): Promise<void> {
    this.logger.info('Stopping new connections', { traceId });
    this.status = 0;
  }

  protected async waitForConnectionCompletion(timeout: number, traceId: string): Promise<void> {
    const startTime = Date.now();
    while (this.activeWsConnections.size > 0 || this.activeRequests > 0) {
      if (Date.now() - startTime >= timeout) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  protected async forceCloseRemainingConnections(traceId: string): Promise<void> {
    // 关闭所有活跃 WebSocket 连接
    for (const [id, ws] of this.activeWsConnections) {
      try {
        ws.close(1001, 'Server shutting down');
      } catch { /* ignore */ }
    }
    this.activeWsConnections.clear();

    // 停止 Bun server
    if (this.server) {
      await this.server.stop(this.activeRequests > 0);
    }
  }

  protected forceShutdown(traceId: string): void {
    for (const [_, ws] of this.activeWsConnections) {
      try { ws.close(1001, 'Forced shutdown'); } catch { /* ignore */ }
    }
    this.activeWsConnections.clear();
    this.server?.stop(true);
    this.stopMonitoringAndCleanup(traceId);
  }

  protected getActiveConnectionCount(): number {
    return this.activeWsConnections.size + this.activeRequests;
  }

  Start(listenCallback?: () => void): any {
    this.startTime = Date.now();
    this.status = 200;

    const proto = this.options.protocol.toUpperCase();
    const urlProto = this.options.protocol === 'wss' ? 'wss' : 'ws';
    const url = `${urlProto}://${this.options.hostname || '127.0.0.1'}:${this.options.port}/`;
    this.logger.info(`Server: ${proto} running at ${url}`, {});

    listenCallback?.();
    return this.server;
  }

  getStatus(): number { return this.status; }
  getNativeServer(): NativeServer { return this.server as any; }

  async destroy(): Promise<void> {
    const traceId = generateTraceId();
    try { await this.gracefulShutdown(); }
    catch (error) { this.logger.error('Destroy error', { traceId }, error); throw error; }
  }

  private buildTlsOptions() {
    const keyPath  = this.options.ssl?.key;
    const certPath = this.options.ssl?.cert;
    if (!keyPath || !certPath) throw new Error('TLS key and cert required for WSS');
    return {
      key:  Bun.file(keyPath),
      cert: Bun.file(certPath),
      ca:   this.options.ssl?.ca ? Bun.file(this.options.ssl.ca) : undefined,
    };
  }
}
```

**BunWsAdapter**（保证上层路由代码无需修改）：

```typescript
// src/adapter/bun-ws-adapter.ts
import type { ServerWebSocket } from 'bun';
import { EventEmitter } from 'node:events';

/**
 * 将 Bun ServerWebSocket 适配为 koatty_router 需要的接口
 * 关键：需要实现 EventEmitter 接口，因为 koatty_router 的 WS 路由
 * 依赖 ws.on('message', ...) 模式
 */
export class BunWsAdapter extends EventEmitter {
  constructor(private readonly ws: ServerWebSocket<any>) {
    super();
  }

  send(data: string | Buffer | ArrayBuffer): void {
    this.ws.send(data);
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }

  get readyState(): number {
    return this.ws.readyState;
  }

  get remoteAddress(): string {
    return this.ws.remoteAddress;
  }

  /**
   * 订阅 Bun 内建的 pub/sub topic
   */
  subscribe(topic: string): void {
    this.ws.subscribe(topic);
  }

  /**
   * 退订 Bun 内建的 pub/sub topic
   */
  unsubscribe(topic: string): void {
    this.ws.unsubscribe(topic);
  }

  /**
   * 发布消息到 topic（利用 Bun 内建 pub/sub，比手动广播高效）
   */
  publish(topic: string, data: string | Buffer): void {
    this.ws.publish(topic, data);
  }

  /**
   * 获取底层 Bun ServerWebSocket 实例
   */
  get raw(): ServerWebSocket<any> {
    return this.ws;
  }
}
```

> **为什么继承 EventEmitter**：现有 `koatty_router` 的 WebSocket 路由处理使用 `ws.on('message', handler)` 模式（基于 `ws` 库的 EventEmitter 接口）。Bun 的 `ServerWebSocket` 不使用 EventEmitter，事件通过 `websocket` handler 的回调函数处理。`BunWsAdapter` 继承 `EventEmitter` 桥接两种模式，在 `BunWsServer.websocket.message` 回调中手动 `emit('message', data)` 触发上层监听器。

---

### 5.8 gRPC → 兼容运行

**文件**：`src/server/grpc.ts`（在 bun 分支中修改现有文件）

`@grpc/grpc-js` 是纯 JS 实现（无原生 C++ 扩展），经 Bun 的 `node:net / node:tls / node:http2` 兼容层可运行，**现有 GrpcServer 代码无需重写**，仅增加 Bun 运行时提示和兼容性守卫：

```typescript
protected createProtocolServer(): void {
  if (typeof Bun !== 'undefined') {
    this.logger.warn(
      '[GrpcServer] Running @grpc/grpc-js on Bun via Node.js compat layer. ' +
      'Functional compatibility is maintained but performance may differ from Node.js.'
    );

    // 在 Bun 下禁用不稳定的功能
    if (this.options.ext?.enableBidiStreaming) {
      this.logger.warn(
        '[GrpcServer] Bidirectional streaming on Bun may be unstable. ' +
        'Recommend using Unary/ServerStreaming only, or running gRPC on Node.js.'
      );
    }
  }
  // 以下与现有 GrpcServer 完全相同
  this.server = new Server(this.buildChannelOptions());
}
```

> **已知限制**（来自兼容性评估）：
> - `@grpc/grpc-js` 内部依赖 `node:net`、`node:tls`、`node:http2`，Bun compat 层已支持
> - 双向流（Bidirectional Streaming）是最高风险场景
> - ALB/Envoy 代理后可能出现 Protocol Error
> - **验收条件**：CI 中 Bun 环境下 Unary + ServerStreaming 测试通过

---

### 5.9 serve.ts 工厂更新（运行时分发）

```typescript
// src/server/serve.ts — createServerInstance() 增加 Bun 分支
private createServerInstance(protocolType: string, options: ListeningOptions): any {

  if (typeof Bun !== 'undefined') {
    // 延迟导入，避免 Node.js 环境加载 Bun 类型报错
    const { BunHttpServer }  = require('./bun-http');
    const { BunHttpsServer } = require('./bun-https');
    const { BunHttp2Server } = require('./bun-http2');
    const { BunHttp3Server } = require('./bun-http3');
    const { BunWsServer }    = require('./bun-ws');

    const bunServerMap: Record<string, any> = {
      http:    BunHttpServer,
      https:   BunHttpsServer,
      http2:   BunHttp2Server,
      http3:   BunHttp3Server,   // 内部降级到 http2 + warning
      ws:      BunWsServer,
      wss:     BunWsServer,
      graphql: BunHttpServer,    // GraphQL 底层是 HTTP
      grpc:    GrpcServer,       // 保持原实现，经 Node compat 层运行
    };
    const BunServerClass = bunServerMap[protocolType] ?? BunHttpServer;
    return new BunServerClass(this.app, options);
  }

  // Node.js 原有映射（不变）
  const serverMap: Record<string, any> = {
    grpc:    GrpcServer,
    ws:      WsServer,
    wss:     WsServer,
    https:   KoattyHttpsServer,
    http2:   Http2Server,
    http3:   Http3Server,
    http:    KoattyHttpServer,
    graphql: KoattyHttpServer,
  };
  return new (serverMap[protocolType] ?? KoattyHttpServer)(this.app, options);
}
```

> **注意**：使用 `require()` 延迟导入 Bun 服务器类，确保在 Node.js 环境下不会因缺少 `bun` 类型而报错。各 Bun 服务器文件顶部的 `import type` 仅用于类型检查，不产生运行时依赖。

---

## 6. Phase 4 — 可观测性适配

> **背景**（来自兼容性评估 风险 1）：`koatty_trace` 深度依赖 OpenTelemetry Node.js SDK，`@opentelemetry/sdk-node` 官方不支持 Bun，auto-instrumentation 依赖 Node.js `--require` 预加载和 CJS 模块拦截。

### 6.1 影响范围

| 功能 | Node.js | Bun |
|------|---------|-----|
| Auto-Instrumentation（Koa/HTTP/gRPC） | ✅ | ❌ 不可用 |
| 手动 Span 创建 | ✅ | ✅ 可用 |
| Prometheus 指标导出 | ✅ | ⚠️ 需验证 |
| OTLP Trace 导出 | ✅ | ⚠️ 需验证 |
| Console 导出 | ✅ | ✅ 可用 |

### 6.2 Bun 可观测性方案

**策略**：在 `koatty_trace/bun` 分支中，用 Programmatic SDK 初始化替代 Auto-Instrumentation。

```typescript
// koatty_trace/bun: src/BunTraceSetup.ts

import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { KoaInstrumentation } from '@opentelemetry/instrumentation-koa';

/**
 * Bun 环境下的 OpenTelemetry 手动初始化
 * 替代 auto-instrumentation 的 --require 预加载机制
 */
export function initBunTracing(options: {
  serviceName: string;
  otlpEndpoint?: string;
  prometheusPort?: number;
  enableKoaInstrumentation?: boolean;
}) {
  const resource = new Resource({
    'service.name': options.serviceName,
    'runtime.name': 'bun',
    'runtime.version': typeof Bun !== 'undefined' ? Bun.version : 'unknown',
  });

  // 手动配置 instrumentations（不使用 auto-instrumentations-node）
  const instrumentations = [];
  if (options.enableKoaInstrumentation) {
    // KoaInstrumentation 需要在 Bun 下手动注册，
    // 而非通过 --require 自动 monkey-patch
    instrumentations.push(new KoaInstrumentation());
  }

  const sdk = new NodeSDK({
    resource,
    spanProcessor: new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: options.otlpEndpoint || 'http://localhost:4318/v1/traces',
      })
    ),
    instrumentations,
    // 关键：不使用 --preload 或 auto-detection
  });

  sdk.start();

  // 注册 Bun 进程退出钩子
  if (typeof Bun !== 'undefined') {
    process.on('SIGTERM', async () => {
      await sdk.shutdown();
      process.exit(0);
    });
  }

  return sdk;
}
```

### 6.3 降级告警

在 Bun 环境下，`koatty_trace` 应在启动时输出明确的能力降级告警：

```typescript
if (typeof Bun !== 'undefined') {
  logger.warn(
    '[koatty_trace] Running on Bun runtime. The following features are degraded:\n' +
    '  - Auto-instrumentation: DISABLED (using manual instrumentation)\n' +
    '  - HTTP auto-tracing: DISABLED (use manual span creation)\n' +
    '  - gRPC auto-tracing: DISABLED\n' +
    'See: https://koatty.org/docs/bun-observability for details.'
  );
}
```

### 6.4 验收标准

1. 手动创建的 Span 能正确导出到 OTLP Collector
2. Prometheus `/metrics` 端点可正常访问（通过 `SingleProtocolServer.getMetrics()`）
3. `KoaInstrumentation` 手动注册后，请求链路中可见 Koa 中间件 Span
4. 服务启动时有明确的功能降级日志

---

## 7. Phase 5 — koatty-ai 适配

### 7.1 新增 `--runtime bun` 参数

```bash
koatty new my-app --runtime bun
# 简写
koatty new my-app -r bun
```

`src/cli/commands/new.ts` 改动：

```typescript
program
  .command('new <project-name>')
  .option('-r, --runtime <runtime>', '目标运行时 (node|bun)', 'node')
  .action(async (projectName, options) => {
    const runtime = options.runtime?.toLowerCase() ?? 'node';
    if (!['node', 'bun'].includes(runtime)) {
      console.error(`不支持的 runtime: ${runtime}，可选 node|bun`);
      process.exit(1);
    }
    const templateType = runtime === 'bun' ? 'project-bun' : 'project';
    // 后续使用 templateType 加载模板
  });
```

### 7.2 TemplateManager 新增 bun 模板仓库

`src/services/TemplateManager.ts` 改动：

```typescript
private static readonly TEMPLATE_REPOS = {
  // 现有模板（不变）
  project: {
    github: 'https://github.com/koatty/koatty-ai-template-project.git',
    gitee:  'https://gitee.com/koatty/koatty-ai-template-project.git',
  },
  modules: { /* ... */ },
  component: { /* ... */ },

  // 新增 Bun 项目模板
  'project-bun': {
    github: 'https://github.com/koatty/koatty-ai-template-project-bun.git',
    gitee:  'https://gitee.com/koatty/koatty-ai-template-project-bun.git',
  },
};
```

### 7.3 Bun 项目模板内容

**新建仓库**：`koatty/koatty-ai-template-project-bun`

```
koatty-ai-template-project-bun/
├── package.json.hbs
├── bunfig.toml.hbs
├── tsconfig.json.hbs
├── README.md.hbs
├── src/
│   ├── App.ts.hbs
│   ├── config/
│   │   └── config.ts.hbs
│   ├── controller/
│   │   └── HomeController.ts.hbs
│   └── service/
│       └── TestService.ts.hbs
└── test/
    └── App.test.ts.hbs
```

**`package.json.hbs`** 关键差异：

```json
{
  "name": "{{projectName}}",
  "version": "1.0.0",
  "description": "application created by koatty (bun runtime)",
  "main": "src/App.ts",
  "scripts": {
    "dev":   "bun run --watch src/App.ts",
    "start": "bun run src/App.ts",
    "build": "bun build src/App.ts --outdir dist --target bun",
    "test":  "bun test"
  },
  "engines": {
    "bun": ">=1.1.0"
  },
  "license": "BSD-3-Clause",
  "dependencies": {
    "koatty-bun": "^1.0.0",
    "reflect-metadata": "^0.2.0",
    "tslib": "^2.6.0"
  },
  "devDependencies": {
    "bun-types":   ">=1.1.0",
    "@types/node": "^22.0.0"
  }
}
```

> **与 Node 模板的关键区别**：
> - 依赖 `koatty-bun` 替代 `koatty`
> - 无 `tsx`、`ts-jest`、`cross-env`（Bun 原生支持 TS 和测试）
> - 无 `rimraf`（`bun build` 无需预清理）
> - scripts 使用 `bun run` 替代 `npm run`

**`bunfig.toml.hbs`**：

```toml
# Bun 配置文件
[install]
# 包管理镜像（可选）
# registry = "https://registry.npmmirror.com"

[test]
# 测试超时（毫秒）
timeout = 5000

[run]
# 启动时自动加载环境变量
# bun run 会自动读取 .env 文件
```

**`tsconfig.json.hbs`**：

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

---

## 8. Phase 6 — Monorepo 基础设施

### 8.1 pnpm-workspace.yaml

无需修改，`packages/*` 通配符已包含 `packages/koatty-bun`。

### 8.2 turbo.json 构建依赖图

现有 `turbo.json` 已使用 `^build` 依赖链，`koatty-bun` 依赖 `koatty`、`koatty_core`、`koatty_serve`，turbo 会自动按拓扑顺序构建，无需额外配置。

### 8.3 CI — Bun 测试矩阵

`.github/workflows/ci.yml` 新增（在现有 `lint` / `test` / `build` 三个 job 基础上添加）：

```yaml
jobs:
  # ... 现有 lint, test, build jobs ...

  test-bun:
    name: Test on Bun
    runs-on: ubuntu-latest
    strategy:
      matrix:
        bun-version: [latest, '1.1.0']  # 测试最低支持版本 + 最新版
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${{ matrix.bun-version }}

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build koatty-bun and dependencies
        run: bun run build --filter=koatty-bun...

      - name: Test koatty-bun
        run: bun test packages/koatty-bun

      - name: Test koatty_serve (Bun servers)
        run: bun test packages/koatty-serve --grep "Bun"

      - name: Test gRPC compatibility on Bun
        run: bun test packages/koatty-serve --grep "gRPC.*Bun"
        continue-on-error: true  # gRPC 在 Bun 上有已知风险

      - name: Verify decorator metadata
        run: bun test packages/koatty-container --grep "reflect-metadata"

  benchmark-bun:
    name: Performance Benchmark
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    needs: [test-bun]
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: bun install
      - name: Run comparative benchmark
        run: |
          # Node.js baseline
          node benchmarks/http-throughput.js > /tmp/node-results.json
          # Bun
          bun benchmarks/http-throughput.js > /tmp/bun-results.json
          # Compare
          bun benchmarks/compare.ts /tmp/node-results.json /tmp/bun-results.json
```

### 8.4 Changeset 配置

`koatty-bun` 自动参与 changeset 版本管理，无需额外配置。

---

## 9. 风险登记与缓解措施

基于 `bun-compatibility-assessment-2026-04-16.md` 识别的风险，结合本方案的架构设计：

| ID | 风险 | 级别 | 影响 | 缓解措施 | 状态 |
|----|------|------|------|---------|------|
| R1 | OpenTelemetry auto-instrumentation 不兼容 | **关键** | 丢失自动链路追踪、指标采集 | Phase 4 手动 Instrumentation 方案 + 降级告警 | 方案已设计 |
| R2 | gRPC 双向流不稳定 | **高** | 生产 gRPC 服务可能异常 | gRPC 不重写，经 Node compat 运行；CI 添加兼容测试；文档标注限制 | 方案已设计 |
| R3 | HTTP/3 (QUIC) 不可用 | **高** | HTTP/3 协议无法使用 | BunHttp3Server 降级到 HTTP/2 + 警告日志 | 方案已设计 |
| R4 | Decorator Metadata 行为变化 | **中** | IoC 容器注入异常 | 锁定 Bun 版本；CI 测试 reflect-metadata；tsconfig 显式配置 | 待实施 |
| R5 | `ws` 库与 Bun 原生 WS 的接口差异 | **中** | koatty_router WS 路由兼容问题 | BunWsAdapter 继承 EventEmitter 桥接 | 方案已设计 |
| R6 | BunKoaBridge 方案 B 的 mock 完整性 | **中** | Koa 中间件使用未 mock 的属性导致异常 | Phase 1 用方案 A 规避；方案 B 需完整集成测试覆盖 | 待实施 |
| R7 | `winston-daily-rotate-file` 文件轮转兼容性 | **低** | 日志文件轮转异常 | P2 阶段验证；降级为 winston 基础 file transport | 待验证 |
| R8 | `process.execArgv` Bun 兼容性 | **低** | 调试模式检测失败 | 条件判断保护 | 方案已设计 |

### 回退策略

若 Bun 适配在某个阶段遇到阻断性问题：

1. **包级回退**：`koatty-bun` 的 `package.json` 将依赖切回 Node.js 版本（去掉 `@bun` dist-tag）
2. **用户级回退**：用户将 `import from 'koatty-bun'` 改回 `import from 'koatty'`，应用代码无需其他修改
3. **功能级回退**：特定协议（如 gRPC）可配置为仅在 Node.js 下启用

---

## 10. 性能基准测试计划

### 10.1 测试目标

| 场景 | 目标指标 | 基准（Node.js） |
|------|---------|----------------|
| HTTP QPS（hello world） | > 2x Node.js | `HttpServer` 当前值 |
| HTTP QPS（Koa 中间件链 5 层） | > 1.5x Node.js | `HttpServer` + middleware |
| HTTP 延迟 P99 | < Node.js P99 | `HttpServer` P99 |
| WebSocket 连接数 | >= Node.js | `WsServer` 当前值 |
| WebSocket 消息吞吐 | > 1.5x Node.js | `WsServer` 当前值 |
| 启动时间 | < 0.5x Node.js | `koatty` 冷启动时间 |
| 内存占用（idle） | < Node.js | `koatty` 空闲内存 |

### 10.2 测试工具

- **HTTP**：[bombardier](https://github.com/codesenberg/bombardier) 或 `wrk`
- **WebSocket**：[websocat](https://github.com/vi/websocat) + 自定义压测脚本
- **对比框架**：同时测试 `koatty` (Node) vs `koatty-bun` (Bun)

### 10.3 测试矩阵

```
环境：
  - 硬件：GitHub Actions ubuntu-latest (2 vCPU, 7GB RAM)
  - Node.js: v22 LTS
  - Bun: latest stable

场景：
  1. bare HTTP (无中间件)
  2. 5 层 Koa 中间件 (logger, auth, validation, handler, error)
  3. JSON 序列化 (1KB / 10KB / 100KB payload)
  4. WebSocket echo (10/100/1000 并发连接)
  5. 冷启动时间 (time to first request)

关键对比：
  - 方案 A (node:http compat) vs 方案 B (Bun.serve native)
  - 方案 A vs 原生 Node.js HttpServer
```

### 10.4 决策门限

| 对比 | 条件 | 决策 |
|------|------|------|
| 方案 A vs Node.js | 性能差距 < 5% | 保持方案 A（工程简单） |
| 方案 A vs Node.js | 性能差距 5-15% | 根据用户反馈决定 |
| 方案 A vs Node.js | 性能差距 > 15% | 迁移到方案 B |
| 方案 B vs 方案 A | 方案 B 提升 < 10% | 不值得迁移 |
| 方案 B vs 方案 A | 方案 B 提升 >= 10% | 迁移到方案 B |

---

## 11. 测试策略

### 11.1 测试层次

| 层次 | 覆盖范围 | 工具 | 运行环境 |
|------|---------|------|---------|
| 单元测试 | 各 BunXxxServer 类、BunKoaBridge、BunWsAdapter | `bun:test` | Bun |
| 集成测试 | 服务器启动/停止、HTTP 请求响应、WS 连接 | `bun:test` + fetch | Bun |
| E2E 测试 | 完整 koatty-bun 应用启动、路由、中间件 | `bun:test` + supertest | Bun |
| 兼容测试 | gRPC Unary/Streaming、reflect-metadata、winston | `bun:test` | Bun |
| 对比测试 | 同一测试用例在 Node.js 和 Bun 下运行 | jest + `bun:test` | Both |

### 11.2 关键测试用例

```typescript
// packages/koatty-serve/test/bun-http.test.ts
import { describe, test, expect } from 'bun:test';

describe('BunHttpServer', () => {
  test('should start and respond to HTTP requests', async () => {
    // 创建 BunHttpServer，发送 fetch 请求，验证响应
  });

  test('should handle concurrent requests', async () => {
    // 发送 100 个并发请求，验证全部成功
  });

  test('should graceful shutdown with in-flight requests', async () => {
    // 发送长请求，触发 shutdown，验证请求完成后才停止
  });

  test('should force shutdown when timeout', async () => {
    // 发送不结束的请求，触发 shutdown(timeout=100ms)，验证强制终止
  });
});

describe('BunWsServer', () => {
  test('should upgrade HTTP to WebSocket', async () => {
    // 发送 WS 连接请求，验证升级成功
  });

  test('should route messages through Koa middleware chain', async () => {
    // 发送 WS 消息，验证经过中间件处理
  });

  test('should handle HTTP and WS on same port', async () => {
    // 同一端口同时发送 HTTP 和 WS 请求
  });
});

describe('BunKoaBridge', () => {
  test('should correctly convert Request to IncomingMessage', async () => {
    // 验证 headers、method、url、body 正确转换
  });

  test('should correctly convert Koa response to Response', async () => {
    // 验证 status、headers、body 正确转换
  });

  test('should handle streaming body', async () => {
    // 验证大 body 的流式传输
  });
});
```

### 11.3 验收标准

- [ ] 所有 Bun 服务器单元测试通过
- [ ] HTTP E2E 测试覆盖率 > 80%
- [ ] WebSocket E2E 测试覆盖率 > 70%
- [ ] gRPC Unary + ServerStreaming 测试通过（Bun 环境）
- [ ] reflect-metadata 装饰器测试通过
- [ ] 优雅关闭测试通过（正常 + 超时 + 强制）
- [ ] 性能基准测试完成并记录

---

## 12. 开发工作流与调试指南

### 12.1 本地开发

```bash
# 1. 克隆 monorepo
git clone --recursive https://github.com/Koatty/koatty-monorepo.git
cd koatty-monorepo

# 2. 安装依赖（pnpm 用于 monorepo 管理）
pnpm install

# 3. 构建基础依赖
pnpm -r build --filter=koatty_core --filter=koatty_serve --filter=koatty

# 4. 开发 koatty-bun（使用 Bun 运行测试）
cd packages/koatty-bun
bun test --watch

# 5. 开发 Bun 服务器（在 koatty-serve 中）
cd packages/koatty-serve
bun test --watch --grep "Bun"
```

### 12.2 调试

```bash
# Bun 调试（支持 Chrome DevTools）
bun --inspect src/App.ts

# 然后在 Chrome 打开 chrome://inspect 连接调试器

# 环境变量调试日志
KOATTY_LOG_LEVEL=debug bun run src/App.ts
```

### 12.3 快速验证

创建最小测试应用验证 Bun 适配是否工作：

```typescript
// examples/bun-hello/App.ts
import { Koatty, Controller, GetMapping, ExecBootStrap } from 'koatty-bun';

@Controller('/')
class HomeController {
  @GetMapping('/')
  index() {
    return 'Hello from koatty-bun!';
  }
}

@ExecBootStrap()
class App extends Koatty {}
```

```bash
cd examples/bun-hello
bun run App.ts
# 访问 http://localhost:3000/ 验证
```

---

## 13. 实施顺序与优先级

### 阶段划分

```
Week 1-2: 跑通最小可用版本（MVP）
  ├── koatty_core/bun: checkRuntime() + engines + NativeServer 类型扩展
  ├── koatty_serve/bun: BunHttpServer (方案A, node:http compat)
  ├── packages/koatty-bun: 框架搭建 + BunBootstrap
  └── 基础集成测试 + examples/bun-hello 验证

Week 3: WebSocket + HTTPS/HTTP2
  ├── koatty_serve/bun: BunWsServer + BunWsAdapter
  ├── koatty_serve/bun: BunHttpsServer + BunHttp2Server
  ├── koatty_serve/bun: BunHttp3Server (降级实现)
  └── WebSocket 集成测试

Week 4: 可观测性 + gRPC 验证
  ├── koatty_trace/bun: 手动 Instrumentation 方案（Phase 4）
  ├── gRPC 兼容性集成测试（Unary + ServerStreaming）
  └── reflect-metadata 稳定性测试

Week 5: 性能 + 优化
  ├── 性能基准测试（方案 A vs Node.js）
  ├── 根据结果决定是否开发方案 B (BunKoaBridge 原生版)
  ├── koatty_loader/bun: Bun.file() 优化
  └── koatty_config/bun: Bun.file() 优化

Week 6: koatty-ai + 模板
  ├── koatty-ai: --runtime bun 参数
  ├── koatty-ai: TemplateManager 新增 project-bun
  └── 新建 koatty-ai-template-project-bun 模板仓库

Week 7: CI + 文档 + 发布
  ├── CI Bun 测试矩阵 + benchmark job
  ├── npm 发布（bun dist-tag）
  └── README + 迁移指南 + API 文档
```

### 最小可用版本（MVP）交付物

完成以下即可支持最常见的 HTTP/WebSocket 场景：

1. `koatty_core/bun` — `checkRuntime()` + `NativeServer` 类型
2. `BunHttpServer` (方案 A, node:http compat)
3. `BunWsServer` + `BunWsAdapter`
4. `packages/koatty-bun` 入口包 + `BunBootstrap`
5. 基础测试通过 + examples/bun-hello 可运行

### 里程碑

| 里程碑 | 时间 | 交付物 | 验收标准 |
|--------|------|--------|---------|
| M1: MVP | Week 2 | HTTP + 入口包 | `bun run examples/bun-hello/App.ts` 成功响应 |
| M2: 全协议 | Week 3 | WS/HTTPS/HTTP2 | 各协议集成测试通过 |
| M3: 可观测 | Week 4 | Trace + gRPC | 手动 Span 可导出；gRPC Unary 测试通过 |
| M4: 优化 | Week 5 | 性能报告 + 方案决策 | benchmark 报告输出；方案 A/B 决策完成 |
| M5: 工具链 | Week 6 | koatty-ai + 模板 | `koatty new test-app -r bun` 成功 |
| M6: 发布 | Week 7 | npm 发布 | `npm install koatty-bun` 可用 |

---

## 14. 技术决策记录

### ADR-001：BunKoaBridge 初版使用方案 A（Node compat 层）

**决策**：Phase 1 使用 Bun 内建 `node:http` compat 层，直接 `createServer()` 运行 Koa。  
**理由**：工程量最小，Koa 零改动运行，连接池/优雅关闭逻辑可完全复用 `HttpServer`。  
**后续**：通过 benchmark 对比方案 A vs 方案 B vs 原生 Node.js，若方案 A 性能损耗 > 15% 则迁移方案 B。

### ADR-002：koatty-bun 作为 meta-adapter 包而非 fork

**决策**：`koatty-bun` 通过 re-export 复用 `koatty` 全部能力，仅覆盖 Bootstrap 和服务器层。  
**理由**：维护单一代码库，装饰器/DI/AOP 等核心逻辑无需复制。  
**权衡**：用户需替换 import 来源，但应用代码 0 改动。

### ADR-003：HTTP/3 降级而非报错

**决策**：Bun 下 `http3` 协议自动降级到 HTTP/2，打印 warning，不抛出错误。  
**理由**：避免现有配置了 http3 的应用在切换到 Bun 后直接崩溃；降级行为有完整日志。  
**后续**：待 Bun 支持 HTTP/3 后，替换 `BunHttp3Server.createProtocolServer()` 内部实现。

### ADR-004：BunWsServer 共享端口设计

**决策**：`BunWsServer` 的 HTTP 和 WebSocket 共享同一个 `Bun.serve()` 实例（同端口）。  
**理由**：这是 Bun 的强制约束，无法绕过。  
**影响**：当 WebSocket 和 HTTP 配置不同端口时，koatty-bun 会忽略分离端口配置并打印 warning。应在文档中明确说明此限制。

### ADR-005：gRPC 不重写，经 Node compat 层运行

**决策**：`@grpc/grpc-js` 代码保持不变，在 Bun 上通过 Node.js compat 层运行。  
**理由**：grpc-js 是纯 JS 实现，Bun 的 `node:net/tls/http2` 已支持；重写成本高且收益不确定。  
**验收条件**：在 CI 中加入 Bun 环境下的 gRPC 端对端测试，覆盖 Unary/ServerStreaming 场景。Bidirectional Streaming 标注为实验性。

### ADR-006：可观测性使用手动 Instrumentation

**决策**：在 Bun 下不使用 OpenTelemetry auto-instrumentation，改用 Programmatic SDK 初始化 + 手动 instrument。  
**理由**：`@opentelemetry/sdk-node` 官方不支持 Bun；auto-instrumentation 依赖 `--require` 预加载和 CJS monkey-patching，Bun 不兼容。  
**影响**：用户在 Bun 环境下需手动配置 tracing（`initBunTracing()`），自动链路追踪不可用。启动时输出明确的功能降级告警。

### ADR-007：Bun 服务器使用请求计数器替代用户态连接池

**决策**：Bun 服务器类（`BunHttpServer` 等）不创建 `ConnectionPoolManager` 实例，改用 `activeRequests` 计数器追踪活跃请求。  
**理由**：Bun 内部管理 HTTP 连接（使用 Zig 实现的高性能连接池），用户态连接池是冗余且可能冲突的。`BaseServer` 的连接池为 `protected` 且 `optional`（`?`），允许子类不初始化。  
**影响**：`getConnectionStats()` 返回基于请求计数的简化统计；Prometheus 指标中无连接级别详情，但有请求级别指标。

### ADR-008：BunWsAdapter 继承 EventEmitter

**决策**：`BunWsAdapter` 继承 Node.js `EventEmitter`，桥接 Bun 回调式 WebSocket 与 koatty_router 的事件式接口。  
**理由**：`koatty_router` 的 WS 路由处理代码使用 `ws.on('message', handler)` 模式（基于 `ws` 库接口），Bun 的 `ServerWebSocket` 使用回调函数而非 EventEmitter。`BunWsAdapter` 在中间做适配，使上层路由代码无需修改。  
**权衡**：引入了一层间接调用开销，但 WebSocket 消息处理本身不是性能瓶颈。

---

*本文档随实施进展持续更新。上次修订：2026-05-10 v2（基于代码库结构和兼容性评估完善）*
