import { createServer } from "http";
import { createServer as createHttpsServer } from "https";
import { createSecureServer } from "http2";
import { createSecureContext } from "tls";
import { KoattyApplication, NativeServer } from "koatty_core";
import { BaseServer, closeIdleConnections } from "./base";
import { ConfigHelper, HttpServerOptions } from "../config/config";
import {
  createHealthCheckMiddleware,
  resolveOpsConfig,
} from "../middleware/healthCheck";
import { createRateLimitMiddleware } from "../middleware/rateLimit";
import {
  loadCertificates,
  watchCertificates,
  minimumTlsVersion,
} from "../utils/cert-loader";
import { CreateTerminus } from "../utils/terminus";

/** HTTP-family transports share one request, TLS, timeout and shutdown implementation. */
export class HttpServer extends BaseServer<HttpServerOptions> {
  private stopCertificateWatch?: () => void;
  private sessions = new Set<any>();
  protected transport: "http" | "https" | "http2";

  constructor(
    app: KoattyApplication,
    options: HttpServerOptions,
    transport: "http" | "https" | "http2" = "http",
  ) {
    const normalized =
      transport === "https"
        ? ConfigHelper.createHttpsConfig(options)
        : transport === "http2"
          ? ConfigHelper.createHttp2Config(options)
          : ConfigHelper.createHttpConfig(options);
    super(app, normalized);
    this.transport = transport;
    this.recreate();
    CreateTerminus(app, this);
  }

  protected resolveMinVersion(ssl: any): "TLSv1.2" | "TLSv1.3" {
    return minimumTlsVersion(
      ssl.minVersion,
      (this.app as any).security?.tls?.minVersion,
    );
  }

  protected tlsOptions(): any {
    const ssl: any = this.options.ssl ?? {};
    if (!ssl.key || !ssl.cert)
      throw new Error(`SSL key and cert are required for ${this.transport}`);
    const { mode, enabled: _enabled, ...options } = ssl;
    return {
      ...options,
      ...loadCertificates(ssl),
      minVersion: this.resolveMinVersion(ssl),
      ...(mode === "mutual_tls"
        ? {
            requestCert: ssl.requestCert !== false,
            rejectUnauthorized: ssl.rejectUnauthorized !== false,
          }
        : {}),
    };
  }

  protected recreate(): void {
    const rate = createRateLimitMiddleware((this.options as any).rateLimit);
    const health = createHealthCheckMiddleware({
      ...this.options.health,
      ...resolveOpsConfig(this.app),
    });
    this.healthMiddleware = health;
    // Resolve the cached callback at dispatch: app.use() can invalidate composition.
    const onRequest = (req: any, res: any) => {
      Promise.resolve(
        health(req, res, () =>
          rate
            ? rate(req, res, () => this.app.callback()(req, res))
            : this.app.callback()(req, res),
        ),
      ).catch((error) => {
        this.logger.error("Request handling error", {}, error);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end('{"error":"Internal Server Error"}');
        } else res.destroy?.();
      });
    };
    if (this.transport === "http") this.server = createServer(onRequest);
    else if (this.transport === "https")
      this.server = createHttpsServer(this.tlsOptions(), onRequest);
    else
      this.server = createSecureServer(
        {
          ...this.tlsOptions(),
          allowHTTP1: (this.options.ssl as any)?.allowHTTP1 !== false,
          ...((this.options as any).http2 ?? {}),
        },
        onRequest,
      );
    const config = this.options.connectionPool ?? {};
    for (const key of [
      "keepAliveTimeout",
      "headersTimeout",
      "requestTimeout",
    ] as const) {
      if (config[key] !== undefined) this.server[key] = config[key];
    }
    this.server.on("connection", (socket: any) => this.tracker.add(socket));
    if (this.transport === "http2")
      this.server.on("session", (session: any) => {
        this.sessions.add(session);
        session.once("close", () => this.sessions.delete(session));
        session.on("error", () => session.destroy());
      });
    this.server.on("error", (error: Error) =>
      this.logger.error("Server error", {}, error),
    );
    if (this.transport !== "http")
      this.stopCertificateWatch = watchCertificates(
        (this.options.ssl as any) ?? {},
        () => {
          const options = this.tlsOptions();
          createSecureContext(options);
          this.server.setSecureContext(options);
        },
        (error) =>
          this.logger.warn(
            "TLS certificate reload failed; retaining current certificate",
            {},
            error,
          ),
      );
  }

  Start(callback?: () => void): NativeServer {
    this.listenCallback = callback ?? this.listenCallback;
    this.server.listen(this.options.port, this.options.hostname, () => {
      this.markStarted();
      this.listenCallback?.();
    });
    return this.server;
  }
  protected closeTransport(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error?: NodeJS.ErrnoException) =>
        error && error.code !== "ERR_SERVER_NOT_RUNNING"
          ? reject(error)
          : resolve(),
      );
      closeIdleConnections(this.server);
      for (const session of this.sessions) session.close();
    });
  }
  protected forceTransport(): void {
    for (const session of this.sessions) session.destroy();
    this.sessions.clear();
    this.server.closeAllConnections?.();
    this.tracker.closeAll();
  }
  protected cleanup(): void {
    this.stopCertificateWatch?.();
    this.stopCertificateWatch = undefined;
  }
  /** @deprecated Connection counts only; request metrics are provided by trace. */
  getDetailedConnectionStats() {
    return this.getConnectionStats();
  }
}
