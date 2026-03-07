# koatty-router Build Steps

> Companion to: [OPTIMIZATION_PLAN.md](./OPTIMIZATION_PLAN.md)  
> Total Tasks: 24  
> Estimated Effort: Each task is designed for one focused session  
> Test Command: `cd packages/koatty-router && pnpm test`  
> Build Command: `cd packages/koatty-router && pnpm run build`

---

## Instructions for Executing LLM

1. Execute **one task at a time**, in order
2. After each task, run `pnpm test` in `packages/koatty-router` to verify
3. If a task has a `[DECISION]` tag, present the options to the user before proceeding
4. Each task lists exact files to modify, what to change, and how to verify
5. Do NOT skip tasks. If a task becomes unnecessary due to a prior decision, mark it as skipped

---

## Phase 1: Critical Fixes (Tasks 1-5)

### Task 1: Remove Placeholder GrpcConnectionPool Class

**Issue:** C-1  
**File:** `src/router/grpc.ts`  
**What to do:**
1. Delete the `GrpcConnectionPool` class (approximately lines 73-182)
2. In the `GrpcRouter` class, remove the `private connectionPool: GrpcConnectionPool` field
3. In the `GrpcRouter` constructor, remove `this.connectionPool = new GrpcConnectionPool(this.options.poolSize)`
4. In `GrpcRouter.cleanup()`, remove `this.connectionPool.clear()`
5. Remove `poolSize` from the `GrpcRouterOptions` interface if no other code references it

**Do NOT change:**
- `StreamManager` class (it is used by the stream handlers)
- `GrpcBatchProcessor` (that is Task 2)
- Any imports or exports not related to the connection pool

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** TypeScript compiles cleanly. All existing tests pass.

---

### Task 2: Remove Placeholder GrpcBatchProcessor Class

**Issue:** C-1  
**File:** `src/router/grpc.ts`  
**What to do:**
1. Delete the `GrpcBatchProcessor` class (approximately lines 187-310, after Task 1 line numbers may shift)
2. In the `GrpcRouter` class, remove the `private batchProcessor: GrpcBatchProcessor` field
3. In the `GrpcRouter` constructor, remove `this.batchProcessor = new GrpcBatchProcessor(this.options.batchSize)`
4. In `GrpcRouter.cleanup()`, remove `this.batchProcessor.flush()`
5. Remove `batchSize` from the `GrpcRouterOptions` interface if no other code references it
6. Remove `poolSize` and `batchSize` from `GrpcRouterOptions` if they were left from Task 1

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** TypeScript compiles cleanly. All existing tests pass. `GrpcRouter` class is simpler.

---

### Task 3: Fix gRPC Stream State Update Pattern

**Issue:** C-2  
**File:** `src/router/grpc.ts`  
**What to do:**
1. Add a `getStreamState(id: string): StreamState | undefined` public method to `StreamManager`:
   ```typescript
   getStreamState(id: string): StreamState | undefined {
     return this.streams.get(id);
   }
   ```
2. In `handleClientStreaming`, replace the `call.on('data', ...)` handler's stream state update:
   ```typescript
   // Before:
   this.streamManager.updateStream(streamId, { 
     messageCount: streamState.messageCount + 1,
     bufferSize: streamState.bufferSize + JSON.stringify(data).length
   });
   
   // After:
   const currentState = this.streamManager.getStreamState(streamId);
   if (currentState) {
     currentState.messageCount++;
     currentState.bufferSize += (Buffer.isBuffer(data) ? data.length : Buffer.byteLength(JSON.stringify(data)));
   }
   ```
3. Apply the same pattern in `handleBidirectionalStreaming`'s `call.on('data', ...)` handler
4. Remove the `updateStream` method from `StreamManager` if it is no longer used anywhere

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** Stream state is updated via direct mutation on the Map entry. No functional change but code is now explicit about its data flow.

---

### Task 4: Fix RouterFactory Singleton Re-initialization After Shutdown

