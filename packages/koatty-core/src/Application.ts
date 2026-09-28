/**
 * @ author: richen
 * @ copyright: Copyright (c) - <richenlin(at)gmail.com>
 * @ license: BSD (3-Clause)
 * @ version: 2020-07-06 11:21:37
 */
import { AsyncLocalStorage } from "async_hooks";
import { IncomingMessage, ServerResponse } from "http";
import Koa from "koa";
import koaCompose from "koa-compose";
import { Helper } from "koatty_lib";
import { DefaultLogger as Logger } from "koatty_logger";
import { IContainer, IOC } from "koatty_container";
import onFinished from "on-finished";
import { createKoattyContext } from "./Context";
import {
  InitOptions,
  KoattyApplication,
  KoattyRouter, KoattyServer,
} from "./IApplication";
import { KoattyContext, RequestType, ResponseType } from "./IContext";
import { KoattyMetadata } from "./Metadata";
import { profileSummary, resolveProfile, SecurityConfigOptions, SecurityProfile } from "./security/profile";
import { asyncEvent, isPrevent, isPrototypePollution, parseExp } from "./Utils";

/**
 * Koatty Application 
 * @export
 * @class Koatty
 * @extends {Koa}
 * @implements {BaseApp}
 */
export class Koatty extends Koa implements KoattyApplication {
  // runtime env mode
  env: string = "production";
  // app name
  name: string;
  // app version
  version: string;
  // app options
  options: InitOptions;
  /**
   * Server instance
   * - Single protocol: KoattyServer instance
   * - Multi-protocol: KoattyServer[]
   */
  server: KoattyServer | KoattyServer[];

  /**
   * Router instance
   * - Single protocol: KoattyRouter instance
   * - Multi-protocol: Record<string, KoattyRouter> (router dictionary with protocol as key)
   */
  router: KoattyRouter | Record<string, KoattyRouter>;
  // env var
  appPath: string;
  rootPath: string;
  // koatty framework path
  koattyPath: string;
  logsPath: string;
  appDebug: boolean;

  /**
   * The IOC container this application resolves beans from (ARCH-01 / D-1).
   *
   * Defaults to the process-wide `IOC` so existing code keeps working. Assign
   * an isolated container (`new Container()`) before bootstrap to run
   * a fully independent application inside the same process.
   */
  container: IContainer;
  
  /**
   * Silent mode flag - when true, suppresses startup logs and console output
   * Used primarily in test environments to reduce noise
   */
  silent: boolean;

  declare context: KoattyContext;
  private handledResponse: boolean = false;
  private _errorCaptured = false;
  private stopPromise?: Promise<void>;
  private stopEventsPromise?: Promise<void>;

  /**
   * Process-level error listeners registered by `captureError()`.
   * Retained so `stop()` can unregister them (ARCH-01 / D-1 step 6) — without
   * this, every captured application would leak handlers onto the process and
   * keep logging after shutdown.
   */
  private _processErrorListeners: Array<{ event: string; handler: (...args: any[]) => void }> = [];
  private metadata: KoattyMetadata;
  ctxStorage: AsyncLocalStorage<unknown>;

  /**
   * Protocol-specific middleware stacks
   * Key: protocol name ('http', 'grpc', 'ws', etc.)
   * Value: middleware function array for that protocol
   */
  private middlewareStacks: Map<string, Function[]> = new Map();

  /**
   * Flag to track if a protocol stack has been initialized
   */
  private initializedProtocols: Set<string> = new Set();

  /**
   * Cache for composed callback handlers per protocol.
   * Key: protocol name ('http', 'grpc', 'ws', etc.)
   * Value: composed request handler function
   *
   * Invalidated when middleware stack changes via use().
   * Note: Handlers with reqHandler parameter bypass the cache and create
   * a fresh composition on each call to prevent middleware stack pollution.
   */
  private composedCallbackCache: Map<string,
    (req: RequestType, res: ResponseType) => Promise<any>
  > = new Map();

  /**
   * Application ready state flag.
   * Set to true after bootstrap completes (all components loaded).
   */
  private _ready: boolean = false;

  /**
   * Effective security profile (ADR-102). Resolved lazily on first access so
   * that `config/security.ts` overrides (loaded during bootstrap) are taken
   * into account. Frozen after resolution; never mutate it at runtime.
   */
  private _security?: SecurityProfile;

