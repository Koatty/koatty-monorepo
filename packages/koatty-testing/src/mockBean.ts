/**
 * @ author: richen
 * @ copyright: Copyright (c) - <richenlin(at)gmail.com>
 * @ license: BSD-3-Clause
 * @ version: 2026-04-02
 */

import { Container } from "koatty_container";

/**
 * Mock a bean in the container with a custom implementation
 * Useful for replacing dependencies in tests
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
  const container = Container.getInstance();
  
  // Register the mock in the container
  container.reg(identifier, mock);
}

/**
 * Reset the container to a clean state
 * This clears all instances while preserving class registrations and metadata
 * Safe to use in afterEach hooks - idempotent operation
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
  const container = Container.getInstance();
  
  // Clear instances only, preserve class registrations and metadata
  // This is idempotent - calling multiple times has the same effect
  container.clearInstances();
}

/**
 * Clear all mocks and reset container to initial state
 * More aggressive reset - clears instances, classes, and metadata
 * Use with caution - this will require re-registration of all beans
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
  const container = Container.getInstance();
  
  // Clear everything
  container.clearInstances();
  container.clearClass();
  container.clearMetadata();
}