**Issue:** C-3  
**File:** `src/router/factory.ts`  
**What to do:**
1. In the `create()` method, add a reset of `hasShutdown` flag at the beginning:
   ```typescript
   public create(protocol: string, app: KoattyApplication, options: RouterOptions): KoattyRouter {
     // Allow re-initialization after shutdown (for hot restart scenarios)
     if (this.hasShutdown) {
       Logger.Debug('RouterFactory: Resetting shutdown state for new router creation');
       this.hasShutdown = false;
     }
     
     const normalizedProtocol = protocol.toLowerCase();
     // ...rest of existing code
   }
   ```

2. Add a unit test in `test/router-factory-simple.test.ts` (or create a new test file):
   ```typescript
   it('should allow creating routers after shutdownAll', async () => {
     const factory = RouterFactory.getInstance();
     // Create a router
     // Call shutdownAll
     await factory.shutdownAll();
     // Create another router - should NOT throw
     // Verify the new router works
   });
   ```

**Verify:**
```bash
cd packages/koatty-router
pnpm test
```

**Expected result:** New test passes. RouterFactory can create routers after `shutdownAll()`.

---

### Task 5: Consolidate Duplicate StreamConfig Type Definitions

**Issue:** Q-3  
**Files:** `src/router/types.ts`, `src/router/grpc.ts`  
**What to do:**
1. The `StreamConfig` interface is defined in BOTH files with slightly different fields:
   - `types.ts`: `maxConcurrentStreams`, `streamTimeout`, `backpressureThreshold`, `streamBufferSize`, `enableCompression`
   - `grpc.ts`: `maxConcurrentStreams`, `streamTimeout`, `backpressureThreshold`, `bufferSize`
2. Remove the `StreamConfig` interface from `grpc.ts`
3. In `grpc.ts`, import `StreamConfig` from `./types`
4. If `grpc.ts` uses field names different from `types.ts` (e.g., `bufferSize` vs `streamBufferSize`), update the usage in `grpc.ts` to match the `types.ts` definition. Specifically:
   - `StreamManager` constructor uses `config.bufferSize` -> change to `config.streamBufferSize`
5. Ensure `GrpcExtConfig` in `types.ts` uses the `StreamConfig` from `types.ts` (it already does via the same-file definition)

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** Single `StreamConfig` definition. No duplicate types.

---

## Phase 2: Security & Major Fixes (Tasks 6-12)

### Task 6: Fix GraphiQL XSS Vulnerability