  /**
   * Protected constructor for the Application class.
   * Initializes a new instance with configuration options and sets up the application environment.
   * 
   * @remarks
   * - Sets up environment based on debug mode and environment variables
   * - Initializes metadata and context storage
   * - Calls init() and error capture methods
   */
  protected constructor(options: InitOptions = {
    appDebug: false,
    appPath: '',
    rootPath: '',
    koattyPath: '',
    name: 'KoattyApplication project',
    version: "0.0.1",
  }) {
    super();
    this.options = options ?? {};
    this.name = options.name;
    this.version = options.version;
    const { appDebug, appPath, rootPath, koattyPath } = this.options;
    const envArg = (process.execArgv ?? []).join(",");
    this.appDebug = appDebug || (envArg.includes('ts-node') || envArg.includes('--debug'));
    this.silent = false; // Initialize silent mode to false by default
    if (this.appDebug) {
      this.env = "development";
    } else {
      const env = process.env.KOATTY_ENV || process.env.NODE_ENV || "";
      if (env.includes("dev")) this.env = 'development';
      if (env.includes("pro")) this.env = 'production';
    }

    this.appPath = appPath;
    this.rootPath = rootPath;
    this.koattyPath = koattyPath;

    // D-1 step 4: each application exposes the container it resolves through.
    // Defaults to the global IOC (backward compatible); callers may swap in an
    // isolated container before bootstrap.
    this.container = IOC;

    this.metadata = new KoattyMetadata();
    this.ctxStorage = new AsyncLocalStorage();

    // constructor
    this.init();
    // catch error
    this.captureError();
  }

  /**
   * Initialize application.
   * This method can be overridden in subclasses to perform initialization tasks.
   */
  init(): void { }

  /**
   * Set metadata value by key.
   * @param key The key of metadata. If key starts with "_", it will be defined as private property.
   * @param value The value to be set.
   * @throws {Error} When prototype pollution attempt is detected
   */
  setMetaData(key: string, value: any) {
    // Security check: prevent prototype pollution
    if (isPrototypePollution(key)) {
      throw new Error(`Prototype pollution attempt detected: ${key}`);
    }
    
    // private
    if (key.startsWith("_")) {
      Helper.define(this, key, value);
      return;
    }
    this.metadata.set(key, value);
  }

  /**
   * Get metadata by key from application instance
   * @param key The metadata key to retrieve
   * @returns An array containing the metadata value(s). Returns empty array if not found
   */
  getMetaData(key: string): any[] {
    // private
    if (key.startsWith("_")) {
      const data = Reflect.get(this, key);
      if (Helper.isTrueEmpty(data)) {
        return [];
      }
      return [data];
    }
    return this.metadata.get(key);
  }

  /**
   * Add middleware to the application.
   * @param {Function} fn The middleware function to be added
   * @returns {any} Returns the result of adding the middleware
   * @throws {Error} When the parameter is not a function
   */
  use(fn: Function): any {
    if (!Helper.isFunction(fn)) {
      Logger.Error('The parameter is not a function.');
      return;
    }
    // COR-12: per-protocol stacks are copies of the global stack taken the first
    // time callback(protocol) ran; they must be dropped or the new middleware
    // would silently never run. Composed handlers are rebuilt from them.
    this.middlewareStacks.clear();
    // Middleware stack changed, invalidate all composed callback caches
    this.composedCallbackCache.clear();
    if (this._ready) {
      Logger.Warn(
        'app.use() was called after appReady: the middleware now applies to ' +
        'subsequent requests only. Register middleware before listen() to avoid this.'
      );
    }
    return super.use(<any>fn);
  }

  /**
   * Use express-style middleware function.
   * Convert express-style middleware to koa-style middleware.
   * 
   * @param {Function} fn Express-style middleware function
   * @returns {any} Returns the result of middleware execution
   * @throws {Error} When parameter is not a function
   */
  useExp(fn: Function): any {
    if (!Helper.isFunction(fn)) {
      Logger.Error('The parameter is not a function.');
      return;
    }
    return this.use(parseExp(fn));
  }

