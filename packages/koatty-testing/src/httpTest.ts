/**
 * @ author: richen
 * @ copyright: Copyright (c) - <richenlin(at)gmail.com>
 * @ license: BSD-3-Clause
 * @ version: 2026-04-02
 */

import type { KoattyApplication } from "koatty_core";
import type { SuperTest, Test } from "supertest";

/**
 * Create a supertest instance for testing HTTP endpoints
 * Wraps the Koatty application to work with supertest
 * 
 * @param app - The Koatty application instance
 * @returns SuperTest instance for making HTTP requests
 * 
 * @example
 * ```ts
 * import { createTestApp, createHttpTest } from 'koatty_testing';
 * import { TestApp } from './src/TestApp';
 * 
 * describe('API Tests', () => {
 *   let request: SuperTest<Test>;
 *   
 *   beforeAll(async () => {
 *     const app = await createTestApp(TestApp);
 *     request = createHttpTest(app);
 *   });
 *   
 *   it('should return 200', async () => {
 *     const response = await request.get('/api/health');
 *     expect(response.status).toBe(200);
 *   });
 * });
 * ```
 */
export function createHttpTest(app: KoattyApplication): SuperTest<Test> {
  // Dynamic import to handle peer dependency
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const supertest = require('supertest');
  
  // Get the underlying Koa callback or HTTP server
  const callback = app.callback ? app.callback() : app;
  
  return supertest(callback);
}
