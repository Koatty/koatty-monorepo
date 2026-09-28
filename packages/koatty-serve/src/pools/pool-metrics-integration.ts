import { KoattyApplication } from "koatty_core";

/** @deprecated Exposes only this application's connection counts; use trace for request metrics. */
export function registerConnectionPoolMetrics(app: KoattyApplication): void {
  (app as any).setConnectionPoolMetricsCallback?.(() => {
    const servers = Array.isArray(app.server) ? app.server : [app.server];
    return Object.fromEntries(
      servers
        .filter(Boolean)
        .map((server: any, index) => [
          `${server.protocol ?? "server"}:${index}`,
          server.getConnectionStats?.() ??
            server.getHealthStatus?.().checks.connectionPool ??
            {},
        ]),
    );
  });
}
export function unregisterConnectionPoolMetrics(app: KoattyApplication): void {
  (app as any).setConnectionPoolMetricsCallback?.(() => ({}));
}
