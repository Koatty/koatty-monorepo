/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2025-01-14
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import EventEmitter from "events";
import { KoattyApplication, KoattyServer } from "koatty_core";
import { Helper } from "koatty_lib";
import { TerminusManager } from "./terminus-manager";

export interface TerminusOptions {
  timeout: number;
  signals?: string[];
  onSignal?: (event: string, app: KoattyApplication, server: KoattyServer, forceTimeout: number) => Promise<any>;
}

/**
 * Create terminus event
 * 
 * Now uses TerminusManager singleton to prevent duplicate signal handler registration
 * when multiple server instances are created.
 *
 * @export
 * @param {KoattyApplication} app
 * @param {(Server | Http2SecureServer)} server
 * @param {TerminusOptions} [options]
 */
export function CreateTerminus(app: KoattyApplication, server: KoattyServer, _options?: TerminusOptions): void {
  // Generate unique server ID
  const serverId = (server as any).serverId || `server_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  
  // Register server with TerminusManager singleton
  TerminusManager.getInstance().registerServer(app, server, serverId);
}
type processEvent = "beforeExit" | "exit" | NodeJS.Signals;

export function BindProcessEvent(event: EventEmitter, originEventName: string, targetEventName: processEvent = "beforeExit") {
  event.listeners(originEventName).forEach(func => {
    if (Helper.isFunction(func)) {
      process.addListener(<any>targetEventName, func);
    }
  });
  event.removeAllListeners(originEventName);
}

export { TerminusManager } from "./terminus-manager";