   /**
    * Get or set configuration value by name and type.
    * @param {string} name Configuration key name, support dot notation (e.g. 'app.port')
    * @param {string} [type='config'] Configuration type, defaults to 'config'
    * @param {any} [value] Configuration value to set. If provided, sets the config value
    * @returns {any} Configuration value or null if error occurs
    *
    * @example
    * // Get single level config
    * app.config('port');
    *
    * // Get nested config
    * app.config('database.host');
    *
    * // Get all configs of specific type
    * app.config(undefined, 'middleware');
    *
    * // Set single level config
    * app.config('port', 'config', 3000);
    *
    * // Set nested config
    * app.config('database.host', 'config', 'localhost');
    *
    * // Set entire config type
    * app.config(undefined, 'middleware', { list: ['trace'] });
    */
  config<T = unknown>(name?: string, type = 'config', value?: T): T | null {
    try {
      // Security check: prevent prototype pollution
      if (name && Helper.isString(name) && isPrototypePollution(name)) {
        Logger.Error(`Security: Prototype pollution attempt blocked for key "${name}"`);
        return null;
      }

      // `_configs` is stored as a private instance property: setMetaData routes
      // "_"-prefixed keys through Helper.define (a non-configurable, getter-only
      // property) and getMetaData returns [value] for them. When no value was
      // ever seeded (e.g. a standalone KoattyApplication without the framework
      // Loader), the fallback object used to be temporary, so every write was
      // silently lost. Create the store once and persist it on the instance
      // instead, so that subsequent reads and writes hit the same object.
      let caches = this.getMetaData('_configs')[0];
      if (!caches) {
        if (!Reflect.has(this, '_configs')) {
          caches = {};
          this.setMetaData('_configs', caches);
        } else {
          // Property exists but currently holds an empty value (null/undefined,
          // e.g. cleared externally): reuse it instead of redefining the
          // non-configurable property; invalid stores fall into the error
          // handling below.
          caches = Reflect.get(this, '_configs');
        }
      }
      caches[type] = caches[type] || {};

      // If value is provided, set configuration
      if (value !== undefined) {
        return this.setConfig(caches[type], name, value);
      }

      // Get configuration
      return this.getConfig(caches[type], name);
    } catch (err) {
      Logger.Error(`Config error [name: ${name}, type: ${type}]:`, err);
      return null;
    }
  }

  /**
   * Parse config path and filter empty segments
   * Handles edge cases like '.', '..', 'a..b', leading/trailing dots
   * @private
   */
  private parseConfigPath(name: string): string[] {
    return name.split('.')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  /**
   * Set configuration value with arbitrary depth support
   * @private
   */
  private setConfig<T>(caches: any, name: string | undefined, value: T): T | null {
    // Set entire config type
    if (name === undefined) {
      Object.keys(caches).forEach(k => delete caches[k]);
      Object.assign(caches, value);
      return value;
    }

    if (!Helper.isString(name)) {
      // Non-string name (edge case)
      Logger.Warn(`Config key should be string, got ${typeof name}`);
      caches[name] = value;
      return value;
    }

    const keys = this.parseConfigPath(name);
    
    if (keys.length === 0) {
      Logger.Error('Config key cannot be empty');
      return null;
    }

    // Traverse the path, creating nested objects as needed
    let current = caches;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      const existingValue = current[key];
      
      // Type conflict detection
      if (existingValue !== undefined && 
          (typeof existingValue !== 'object' || existingValue === null || Array.isArray(existingValue))) {
        Logger.Error(
          `Config type conflict: "${key}" is ${typeof existingValue}, ` +
          `cannot set nested property "${name}". Please use different key or remove existing value first.`
        );
        return null;
      }
      
      current[key] = current[key] || {};
      current = current[key];
    }
    
    // Set the final value
    current[keys[keys.length - 1]] = value;
    return value;
  }

  /**
   * Get configuration value with arbitrary depth support
   * @private
   */
  private getConfig<T>(caches: any, name: string | undefined): T | null {
    // Get entire config type
    if (!name) {
      return caches as T;
    }

    if (!Helper.isString(name)) {
      return caches[name] as T;
    }

    const keys = this.parseConfigPath(name);
    
    if (keys.length === 0) {
      return null;
    }

    // Traverse the path recursively
    let result: any = caches;
    for (const key of keys) {
      if (result == null || typeof result !== 'object') {
        return null;
      }
      result = result[key];
    }
    
    return (result ?? null) as T;
  }

