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
  for (const func of event.listeners(eventName)) {
    if (Helper.isFunction(func)) {
      await func();
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
  private app: KoattyApplication | null = null;
  private signalsRegistered = false;
  private exitOnShutdown = true;
  private registeredServerCount = 0;
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

  setExitOnShutdown(value: boolean): void {
    this.exitOnShutdown = value;
  }

  /**
   * Register a server instance
   * 
   * @param app - Koatty application instance
   * @param server - Server instance to register
   * @param serverId - Unique identifier for the server
   */
  registerServer(app: KoattyApplication, _server: KoattyServer, serverId: string): void {
    this.app = app;
    this.registeredServerCount++;
    
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
          Logger.Fatal('Error during shutdown', err);
          process.exit(1);
        });
      };
      this.signalHandlers.set(signal, handler);
      process.on(signal, handler);
    });

    Logger.Info('Global signal handlers registered');
  }

  /**
   * Shutdown all registered servers
   * 
   * Only triggers appStop event. Actual server shutdown is handled by
   * ServeComponent.stopServer which listens to appStop event.
   * 
   * @param signal - Signal that triggered the shutdown
   */
  private async shutdownAll(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      Logger.Warn('Shutdown already in progress, ignoring signal');
      return;
    }
    
    this.isShuttingDown = true;
    Logger.Warn(`Received kill signal (${signal}), shutting down all servers...`);

    const shutdownTimeout = 30000;

    try {
      // 触发应用层清理（ServeComponent.stopServer 会处理实际的服务器关闭）
      if (this.app) {
        Logger.Info('Triggering application stop events');

        let timeoutHandle: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<void>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`Shutdown timeout after ${shutdownTimeout}ms`)),
            shutdownTimeout
          );
        });

        try {
          await Promise.race([
            asyncEvent(this.app, 'appStop').then(() => triggerListeners(process, 'beforeExit')),
            timeoutPromise
          ]);
        } finally {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        }
      }

      Logger.Fatal('Graceful shutdown completed');
      if (this.exitOnShutdown) {
        process.exit(0);
      }

    } catch (error) {
      Logger.Fatal('Error during shutdown', error);
      if (this.exitOnShutdown) {
        process.exit(1);
      }
    }
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

