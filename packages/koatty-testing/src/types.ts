/**
 * @ author: richen
 * @ copyright: Copyright (c) - <richenlin(at)gmail.com>
 * @ license: BSD-3-Clause
 * @ version: 2026-04-02
 */

import type { KoattyApplication } from "koatty_core";

/**
 * Constructor type for creating instances
 */
export type Constructor<T = any> = new (...args: any[]) => T;

/**
 * Options for creating a test application
 */
export interface TestAppOptions {
  /**
   * Environment variables to set before creating the app
   */
  env?: Record<string, string>;
}

/**
 * Interface for test application wrapper
 */
export interface TestApplication {
  /**
   * The underlying Koatty application instance
   */
  app: KoattyApplication;

  /**
   * Start the application server
   */
  start(): Promise<void>;

  /**
   * Stop the application server
   */
  stop(): Promise<void>;

  /**
   * Get the underlying HTTP server (if available)
   */
  getServer(): any;
}
