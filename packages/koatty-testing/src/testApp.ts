/**
 * @ author: richen
 * @ copyright: Copyright (c) - <richenlin(at)gmail.com>
 * @ license: BSD-3-Clause
 * @ version: 2026-04-02
 */

import { Container } from "koatty_container";
import { KoattyApplication } from "koatty_core";
import { Constructor, TestApplication, TestAppOptions } from "./types";

/**
 * Create a test application instance from a Koatty application class
 * 
 * @param AppClass - The Koatty application class constructor
 * @param options - Optional configuration for test app
 * @returns Promise resolving to a TestApplication wrapper
 * 
 * @example
 * ```ts
 * import { createTestApp } from 'koatty_testing';
 * import { TestApp } from './src/TestApp';
 * 
 * describe('My Tests', () => {
 *   let testApp: TestApplication;
 *   
 *   beforeAll(async () => {
 *     testApp = await createTestApp(TestApp);
 *   });
 *   
 *   afterAll(async () => {
 *     await testApp.stop();
 *   });
 * });
 * ```
 */
export async function createTestApp(
  AppClass: Constructor<KoattyApplication>,
  options?: TestAppOptions
): Promise<TestApplication> {
  const { autoInit = true, env = {} } = options || {};

  // Set environment variables if provided
  if (env && Object.keys(env).length > 0) {
    Object.entries(env).forEach(([key, value]) => {
      process.env[key] = value as string;
    });
  }

  // Create application instance
  const app = new AppClass();

  // Initialize if autoInit is true
  if (autoInit && typeof (app as any).init === 'function') {
    await (app as any).init();
  }

  // Return TestApplication wrapper
  return {
    app,
    async start(): Promise<void> {
      if (typeof (app as any).listen === 'function') {
        await (app as any).listen();
      }
    },
    async stop(): Promise<void> {
      if (typeof (app as any).stop === 'function') {
        await (app as any).stop();
      }
    },
    getServer(): any {
      return (app as any).server || null;
    }
  };
}
