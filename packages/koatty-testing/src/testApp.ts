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
 * Use an undecorated application class; @Bootstrap() also starts the application on import.
 * createApplication() runs the full 11-step bootstrap sequence (appBoot → loadConfigure →
 * loadComponent → ... → appReady) WITHOUT starting the server, making it ideal for testing.
 * 
 * @param AppClass - The Koatty application class constructor (without automatic bootstrap)
 * @param options - Optional configuration for test app
 * @returns Promise resolving to a TestApplication wrapper
 * 
 * @example
 * ```ts
 * import { createTestApp } from 'koatty_testing';
 * import { TestApp } from './src/TestApp';
 * 
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
  // AppClass must not auto-start via @Bootstrap().
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

  let started: Promise<void> | undefined;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    Object.keys(originalEnv).forEach(key => {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    });
  };
  return {
    app,
    async start() {
      if (!started) {
        started = new Promise<void>((resolve, reject) => {
          const emitter = app as any;
          const servers = (Array.isArray(emitter.server) ? emitter.server : [emitter.server])
            .map((s: any) => s?.getNativeServer?.()).filter(Boolean);
          const cleanup = () => { emitter.removeListener?.('error', failed); servers.forEach((s: any) => s.removeListener?.('error', failed)); };
          const failed = (error: Error) => { cleanup(); reject(error); };
          emitter.once?.('error', failed);
          servers.forEach((s: any) => s.once?.('error', failed));
          try {
            if (typeof emitter.listen !== 'function') throw new Error('Application has no listen method');
            emitter.listen(() => { cleanup(); resolve(); });
          } catch (error) { failed(error as Error); }
        });
      }
      await started;
    },
    async stop() {
      try {
        if (typeof (app as any).stop === 'function') await (app as any).stop();
      } finally { restore(); }
    },
    getServer() {
      return (app as any).server || null;
    }
  };
}