  /**
   * Create a Koatty context object.
   * 
   * Creates a context for the incoming request using a protocol-specific factory.
   * This ensures that middleware can define protocol-specific properties (like requestParam)
   * without conflicts between different protocols.
   * 
   * Implementation strategy:
   * 1. Calls Koa's super.createContext() to create base context from app.context prototype
   * 2. Passes the context to createKoattyContext() with protocol information
   * 3. Uses ContextFactory pattern to add protocol-specific properties to the instance
   * 
   * Protocol isolation approach:
   * - All contexts share the same app.context prototype (Koa standard behavior)
   * - Protocol-specific properties (rpc, websocket, graphql, etc.) are defined on the 
   *   context INSTANCE using Helper.define(), not on the prototype
   * - Each request creates a fresh context instance via Object.create(koaContext)
   * - This provides instance-level isolation without prototype manipulation
   * 
   * Thread safety:
   * - Context creation is synchronous and occurs within the Node.js event loop
   * - Each request gets its own context instance
   * - AsyncLocalStorage is used to maintain context across async operations
   * 
   * @param {RequestType} req Request object (HTTP IncomingMessage, gRPC call, WS request, etc.)
   * @param {ResponseType} res Response object (HTTP ServerResponse, gRPC callback, WS socket, etc.)
   * @param {string} [protocol='http'] Protocol type: 'http' | 'https' | 'ws' | 'wss' | 'grpc' | 'graphql'
   * @returns {KoattyContext} Koatty context object with protocol-specific properties
   * @public
   */
  createContext(req: RequestType, res: ResponseType, protocol = "http"): KoattyContext {
    const resp = ['ws', 'wss', 'grpc'].includes(protocol) ?
      new ServerResponse(<IncomingMessage>req) : res;
    // create context
    const context = super.createContext(req as IncomingMessage, resp as ServerResponse);
    Helper.define(context, "app", this);
    return createKoattyContext(context, protocol, req, res);
  }

  /**
   * Listening and start server
   * 
   * Since Koa.listen returns an http.Server type, the return value must be defined
   *  as 'any' type here. When calling, note that Koatty.listen returns a NativeServer,
   *  such as http/https Server or grpcServer or Websocket
   * @param {Function} [listenCallback] Optional callback function to be executed after server starts
   * @returns {NativeServer} The native server instance
   */
  listen(listenCallback?: any): any {
    // COR-03: no `bindProcessEvent(this, 'appStop')` here anymore.
    // It used to move every appStop listener onto process 'beforeExit', which
    // never fires when the process is terminated by a signal, so resource
    // cleanup (db/redis/trace/log flush) was skipped on SIGTERM. The ordered
    // shutdown is now coordinated by TerminusManager (drain -> stop -> appStop).
    
    const servers = Array.isArray(this.server) ? this.server : [this.server];
    let remaining = servers.length;
    const started = () => {
      if (--remaining !== 0) return;
      // appReady means initialized; appStart means all listeners are bound.
      void asyncEvent(this, 'appStart').catch(error => this.emit('error', error));
      listenCallback?.(this);
    };
    const result = servers.map(server => {
      let notified = false;
      return server.Start(() => { if (!notified) { notified = true; started(); } });
    });
    return Array.isArray(this.server) ? result : result[0];
  }

  /**
   * Whether the application has completed initialization
   * and is ready to handle requests.
   */
  get isReady(): boolean {
    return this._ready;
  }

  /**
   * Effective security profile (ADR-102).
   *
   * Selection rules:
   * - `config/security.ts` `profile` field wins over environment;
   * - otherwise NODE_ENV=production -> 'strict', development|test -> 'development',
   *   unset -> 'standard' (never 'development' by accident);
   * - `legacyDefaults: true` rolls all 4.3.0 tightened defaults back and prints
   *   a WARN listing every reverted item (removed in 5.0.0).
   *
   * The profile is resolved once, frozen, and summarized in the startup log.
   */
  get security(): SecurityProfile {
    if (this._security) return this._security;
    const secConfig = (this.config('security') || undefined) as SecurityConfigOptions | undefined;
    const profile = resolveProfile(secConfig);
    this._security = profile;
    if (!this.silent) Logger.Log('Koatty', '[Security]', profileSummary(profile));
    return profile;
  }

  /**
   * Mark the application as ready.
   * Called after bootstrap completes (all components loaded).
   */
  markReady(): void {
    this._ready = true;
    Logger.Log('Koatty', '', 'Application is ready');
  }

