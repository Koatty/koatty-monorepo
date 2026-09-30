/*
 * @Description: Singleton Terminus Manager for multi-server coordination
 * @Usage: Manages graceful shutdown across multiple server instances
 * @Author: richen
 * @Date: 2025-01-14
 * @LastEditTime: 2025-01-14
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import EventEmitter from "events";
import { KoattyApplication, KoattyServer } from "koatty_core";
import { Helper } from "koatty_lib";
import { DefaultLogger as Logger } from "koatty_logger";

// async event listener - triggers all listeners without removing them
const asyncEvent = async (event: EventEmitter, eventName: string) => {
  for (const func of event.rawListeners(eventName)) {
    if (Helper.isFunction(func)) {
      await func.call(event);
    }
  }
  return event.removeAllListeners(eventName);
};

// Trigger all listeners on a target without modifying listener registrations
const triggerListeners = async (target: NodeJS.EventEmitter, eventName: string) => {
  for (const func of target.listeners(eventName)) {
    if (typeof func === 'function') {
      await (func as () => Promise<void>)();
    }
  }
};

/**
 * Singleton Terminus Manager
 * 
 * Ensures that signal handlers (SIGTERM, SIGINT, etc.) are only registered once,
 * even when multiple server instances are created. Coordinates graceful shutdown
 * across all registered servers.
 */
