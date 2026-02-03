/**
 * Connection Pool Metrics Integration
 * Provides integration between koatty-serve connection pools and Application performance metrics
 */

import { KoattyApplication } from "koatty_core";
import { ConnectionPoolFactory } from "./factory";

/**
 * Register connection pool metrics callback with Application instance
 * This allows Application.getPerformanceMetrics() to include connection pool statistics
 * without creating a circular dependency between koatty-core and koatty-serve
 *
 * @param {KoattyApplication} app - Application instance
 * @returns {void}
 */
export function registerConnectionPoolMetrics(app: KoattyApplication): void {
  if (typeof (app as any).setConnectionPoolMetricsCallback === 'function') {
    (app as any).setConnectionPoolMetricsCallback(() => {
      return ConnectionPoolFactory.getAllMetrics();
    });
  }
}

/**
 * Unregister connection pool metrics callback from Application instance
 *
 * @param {KoattyApplication} app - Application instance
 * @returns {void}
 */
export function unregisterConnectionPoolMetrics(app: KoattyApplication): void {
  if (typeof (app as any).setConnectionPoolMetricsCallback === 'function') {
    (app as any).setConnectionPoolMetricsCallback(() => ({}));
  }
}