  /**
   * Get a standard Node.js HTTP request handler for serverless/custom deployment.
   *
   * Returns a `(req, res) => Promise<void>` function that can be used with:
   * - Serverless platforms (AWS Lambda, Alibaba Cloud FC, etc.)
   * - Custom HTTP servers (`http.createServer(handler)`)
   * - Testing frameworks (`supertest`)
   *
   * @param {string} [protocol='http'] Protocol type
   * @returns {Function} Standard Node.js request handler
   * @throws {Error} If application has not completed bootstrap
   *
   * @example
   * ```typescript
   * // Serverless deployment
   * const app = await createApplication(MyApp);
   * const handler = app.getRequestHandler();
   * export { handler };
   *
   * // Custom server
   * const app = await createApplication(MyApp);
   * http.createServer(app.getRequestHandler()).listen(3000);
   * ```
   */
  getRequestHandler(protocol = "http") {
    if (!this._ready) {
      throw new Error(
        'Application is not ready. Ensure bootstrap is complete before calling getRequestHandler(). ' +
        'Use createApplication() or ExecBootStrap() first.'
      );
    }
    return this.callback(protocol);
  }

  /**
   * Get middleware stack for specific protocol
   * @param protocol Protocol name
   * @returns Middleware array or undefined
   */
  getProtocolMiddleware(protocol: string): Function[] | undefined {
    return this.middlewareStacks.get(protocol);
  }

  /**
   * Get middleware stack statistics
   * @returns Statistics object
   */
  getMiddlewareStats(): { 
    global: number; 
    protocols: Record<string, number> 
  } {
    const stats: any = {
      global: this.middleware.length,
      protocols: {}
    };
    
    for (const [protocol, stack] of this.middlewareStacks) {
      stats.protocols[protocol] = stack.length;
    }
    
    return stats;
  }

  /**
   * Stop all servers gracefully.
   * - For single protocol: stops the single server
   * - For multi-protocol: stops all servers sequentially
   * 
   * @param {Function} [callback] Optional callback function to be executed after all servers stop
   * @returns {void}
   */
  async stop(callback?: () => void): Promise<void> {
    if (!this.stopPromise) this.stopPromise = this.stopServers();
    await this.stopPromise;
    callback?.();
  }

  private async stopServers(): Promise<void> {
    const servers: any[] = Array.isArray(this.server) ? this.server : [this.server];
    const results = await Promise.allSettled(servers.map((srv: any) => new Promise<void>((resolve, reject) => {
      srv?.beginDrain?.();
      if (!srv || typeof srv.Stop !== 'function') return resolve();
      srv.Stop((error?: Error) => error ? reject(error) : resolve());
    })));
    await this.stopResources();
    const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    if (failed) throw failed.reason;
  }

  /** Shared by manual stop and the signal coordinator; once listeners retain their semantics. */
  stopResources(): Promise<void> {
    if (!this.stopEventsPromise) {
      this.stopEventsPromise = Promise.resolve().then(async () => {
        this.releaseErrorListeners();
        const errors: unknown[] = [];
        for (const listener of this.rawListeners('appStop')) {
          try { await listener.call(this, this); } catch (error) { errors.push(error); }
        }
        try { await this.container?.clear(); } catch (error) { errors.push(error); }
        if (errors.length) throw errors[0];
      });
    }
    return this.stopEventsPromise;
  }

  /**
   * Create a callback function for handling requests.
   * 
   * @param protocol - The protocol type, defaults to "http"
   * @param reqHandler - Optional request handler function for processing requests
   * @returns A function that handles incoming requests with the configured middleware stack
   * ```
   */
  callback(protocol = "http", reqHandler?: (ctx: KoattyContext) => Promise<any>) {
    // Fast path: return cached handler when no reqHandler and cache exists
    if (!reqHandler) {
      const cached = this.composedCallbackCache.get(protocol);
      if (cached) return cached;
    }

    // Get or create protocol-specific middleware stack
    let protocolMiddleware = this.middlewareStacks.get(protocol);
    
    if (!protocolMiddleware) {
      // First time for this protocol: copy global middleware
      protocolMiddleware = [...this.middleware];
      this.middlewareStacks.set(protocol, protocolMiddleware);
      this.initializedProtocols.add(protocol);
    }
    
    // Create temporary middleware stack (don't mutate persistent array)
    const middlewareToCompose = reqHandler
      ? [...protocolMiddleware, reqHandler]
      : [...protocolMiddleware];
    
    // Compose middleware for this protocol only
    const fn = koaCompose(middlewareToCompose as any);
    if (!this.listenerCount('error')) this.on('error', this.onerror);

    const handler = (req: RequestType, res: ResponseType) => {
      const ctx: any = this.createContext(req, res, protocol);
      if (!this.ctxStorage) {
        return this.handleRequest(ctx, fn as any);
      }
      return this.ctxStorage.run(ctx, async () => {
        try { return await this.handleRequest(ctx, fn as any); }
        finally { await (this.container as any)?.releaseRequestScope?.(ctx); }
      });
    };

    // Cache handler when no reqHandler (dynamic registration should not be cached)
    if (!reqHandler) {
      this.composedCallbackCache.set(protocol, handler);
    }

    return handler;
  }