**Issue:** M-2  
**File:** `src/router/graphql.ts`  
**What to do:**
1. Add a private `escapeJsString` method to `GraphQLRouter`:
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
   ```
2. In `renderGraphiQL`, use the escaped endpoint:
   ```typescript
   private renderGraphiQL(endpoint: string): string {
     const safeEndpoint = this.escapeJsString(endpoint);
     // Use safeEndpoint in the template string where ${endpoint} was before
   }
   ```

3. Add a test in `test/graphql-enhanced.test.ts` (or create a new file `test/graphql-xss.test.ts`):
   ```typescript
   it('should escape special characters in GraphiQL endpoint', () => {
     const router = new GraphQLRouter(mockApp, { ... });
     const html = (router as any).renderGraphiQL("'/><script>alert(1)</script>");
     expect(html).not.toContain("<script>alert(1)</script>");
     expect(html).toContain("\\x3cscript\\x3e");
   });
   ```

**Verify:**
```bash
cd packages/koatty-router
pnpm test
```

**Expected result:** XSS payload is escaped in GraphiQL output.

---

### Task 7: Add Null Check for SetRouter Optional Parameter

**Issue:** M-5  
**Files:** `src/router/http.ts`, `src/router/ws.ts`  
**What to do:**
1. In `src/router/http.ts`, `SetRouter` method:
   ```typescript
   // Before:
   SetRouter(name: string, impl?: RouterImplementation) {
     if (Helper.isEmpty(impl.path)) return;
   
   // After:
   SetRouter(name: string, impl?: RouterImplementation) {
     if (!impl || Helper.isEmpty(impl.path)) return;
   ```

2. In `src/router/ws.ts`, `SetRouter` method - apply the same fix:
   ```typescript
   SetRouter(name: string, impl?: RouterImplementation) {
     if (!impl || Helper.isEmpty(impl.path)) return;
   ```

3. Add a test case that calls `SetRouter` without the second argument:
   ```typescript
   it('should not throw when SetRouter is called without impl', () => {
     expect(() => httpRouter.SetRouter('/test')).not.toThrow();
   });
   ```

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** `SetRouter(name)` without impl no longer throws TypeError.

---

### Task 8: Remove No-Op Cache Cleanup Timer from MiddlewareManager

**Issue:** M-4  
**File:** `src/middleware/manager.ts`  
**What to do:**
1. Remove the following private members:
   - `private cacheCleanupTimer?: NodeJS.Timeout;`
   - `private readonly CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000;`
2. Remove the `startCacheCleanup()` method entirely
3. Remove the `performCacheCleanup()` method entirely
4. Remove the `this.startCacheCleanup()` call from the constructor
5. In the `destroy()` method, remove the `if (this.cacheCleanupTimer)` block
6. Keep `clearCaches()` and `getCacheSize()` methods as they are useful standalone

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** No more setInterval timer created. Cleanup functionality removed without impacting middleware registration/execution.

---

### Task 9: Cache ts-morph Project Instance in Debug Mode

**Issue:** M-3  
**File:** `src/utils/inject.ts`  
**What to do:**
1. Add module-level caches above the `getPublicMethods` function:
   ```typescript
   // Module-level cache for ts-morph Project (debug mode only)
   let cachedProject: Project | null = null;
   const publicMethodsCache = new Map<string, string[]>();
   ```

2. Refactor `getPublicMethods`:
   ```typescript
   export function getPublicMethods(classFilePath: string, className: string): string[] {
     const cacheKey = `${classFilePath}::${className}`;
     
     const cached = publicMethodsCache.get(cacheKey);
     if (cached) {
       return cached;
     }
     
     if (!cachedProject) {
       cachedProject = new Project();
     }
     
     const sourceFile = cachedProject.addSourceFileAtPath(classFilePath);
     const classDeclaration = sourceFile.getClass(className);
     const publicMethods: string[] = [];
   
     if (classDeclaration) {
       for (const method of classDeclaration.getMethods()) {
         const modifiers = method.getModifiers().map(mod => mod.getText());
         if (!modifiers.includes("private") && !modifiers.includes("protected")) {
           publicMethods.push(method.getName());
         }
       }
     }
   
     publicMethodsCache.set(cacheKey, publicMethods);
     return publicMethods;
   }
   ```

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** TypeScript compiles. Tests pass. Debug mode startup is faster with multiple controllers.

---

### Task 10: Add http2/http3 to validateProtocolConfig

**Issue:** m-1  
**File:** `src/router/types.ts`  
**What to do:**
1. In the `validateProtocolConfig` function's switch statement, add cases for `http2` and `http3`:
   ```typescript
   case 'http':
   case 'https':
   case 'http2':
   case 'http3':
     // HTTP configuration is all optional, no strict validation needed
     break;
   ```
   This means moving the existing `case 'http': case 'https':` block to include `http2` and `http3`.

2. Also add `http2` and `http3` to the `ProtocolExtConfigMap` interface:
   ```typescript
   export interface ProtocolExtConfigMap {
     http: HttpExtConfig;
     https: HttpExtConfig;
     http2: HttpExtConfig;
     http3: HttpExtConfig;
     ws: WebSocketExtConfig;
     wss: WebSocketExtConfig;
     grpc: GrpcExtConfig;
     graphql: GraphQLExtConfig;
   }
   ```

3. Add a test case:
   ```typescript
   it('should validate http2 and http3 protocols as valid', () => {
     const result2 = validateProtocolConfig('http2', {});
     expect(result2.valid).toBe(true);
     const result3 = validateProtocolConfig('http3', {});
     expect(result3.valid).toBe(true);
   });
   ```

**Verify:**
```bash
cd packages/koatty-router
pnpm test
```

**Expected result:** `http2` and `http3` are no longer rejected as "unknown protocol".

---

### Task 11: Move GraphQL SetRouter Call Outside Loop

**Issue:** m-2  
**File:** `src/router/graphql.ts`  
**What to do:**
1. In the `LoadRouter` method, the current code calls `this.SetRouter()` inside the inner `for` loop for each router method. Refactor to collect all methods first, then call `SetRouter` once:

   ```typescript
   // Before (inside inner loop):
   for (const router of Object.values(ctlRouters)) {
     // ...
     rootValue[method] = (...) => { ... };
     this.SetRouter(router.ctlPath || "/graphql", {
       schema,
       implementation: rootValue
     });
   }
   
   // After (collect ctlPath, call SetRouter once after ALL controllers):
   let graphqlPath = "/graphql";  // default
   
   for (const n of list) {
     // ...existing controller processing...
     for (const router of Object.values(ctlRouters)) {
       const method = router.method;
       const params = ctlParams[method];
       
       Logger.Debug(`Register request mapping: ${n}.${method}`);
       rootValue[method] = (args: any, ctx: KoattyContext): Promise<any> => {
         const ctl = IOC.getInsByClass(ctlClass, [ctx]);
         return Handler(app, ctx, ctl, method, params, Object.values(args), router.composedMiddleware);
       };
       
       // Use last seen ctlPath (they should all be the same)
       if (router.ctlPath) {
         graphqlPath = router.ctlPath;
       }
     }
   }
   
   // Register once after all methods are collected
   if (Object.keys(rootValue).length > 0) {
     this.SetRouter(graphqlPath, {
       schema,
       implementation: rootValue
     });
   }
   ```

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** `SetRouter` is called once instead of N times. Same functional behavior.

---

### Task 12: Fix createGroup Not Awaiting Async register

**Issue:** m-6  
**File:** `src/middleware/manager.ts`  
**What to do:**
1. Make `createGroup` async and await the `register` call:
   ```typescript
   // Before:
   public createGroup(groupName: string, middlewareNames: string[]): void {
     const groupMiddleware = this.compose(middlewareNames);
     this.register({ ... });
   }
   
   // After:
   public async createGroup(groupName: string, middlewareNames: string[]): Promise<void> {
     const groupMiddleware = this.compose(middlewareNames);
     await this.register({
       name: groupName,
       middleware: groupMiddleware,
       metadata: {
         type: 'group',
         members: middlewareNames
       }
     });
   }
   ```

2. Update the `IRouterMiddlewareManager` interface if `createGroup` is declared there (check first; it may not be).

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** `createGroup` now properly awaits the async `register` method.

---

## Phase 3: WebSocket Rewrite (Tasks 13-15)

### Task 13: [DECISION] Choose WebSocket Handler Strategy

**Issue:** M-1  
**File:** `src/router/ws.ts`

**Present these options to the user:**

**Option A (Recommended): Per-message handler model**
- Each `message` event triggers the controller handler independently
- Promise resolves when the WebSocket connection closes
- Removes broken framing logic entirely
- Simpler, aligns with how WebSocket works
- Impact: Controllers that accumulate data across messages must manage their own state

**Option B: Keep framing, fix the bugs**
- Fix the completion detection logic (`length % chunkSize` issue)
- Fix the single-resolve Promise issue by using an event emitter or callback pattern
- More complex, but preserves the original design intent
- Impact: Minimal behavioral change, but the framing approach is non-standard for WebSocket

**Wait for user decision before proceeding to Task 14.**

---

### Task 14: Rewrite WebSocket Message Handler (Based on Decision)

**Issue:** M-1  
**File:** `src/router/ws.ts`

**If Option A was chosen:**

1. Rewrite the `websocketHandler` method:
   ```typescript
   private websocketHandler(
     app: Koatty, ctx: KoattyContext, ctl: Function, 
     method: string, params?: any, ctlParamsValue?: any, 
     composedMiddleware?: Function
   ): Promise<any> {
     return new Promise((resolve, reject) => {
       const socketId = ctx.socketId || ctx.requestId;
       
       // Check memory limits
       if (!this.enforceMemoryLimits()) {
         reject(new Error('Memory limits exceeded'));
         return;
       }
   
       // Initialize connection tracking
       const connection: ConnectionInfo = {
         socketId,
         buffers: [],     // No longer used for framing, kept for interface
         lastActivity: Date.now(),
         totalBufferSize: 0
       };
       this.connections.set(socketId, connection);
       this.connectionCount++;
   
       // Heartbeat setup (ping/pong)
       let isAlive = true;
       
       const onPong = () => {
         isAlive = true;
         connection.lastActivity = Date.now();
       };
       
       const checkAlive = () => {
         if (!isAlive) {
           Logger.Debug(`Connection timeout: ${socketId}`);
           this.cleanupConnection(socketId);
           ctx.websocket.terminate();
           return;
         }
         isAlive = false;
         try {
           ctx.websocket.ping();
         } catch (error) {
           Logger.Error(`Error sending ping to ${socketId}:`, error);
           this.cleanupConnection(socketId);
           return;
         }
         connection.heartbeatTimeout = setTimeout(checkAlive, this.options.heartbeatInterval);
       };
       
       ctx.websocket.on('pong', onPong);
       connection.heartbeatTimeout = setTimeout(checkAlive, this.options.heartbeatInterval);
   
       // Handle each message independently
       ctx.websocket.on('message', async (data: Buffer | string) => {
         try {
           connection.lastActivity = Date.now();
           isAlive = true;
           
           const message = typeof data === 'string' ? data : data.toString('utf8');
           
           // Check message size
           const messageSize = Buffer.byteLength(message);
           if (messageSize > this.options.maxBufferSize!) {
             Logger.Warn(`Message too large: ${messageSize} bytes from ${socketId}`);
             return;
           }
           
           ctx.message = message;
           await Handler(app, ctx, ctl, method, params, ctlParamsValue, composedMiddleware);
         } catch (error) {
           Logger.Error(`Error processing message for ${socketId}:`, error);
         }
       });
   
       // Connection close
       ctx.websocket.on('close', () => {
         Logger.Debug(`Connection closed: ${socketId}`);
         this.cleanupConnection(socketId);
         resolve(undefined);
       });
   
       // Connection error
       ctx.websocket.on('error', (error: Error) => {
         Logger.Error(`WebSocket error for ${socketId}:`, error);
         this.cleanupConnection(socketId);
         reject(error);
       });
     });
   }
   ```

2. Remove `maxFrameSize` from `WebsocketRouterOptions` if it was only used for the removed framing logic. Keep `maxBufferSize` for message size limits.

3. Clean up `ConnectionInfo` interface - remove `buffers` and `totalBufferSize` fields if no longer needed:
   ```typescript
   interface ConnectionInfo {
     socketId: string;
     lastActivity: number;
     frameTimeout?: NodeJS.Timeout;      // Can remove if not used
     heartbeatTimeout?: NodeJS.Timeout;
   }
   ```

4. Update `cleanupConnection` to match the simplified `ConnectionInfo`.

5. Remove `cleanupOldestConnections` buffer-size logic if `totalBufferSize` tracking is removed. Keep connection count enforcement.

**If Option B was chosen:**

1. Fix completion detection - replace `bufferData.length % chunkSize !== 0` with explicit end-of-stream signaling or use a proper framing protocol
2. Fix single-resolve issue - use callbacks or event emitters instead of Promise wrapping
3. Add proper documentation explaining the framing protocol

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** WebSocket router compiles and tests pass.

---

### Task 15: Add WebSocket Handler Tests

**Issue:** M-1 (testing)  
**File:** Create `test/ws-handler.test.ts` or add to existing WS test file  
**What to do:**
1. Add unit tests for the new WebSocket handler:
   - Test: message event triggers handler execution
   - Test: multiple messages are each handled independently
   - Test: connection close resolves the promise
   - Test: oversized messages are rejected
   - Test: connection limit enforcement
   - Test: heartbeat timeout terminates stale connections

2. Use mock WebSocket objects:
   ```typescript
   const EventEmitter = require('events');
   class MockWebSocket extends EventEmitter {
     ping() {}
     terminate() {}
     send(data: any) {}
   }
   ```

**Verify:**
```bash
cd packages/koatty-router
pnpm test
```

**Expected result:** New tests pass, covering the rewritten WebSocket handler.

---

## Phase 4: gRPC Optimizations (Tasks 16-17)

### Task 16: Optimize Bidirectional Stream Context Creation

**Issue:** M-6  
**File:** `src/router/grpc.ts`  
**What to do:**
1. In `handleBidirectionalStreaming`, move context and controller creation outside the `data` event handler:

   ```typescript
   private handleBidirectionalStreaming(
     call: ServerDuplexStream<any, any>,
     app: Koatty,
     ctlItem: any
   ): void {
     const streamId = `bidi_${Date.now()}_${Math.random()}`;
     this.streamManager.registerStream(streamId, GrpcStreamType.BIDIRECTIONAL_STREAMING);
     
     try {
       // Create context and controller ONCE for the entire stream
       const ctx = app.createContext(call, null, 'grpc');
       const ctl = IOC.getInsByClass(ctlItem.ctl, [ctx]);
       
       // Add stream helpers
       ctx.writeStream = (responseData: any) => {
         call.write(responseData);
         return true;
       };
       ctx.endStream = () => {
         call.end();
         clearTimeout(timeout);
         this.streamManager.removeStream(streamId);
       };
   
       const timeout = setTimeout(() => {
         Logger.Warn(`Bidirectional stream ${streamId} timeout`);
         call.end();
         this.streamManager.removeStream(streamId);
       }, this.options.streamConfig?.streamTimeout || 300000);
   
       call.on('data', async (data: any) => {
         // Update stream state
         const currentState = this.streamManager.getStreamState(streamId);
         if (currentState) {
           currentState.messageCount++;
           currentState.bufferSize += (Buffer.isBuffer(data) ? data.length : Buffer.byteLength(JSON.stringify(data)));
         }
         
         try {
           // Update message on existing context
           ctx.streamMessage = data;
           await Handler(app, ctx, ctl, ctlItem.method, ctlItem.params, undefined, ctlItem.composedMiddleware);
         } catch (error) {
           Logger.Error(`Error processing bidirectional stream message: ${error}`);
         }
       });
   
       call.on('end', () => { /* ... existing cleanup ... */ });
       call.on('error', (error) => { /* ... existing cleanup ... */ });
       call.on('cancelled', () => { /* ... existing cleanup ... */ });
       
     } catch (error) {
       Logger.Error(`Error in bidirectional streaming: ${error}`);
       call.end();
       this.streamManager.removeStream(streamId);
     }
   }
   ```

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** Context and controller are created once per stream, not per message.

---

### Task 17: Replace JSON.stringify with Buffer.byteLength for Size Estimation

**Issue:** P-1  
**File:** `src/router/grpc.ts`  
**What to do:**
1. Add a utility function at the top of the file (or in `utils/path.ts`):
   ```typescript
   function estimateDataSize(data: any): number {
     if (Buffer.isBuffer(data)) return data.length;
     if (typeof data === 'string') return Buffer.byteLength(data);
     if (data === null || data === undefined) return 0;
     // For objects, fall back to JSON.stringify (unavoidable but only for complex objects)
     try {
       return Buffer.byteLength(JSON.stringify(data));
     } catch {
       return 0;
     }
   }
   ```

2. Replace all `JSON.stringify(data).length` calls in gRPC stream handlers with `estimateDataSize(data)`:
   - In `handleClientStreaming`'s `data` event handler
   - In `handleBidirectionalStreaming`'s `data` event handler (if not already fixed in Task 16)

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** Buffer size estimation uses native Buffer methods when possible, avoiding unnecessary string serialization.

---

## Phase 5: Minor Fixes (Tasks 18-22)

### Task 18: Fix injectParam Return Type

**Issue:** m-4  
**File:** `src/utils/inject.ts`  
**What to do:**
1. In the `injectParam` function, the inner function returns `descriptor` (which is `number`). The `ParameterDecorator` type expects no return value. Change:
   ```typescript
   // Before (line ~695):
   return descriptor;
   
   // After:
   // Simply remove the return statement, or return undefined
   ```

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** No behavioral change. Cleaner type semantics.

---

### Task 19: Add throwOnError Option to bodyParser

**Issue:** m-5  
**Files:** `src/payload/interface.ts`, `src/payload/payload.ts`  
**What to do:**
1. In `src/payload/interface.ts`, add `throwOnError` to `PayloadOptions`:
   ```typescript
   export interface PayloadOptions {
     // ...existing fields...
     
     /** When true, re-throw body parsing errors instead of returning empty object. Default: false */
     throwOnError?: boolean;
   }
   ```

2. In `src/payload/payload.ts`, update the `bodyParser` catch block:
   ```typescript
   export async function bodyParser(ctx: KoattyContext, options?: PayloadOptions): Promise<any> {
     try {
       let body = ctx.getMetaData("_body")[0];
       if (!Helper.isEmpty(body)) {
         return body;
       }
       const opts = cacheManager.getMergedOptions(options);
       body = await parseBody(ctx, opts);
       ctx.setMetaData("_body", body);
       return body;
     } catch (err) {
       Logger.Error(err);
       if (options?.throwOnError) {
         throw err;
       }
       return {};
     }
   }
   ```

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** Default behavior unchanged. New option enables error propagation.

---

### Task 20: Make getControllerPath Configurable

**Issue:** m-8  
**File:** `src/utils/inject.ts`  
**What to do:**
1. Modify `getControllerPath` to support configurable path patterns:
   ```typescript
   function getControllerPath(className: string): string {
     const appPath = process.env.APP_PATH || '';
     const controllerDir = process.env.CONTROLLER_DIR || 'controller';
     const ext = process.env.CONTROLLER_EXT || '.ts';
     return `${appPath}/${controllerDir}/${className}${ext}`;
   }
   ```

2. This is a backward-compatible change. The default behavior (using `/controller/` and `.ts`) is preserved.

**Verify:**
```bash
cd packages/koatty-router
npx tsc --noEmit
pnpm test
```

**Expected result:** Path construction uses environment variables with safe defaults.

---

### Task 21: Remove Unused Imports and Clean Up Lint Warnings

**Issue:** Q-1  
**Files:** Multiple source files  
**What to do:**
1. Run the linter to identify unused imports:
   ```bash
   cd packages/koatty-router
   pnpm run lint 2>&1 | grep "no-unused"
   ```
2. Remove any unused imports identified
3. Common candidates:
   - Check if `RequestMethod` import is used in `ws.ts` (it is imported but check line 17)
   - Check if `parsePath` is imported but unused in `graphql.ts`
   - Check if all `Helper` utilities are used in each file

**Verify:**
```bash
cd packages/koatty-router
pnpm run lint
pnpm test
```

**Expected result:** Zero lint warnings for unused imports.

---

### Task 22: Standardize Error Messages (Remove Emoji from Logs)

**Issue:** Q-2  
**Files:** `src/router/grpc.ts`, `src/RouterComponent.ts`  
**What to do:**
1. Search for emoji characters in log messages across all source files
2. Replace emoji-prefixed messages with plain text:
   ```typescript
   // Before:
   Logger.Log('Koatty', '', '✓ Router initialized');
   Logger.Error(`[GRPC_ROUTER] ❌ Failed to find...`);
   Logger.Debug(`[GRPC_ROUTER] ✅ Register request mapping...`);
   Logger.Warn(`[GRPC_ROUTER] ⚠️ Placeholder handler called...`);
   
   // After:
   Logger.Log('Koatty', '', 'Router initialized');
   Logger.Error(`[GRPC_ROUTER] Failed to find...`);
   Logger.Debug(`[GRPC_ROUTER] Register request mapping...`);
   Logger.Warn(`[GRPC_ROUTER] Placeholder handler called...`);
   ```
3. Files to check: `RouterComponent.ts`, `grpc.ts`, and any other file with emoji in log strings

**Verify:**
```bash
cd packages/koatty-router
pnpm test
```

**Expected result:** Log messages are clean, parseable strings without emoji.

---

## Phase 6: Final Verification (Tasks 23-24)

### Task 23: Unify Comments Language to English

**Issue:** m-3  
**Files:** All `.ts` files in `src/`  
**What to do:**
1. Go through each source file and translate Chinese comments to English
2. Key files with Chinese comments:
   - `src/router/grpc.ts`: Stream type comments, class descriptions, method comments
   - `src/router/ws.ts`: Connection management comments, configuration descriptions
   - `src/router/types.ts`: Interface field descriptions
   - `src/middleware/manager.ts`: Cache-related comments
   - `src/payload/payload.ts`: Optimization comments
   - `src/payload/payload_cache.ts`: Class/method comments
   - `src/utils/inject.ts`: Some inline comments
3. Preserve the meaning accurately. Do NOT change any code, only comments.
4. Keep JSDoc `@description` tags in English

**Verify:**
```bash
cd packages/koatty-router
# Quick search for remaining Chinese characters
grep -rn '[\u4e00-\u9fff]' src/ || echo "No Chinese characters found"
pnpm test
```

**Expected result:** All comments are in English. No functional changes. All tests pass.

---

### Task 24: Full Build & Test Verification

**Files:** None (verification only)  
**What to do:**
1. Run the complete test suite:
   ```bash
   cd packages/koatty-router
   pnpm test
   ```

2. Run the full build:
   ```bash
   cd packages/koatty-router
   pnpm run build
   ```

3. Verify the build output:
   ```bash
   ls -la dist/
   # Should contain: index.js, index.mjs, index.d.ts
   ```

4. Run type checking across the monorepo to ensure no cross-package breakage:
   ```bash
   cd /path/to/koatty-monorepo
   pnpm run build --filter=koatty_router
   ```

5. If any test fails, investigate and fix before proceeding.

**Expected result:** All tests pass. Build succeeds. No TypeScript errors. Package is ready for version bump.

---

## Task Dependency Graph

```
Phase 1 (Critical):
  Task 1 ──> Task 2 ──> Task 3 ──> Task 4 ──> Task 5

Phase 2 (Security/Major):
  Task 6 (independent)
  Task 7 (independent)
  Task 8 (independent)
  Task 9 (independent)
  Task 10 (independent)
  Task 11 (independent)
  Task 12 (independent)

Phase 3 (WebSocket):
  Task 13 ──> Task 14 ──> Task 15

Phase 4 (gRPC):
  Task 16 ──> Task 17
  (depends on Task 3 for getStreamState)

Phase 5 (Minor):
  Task 18-22 (all independent)

Phase 6 (Final):
  Task 23 ──> Task 24
  (Task 24 depends on ALL previous tasks)
```

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| Phase 1 | 1-5 | Critical: Remove stubs, fix data bugs, fix singleton |
| Phase 2 | 6-12 | Major: XSS fix, null checks, cleanup dead code, caching |
| Phase 3 | 13-15 | WebSocket: Rewrite message handler (requires decision) |
| Phase 4 | 16-17 | gRPC: Context reuse, size estimation |
| Phase 5 | 18-22 | Minor: Types, config, lint, logs |
| Phase 6 | 23-24 | Final: Comment translation, full verification |
