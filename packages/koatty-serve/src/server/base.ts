import { KoattyApplication, KoattyServer, NativeServer } from "koatty_core";
import { ListeningOptions } from "../config/config";
import { DrainableHealthMiddleware } from "../middleware/healthCheck";
import { createLogger } from "../utils/logger";
import { generateServerId, deepEqual } from "../utils/helper";
import { TerminusManager } from "../utils/terminus-manager";
import { ConnectionTracker } from "./connection-tracker";

export interface GracefulShutdownOptions {
  timeout?: number;
  drainDelay?: number;
  stepTimeout?: number;
  waitTimeout?: number;
}
export interface ShutdownResult {
  status: "completed" | "failed" | "forced";
  totalTime: number;
  completedSteps: string[];
  failedSteps: Array<{ step: string; error: string; timestamp: number }>;
}
export interface ConfigChangeAnalysis {
  requiresRestart: boolean;
  changedKeys: string[];
  restartReason?: string;
  canApplyRuntime?: boolean;
}
export type ConnectionStats = ReturnType<ConnectionTracker["stats"]>;
export enum HealthStatus {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  OVERLOADED = "overloaded",
  UNAVAILABLE = "unavailable",
}

export function closeIdleConnections(server: unknown): void {
  try {
    (server as { closeIdleConnections?: () => void })?.closeIdleConnections?.();
  } catch {
    /* already closed */
  }
}

/** Shared lifetime only. Protocol subclasses own their transport and request adaptation. */
export abstract class BaseServer<
  T extends ListeningOptions = ListeningOptions,
  S = any,
> implements KoattyServer {
  protected server!: S;
  readonly protocol: string;
  status = 0;
  listenCallback?: () => void;
  protected startTime = 0;
  protected configVersion = 0;
  protected serverId: string;
  protected logger: ReturnType<typeof createLogger>;
  protected healthMiddleware: DrainableHealthMiddleware | null = null;
  protected tracker: ConnectionTracker;
  private shutdownPromise?: Promise<ShutdownResult>;

  constructor(
    protected app: KoattyApplication,
    public options: T,
  ) {
    this.options = {
      ...options,
      ext: options.ext ? { ...options.ext } : undefined,
    };
    this.protocol = options.protocol;
    this.serverId = generateServerId(options.protocol);
    this.logger = createLogger({
      module: options.protocol,
      serverId: this.serverId,
    });
    this.tracker = new ConnectionTracker(
      options.connectionPool?.maxConnections ?? 0,
    );
  }

  abstract Start(callback?: () => void): any;
  protected abstract closeTransport(): Promise<void>;
  protected abstract forceTransport(): void;
  protected cleanup(): void {}
  protected recreate(): void {
    throw new Error("Runtime restart is not supported by this transport");
  }

  getNativeServer(): NativeServer {
    return this.server as NativeServer;
  }
  getStatus(): number {
    return this.status;
  }
  getConnectionStats(): ConnectionStats {
    return this.tracker.stats();
  }
  getConnectionPoolHealth() {
    return this.tracker.health();
  }
  /** @deprecated Latency and request metrics are supplied by koatty_trace. */
  getConnectionPoolMetrics() {
    return { ...this.tracker.stats(), health: this.tracker.health() };
  }
  getConfigVersion(): number {
    return this.configVersion;
  }
  protected getActiveConnectionCount(): number {
    return this.tracker.size;
  }
  protected markStarted(): void {
    TerminusManager.getInstance().registerServer(this.app, this, this.serverId);
    this.startTime = Date.now();
    this.status = 200;
    this.healthMiddleware?.setDraining(false);
  }
  beginDrain(): void {
    this.status = 503;
    this.healthMiddleware?.setDraining(true);
  }
  isDraining(): boolean {
    return this.status === 503;
  }

  gracefulShutdown(
    options: GracefulShutdownOptions = {},
  ): Promise<ShutdownResult> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.beginDrain();
    this.shutdownPromise = this.performShutdown(options);
    return this.shutdownPromise;
  }

  private async performShutdown(
    options: GracefulShutdownOptions,
  ): Promise<ShutdownResult> {
    const start = Date.now();
    const result: ShutdownResult = {
      status: "completed",
      totalTime: 0,
      completedSteps: [],
      failedSteps: [],
    };
    let timer: NodeJS.Timeout | undefined;
    try {
      if (options.drainDelay)
        await new Promise((resolve) => setTimeout(resolve, options.drainDelay));
      const timeout =
        options.timeout ??
        options.waitTimeout ??
        this.options.shutdown?.drainTimeout ??
        19000;
      await Promise.race([
        this.closeTransport(),
        new Promise<void>((resolve, reject) => {
          timer = setTimeout(() => {
            result.status = "forced";
            try {
              this.forceTransport();
              resolve();
            } catch (error) {
              reject(error);
            }
          }, timeout);
        }),
      ]);
      result.completedSteps.push("transport closed");
    } catch (error) {
      result.status = "failed";
      result.failedSteps.push({
        step: "transport close",
        error: String(error),
        timestamp: Date.now(),
      });
      try {
        this.forceTransport();
      } catch (forceError) {
        result.failedSteps.push({
          step: "force close",
          error: String(forceError),
          timestamp: Date.now(),
        });
      }
    } finally {
      if (timer) clearTimeout(timer);
      for (const cleanup of [
        () => this.tracker.closeAll(),
        () => this.cleanup(),
      ]) {
        try {
          cleanup();
        } catch (error) {
          result.status = "failed";
          result.failedSteps.push({
            step: "cleanup",
            error: String(error),
            timestamp: Date.now(),
          });
        }
      }
      TerminusManager.unregisterServer(this);
      this.status = 0;
      result.totalTime = Date.now() - start;
    }
    return result;
  }

  async destroy(): Promise<void> {
    const result = await this.gracefulShutdown();
    if (result.status === "failed")
      throw new Error(result.failedSteps[0]?.error ?? "Server shutdown failed");
  }
  Stop(callback?: (error?: Error) => void): void {
    this.destroy().then(
      () => callback?.(),
      (error) => callback?.(error),
    );
  }

  async updateConfig(config: Partial<T>): Promise<boolean> {
    if (deepEqual(this.options, { ...this.options, ...config })) return false;
    const running = this.status === 200;
    await this.destroy();
    this.options = { ...this.options, ...config };
    this.shutdownPromise = undefined;
    this.tracker = new ConnectionTracker(
      this.options.connectionPool?.maxConnections ?? 0,
    );
    this.recreate();
    this.configVersion++;
    if (running) await new Promise<void>((resolve) => this.Start(resolve));
    return true;
  }
}