  /**
   * Get the KoattyContext of the currently executing request (ARCH-02 / D-2).
   *
   * Reads from the AsyncLocalStorage store populated by `callback()`, so it is
   * safe to call from anywhere inside a request's async call tree — including
   * from container scope resolution. Returns `undefined` outside a request.
   */
  public getCurrentContext(): KoattyContext | undefined {
    return this.ctxStorage?.getStore() as KoattyContext | undefined;
  }

  /**
   * Handle request with middleware.
   *
   * @param ctx KoattyContext instance
   * @param fnMiddleware Composed middleware function
   * @returns Promise<any>
   * @private
   */
  private async handleRequest(
    ctx: KoattyContext,
    fnMiddleware: (ctx: KoattyContext) => Promise<any>,
  ): Promise<any> {
    const res = ctx.res;
    res.statusCode = 404;
    const onerror = (err: Error) => ctx.onerror(err);
    onFinished(res, onerror);
    return fnMiddleware(ctx).catch(onerror);
  }


  /**
   * Capture and handle various error events.
   * - Handles Koa application errors
   * - Handles process warnings
   * - Handles unhandled promise rejections
   * - Handles uncaught exceptions
   * 
   * If the error is not prevented (via isPrevent), it will be logged.
   * For EADDRINUSE errors, the process will exit with code -1.
   * 
   * @private
   */
  private captureError(): void {
    if (this._errorCaptured) return;
    this._errorCaptured = true;
    
    // koa error
    this.removeAllListeners('error');
    this.on('error', (err: Error) => {
      if (!isPrevent(err)) Logger.Error(err);
    });
    // warning
    const onWarning = Logger.Warn as (...args: any[]) => void;
    process.on('warning', onWarning);
    // promise reject error
    const onUnhandledRejection = (reason: Error) => {
      if (!isPrevent(reason)) Logger.Error(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    // uncaught exception
    const onUncaughtException = (err: Error) => {
      if (err.message.includes('EADDRINUSE')) {
        Logger.Fatal(Helper.toString(err));
        process.exit(-1);
      }
      if (!isPrevent(err)) Logger.Error(err);
    };
    process.on('uncaughtException', onUncaughtException);

    // Retain references so stop() can detach them (D-1 step 6).
    this._processErrorListeners = [
      { event: 'warning', handler: onWarning },
      { event: 'unhandledRejection', handler: onUnhandledRejection },
      { event: 'uncaughtException', handler: onUncaughtException },
    ];
  }

  /**
   * Detach the process-level error listeners registered by `captureError()`.
   * Called from `stop()` so a captured application does not keep observing
   * process events after shutdown (ARCH-01 / D-1 step 6).
   *
   * @private
   */
  private releaseErrorListeners(): void {
    if (this._processErrorListeners.length === 0) return;
    for (const { event, handler } of this._processErrorListeners) {
      process.removeListener(event, handler as (...args: any[]) => void);
    }
    this._processErrorListeners = [];
    this._errorCaptured = false;
  }
}

// const properties = ["constructor", "init"];
// export const Koatty = new Proxy(Application, {
//     set(target, key, value, receiver) {
//         if (Reflect.get(target, key, receiver) === undefined) {
//             return Reflect.set(target, key, value, receiver);
//         } else if (key === "init") {
//             return Reflect.set(target, key, value, receiver);
//         } else {
//             throw Error("Cannot redefine getter-only property");
//         }
//     },
//     deleteProperty(target, key) {
//         throw Error("Cannot delete getter-only property");
//     },
//     construct(target, args, newTarget) {
//         Reflect.ownKeys(target.prototype).map((n) => {
//             if (newTarget.prototype.hasOwnProperty(n) && !properties.includes(Helper.toString(n))) {
//                 throw Error(`Cannot override the final method '${Helper.toString(n)}'`);
//             }
//         });
//         return Reflect.construct(target, args, newTarget);
//     }
// });