export class TerminusManager {
  private static instance: TerminusManager | null = null;
  private isShuttingDown = false;
  private shutdownPromise?: Promise<void>;
  private app: KoattyApplication | null = null;
  private signalsRegistered = false;
  private exitOnShutdown = true;
  private registeredServerCount = 0;
  /** COR-03: servers to drain/stop, in registration order */
  private servers: Array<{ app: KoattyApplication; server: KoattyServer; serverId: string }> = [];
  /** COR-03: /ready reports 503 for this long before sockets are closed */
  private preStopDelay = 5000;
  /** COR-03: upper bound for in-flight requests to finish */
  private drainTimeout = 19000;
  // Stored handler references for explicit removal on reset (prevents handler accumulation in tests)
  private signalHandlers: Map<NodeJS.Signals, () => void> = new Map();

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): TerminusManager {
    if (!TerminusManager.instance) {
      TerminusManager.instance = new TerminusManager();
    }
    return TerminusManager.instance;
  }

  /** Release an explicitly stopped server; signal shutdown keeps its cleanup snapshot. */
  static unregisterServer(server: KoattyServer): void {
    const manager = this.instance;
    if (!manager || manager.isShuttingDown) return;
    manager.servers = manager.servers.filter(entry => entry.server !== server);
    manager.registeredServerCount = manager.servers.length;
    manager.app = manager.servers.at(-1)?.app ?? null;
    if (!manager.servers.length) {
      for (const [signal, handler] of manager.signalHandlers) process.removeListener(signal, handler);
      manager.signalHandlers.clear();manager.signalsRegistered = false;
    }
  }

  setExitOnShutdown(value: boolean): void {
    this.exitOnShutdown = value;
  }

  /** COR-03: override the preStop delay (ms) — used by config and tests. */
  setPreStopDelay(ms: number): void {
    if (typeof ms === 'number' && ms >= 0) this.preStopDelay = ms;
  }

  /** COR-03: override the drain timeout (ms) — used by config and tests. */
  setDrainTimeout(ms: number): void {
    if (typeof ms === 'number' && ms >= 0) this.drainTimeout = ms;
  }

  getPreStopDelay(): number {
    return this.preStopDelay;
  }

  getDrainTimeout(): number {
    return this.drainTimeout;
  }

  /**
   * Register a server instance
   * 
   * @param app - Koatty application instance
   * @param server - Server instance to register
   * @param serverId - Unique identifier for the server
   */
  registerServer(app: KoattyApplication, server: KoattyServer, serverId: string): void {
    if (this.servers.some(entry => entry.server === server)) return;
    this.app = app;
    this.registeredServerCount++;
    this.servers.push({ app, server, serverId });

    // COR-03: drain budget may come from config/server.ts `shutdown`
    try {
      const serverConf = ((server as any)?.options ?? (app as any)?.config?.(undefined, 'server') ?? (app as any)?.config?.('server')) as
        | { shutdown?: { preStopDelay?: number; drainTimeout?: number } }
        | undefined;
      if (typeof serverConf?.shutdown?.preStopDelay === 'number') {
        this.setPreStopDelay(serverConf.shutdown.preStopDelay);
      }
      if (typeof serverConf?.shutdown?.drainTimeout === 'number') {
        this.setDrainTimeout(serverConf.shutdown.drainTimeout);
      }
    } catch {
      // config not reachable: keep the defaults
    }

    Logger.Info(`Server registered in TerminusManager: ${serverId}`);
    
    // 只在第一次注册时设置信号处理器
    if (!this.signalsRegistered) {
      this.setupSignalHandlers();
      this.signalsRegistered = true;
    }
  }

  /**
   * Setup signal handlers (only once).
   * Handlers are stored in signalHandlers map for explicit removal on resetInstance().
   */
  private setupSignalHandlers(): void {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    
    signals.forEach(signal => {
      const handler = () => {
        this.shutdownAll(signal).catch(err => {
          // Logger.Fatal exits the process; only do that when this manager owns
          // the process lifetime (tests / embedders set exitOnShutdown = false,
          // and jest workers own the process regardless).
          if (this.exitOnShutdown && !process.env.JEST_WORKER_ID) {
            Logger.Fatal('Error during shutdown', err);
            process.exit(1);
            return;
          }
          Logger.Error('Error during shutdown', err);
        });
      };
      this.signalHandlers.set(signal, handler);
      process.on(signal, handler);
    });

    Logger.Info('Global signal handlers registered');
  }

  /**
   * Shutdown all registered servers in the order required for zero-downtime
   * deploys (COR-03 / C-1):
   *
   * ```
   * signal
   *   -> 1. beginDrain(): /ready answers 503 everywhere (out of rotation)
   *   -> 2. preStopDelay: give load balancers time to propagate
   *   -> 3. Stop(): stop accepting connections, drain in-flight requests,
   *          force-close whatever is left after drainTimeout
   *   -> 4. appStop: resource cleanup (db, redis, tracing, log flush)
   *   -> 5. process 'beforeExit' listeners
   * ```
   *
   * @param signal - Signal that triggered the shutdown
   */
  private shutdownAll(signal: string): Promise<void> {
    if (!this.shutdownPromise) this.shutdownPromise = this.performShutdown(signal);
    return this.shutdownPromise;
  }

  private async performShutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      Logger.Warn('Shutdown already in progress, ignoring signal');
      return;
    }
    
    this.isShuttingDown = true;
    Logger.Warn(`Received kill signal (${signal}), shutting down all servers...`);

    // COR-03: the budget covers the whole sequence, not only the drain:
    // preStopDelay + in-flight drain + force close + appStop resource cleanup.
    // It stays below terminationGracePeriodSeconds ("must stay below" comment).
    const forceCloseGraceMs = 5000;
    const shutdownTimeout = Math.min(29000, this.preStopDelay + this.drainTimeout + forceCloseGraceMs);
    let timeoutHandle: NodeJS.Timeout | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Shutdown timeout after ${shutdownTimeout}ms`)),
          shutdownTimeout
        );
        timeoutHandle.unref?.();
      });

      try {
        await Promise.race([this.drainAndStop(), timeoutPromise]);
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }

      if (this.exitOnShutdown) {
        // Logger.Fatal terminates the process (exit 1); it must not run when the
        // embedder (or a test) disabled exit-on-shutdown. Jest workers own the
        // process regardless of this flag: an async shutdown landing after its
        // suite must never terminate the worker mid-run.
        Logger.Info('Graceful shutdown completed');
        if (!process.env.JEST_WORKER_ID) process.exit(0);
      }
      Logger.Info('Graceful shutdown completed');

    } catch (error) {
      if (!this.exitOnShutdown || process.env.JEST_WORKER_ID) {
        Logger.Error('Error during shutdown', error);
        throw error;
      }
      Logger.Fatal('Error during shutdown', error);
      process.exit(1);
    }
  }

  /**
   * COR-03: the ordered drain -> stop -> appStop sequence used by shutdownAll.
   * Exposed indirectly through `shutdown()` so tests can drive it without
   * sending real signals.
   */
  private async drainAndStop(): Promise<void> {
    // 1. /ready -> 503 on every registered server
    for (const { serverId, server } of this.servers) {
      const drainable = server as any;
      if (drainable && typeof drainable.beginDrain === 'function') {
        drainable.beginDrain();
        Logger.Info(`Server draining: ${serverId}`);
      }
    }

    // 2. let load balancers observe the 503 before sockets close
    if (this.preStopDelay > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.preStopDelay);
        timer.unref?.();
      });
    }

    // 3. stop servers: no new connections; in-flight requests drain
    const errors: unknown[] = [];
    const stopped = await Promise.allSettled(this.servers.map(({ server }) => new Promise<void>((resolve, reject) => {
      const stoppable = server as any;
      if (typeof stoppable?.Stop !== 'function') return resolve();
      try { stoppable.Stop((error?: Error) => error ? reject(error) : resolve()); }
      catch (error) { reject(error); }
    })));
    for (const result of stopped) if (result.status === 'rejected') errors.push(result.reason);

    // Every application owns its resources. A failing server/app must not skip others.
    const apps = new Set(this.servers.map(entry => entry.app));
    for (const app of apps) {
      try {
        if (typeof (app as any).stopResources === 'function') await (app as any).stopResources();
        else await asyncEvent(app, 'appStop');
      } catch (error) { errors.push(error); }
    }
    try { await triggerListeners(process, 'beforeExit'); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'One or more server/application shutdowns failed');

  }

  /**
   * Trigger the ordered shutdown without a real signal (used by tests and by
   * embedders that receive the shutdown command out-of-band).
   */
  async shutdown(signal = 'SIGTERM'): Promise<void> {
    return this.shutdownAll(signal);
  }

  /**
   * Reset instance (for testing purposes).
   * Explicitly removes all registered signal handlers to prevent handler accumulation.
   */
  static resetInstance(): void {
    if (TerminusManager.instance) {
      TerminusManager.instance.signalHandlers.forEach((handler, signal) => {
        process.removeListener(signal, handler);
      });
      TerminusManager.instance.signalHandlers.clear();
      TerminusManager.instance.isShuttingDown = false;
      TerminusManager.instance.signalsRegistered = false;
      TerminusManager.instance.registeredServerCount = 0;
      TerminusManager.instance.servers = [];
      TerminusManager.instance = null;
    }
  }

  /**
   * Get number of registered servers (for testing)
   */
  getServerCount(): number {
    return this.registeredServerCount;
  }
}

