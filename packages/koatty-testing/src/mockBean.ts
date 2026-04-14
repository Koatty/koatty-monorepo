/**
 * @ author: richen
 * @ copyright: Copyright (c) - <richenlin(at)gmail.com>
 * @ license: BSD-3-Clause
 * @ version: 2026-04-02
 */

import { Container } from "koatty_container";

// Module-level mock store
const mockStore = new Map<string, any>();
let patched = false;
let originalGet: typeof Container.prototype.get | null = null;

/**
 * Ensure Container.prototype.get is monkey-patched to check mockStore first.
 * This patch is applied exactly once.
 */
function ensurePatched(): void {
  if (patched) return;
  patched = true;

  originalGet = Container.prototype.get;
  Container.prototype.get = function<T>(identifier: any, ...args: any[]): T {
    const key = (typeof identifier === 'function' && identifier.name)
      ? identifier.name
      : String(identifier);
    if (mockStore.has(key)) {
      return mockStore.get(key) as T;
    }
    return originalGet!.call(this, identifier, ...args);
  };
}

/**
 * Mock a bean in the container with a custom implementation.
 * Uses monkey-patching of Container.prototype.get to intercept bean lookups.
 * 
 * @param identifier - The identifier of the bean to mock
 * @param mock - The mock implementation or value
 * 
 * @example
 * ```ts
 * import { mockBean } from 'koatty_testing';
 * 
 * beforeEach(() => {
 *   mockBean('UserService', {
 *     getUser: jest.fn().mockResolvedValue({ id: 1, name: 'Test' })
 *   });
 * });
 * ```
 */
export function mockBean(identifier: string, mock: any): void {
  ensurePatched();
  mockStore.set(identifier, mock);
}

/**
 * Reset the container to a clean state.
 * Clears all mocks and instances while preserving class registrations and metadata.
 * Safe to use in afterEach hooks - idempotent operation.
 * 
 * Note: The Container.prototype.get monkey-patch remains active after resetContainer()
 * but is harmless — an empty mockStore transparently delegates to the original get().
 * Use clearAll() if you need to fully remove the patch (e.g., after all tests complete).
 * 
 * @example
 * ```ts
 * import { resetContainer } from 'koatty_testing';
 * 
 * afterEach(() => {
 *   resetContainer();
 * });
 * ```
 */
export function resetContainer(): void {
  mockStore.clear();
  const container = Container.getInstance();
  container.clearInstances();
}

/**
 * Clear all mocks and reset container to initial state.
 * More aggressive reset - clears instances, classes, and metadata.
 * Also restores the original Container.prototype.get method.
 * Use with caution - this will require re-registration of all beans.
 * 
 * @example
 * ```ts
 * import { clearAll } from 'koatty_testing';
 * 
 * afterEach(() => {
 *   clearAll();
 * });
 * ```
 */
export function clearAll(): void {
  mockStore.clear();
  const container = Container.getInstance();
  container.clearInstances();
  container.clearClass();
  container.clearMetadata();
  
  // Restore original Container.prototype.get
  if (patched && originalGet) {
    Container.prototype.get = originalGet;
    patched = false;
    originalGet = null;
  }
}
