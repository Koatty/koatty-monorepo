/**
 * @ author: richen
 * @ copyright: Copyright (c) - <richenlin(at)gmail.com>
 * @ license: BSD-3-Clause
 * @ version: 2026-04-02
 */

import { createApplication } from "koatty";
import { KoattyApplication } from "koatty_core";
import { Constructor, TestApplication, TestAppOptions } from "./types";

/**
 * Create a test application instance from a Koatty application class
 * 
 * IMPORTANT: The AppClass must be decorated with @Bootstrap() for proper initialization.
 * createApplication() runs the full 11-step bootstrap sequence (appBoot → loadConfigure →
 * loadComponent → ... → appReady) WITHOUT starting the server, making it ideal for testing.
 * 
 * @param AppClass - The Koatty application class constructor (must have @Bootstrap() decorator)
 * @param options - Optional configuration for test app
 * @returns Promise resolving to a TestApplication wrapper
 * 
 * @example
 * ```ts
 * import { createTestApp } from 'koatty_testing';
 * import { TestApp } from './src/TestApp';
 * 
 * @Bootstrap()
 * class MyTestApp extends Koatty {
 *   // ...
 * }
 * 
 * describe('My Tests', () => {
 *   let testApp: TestApplication;
 *   
 *   beforeAll(async () => {
 *     testApp = await createTestApp(MyTestApp);
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
  const { env = {} } = options || {};

  // Save original environment variables before setting new ones
  const originalEnv: Record<string, string | undefined> = {};
  Object.keys(env).forEach(key => {
    originalEnv[key] = process.env[key];
  });

  // Set environment variables
  Object.entries(env).forEach(([key, value]) => {
    process.env[key] = value;
  });

  // createApplication() runs full bootstrap without starting server
  // NOTE: AppClass must be decorated with @Bootstrap()
  let app: KoattyApplication;
  try {
    app = await createApplication(AppClass);
  } catch (err) {
    // Restore env on bootstrap failure so partial env changes don't leak
    Object.keys(originalEnv).forEach(key => {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    });
    throw err;
  }

  return {
    app,
    async start() {
      if (typeof (app as any).listen === 'function') {
        await (app as any).listen();
      }
    },
    async stop() {
      if (typeof (app as any).stop === 'function') {
        await (app as any).stop();
      }
      
      // Restore original environment variables
      Object.keys(originalEnv).forEach(key => {
        if (originalEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = originalEnv[key];
        }
      });
    },
    getServer() {
      return (app as any).server || null;
    }
  };
}
