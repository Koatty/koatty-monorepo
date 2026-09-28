import type { KoattyApplication, NativeServer } from "koatty_core";
import {
  BaseServer,
  ConfigHelper,
  CreateTerminus,
  createHealthCheckMiddleware,
  resolveOpsConfig,
  createRateLimitMiddleware,
} from "koatty_serve/internal";
import type { Http3ServerOptions } from "koatty_serve/internal";
import { Http3ServerAdapter } from "./adapters/http3-matrixai";
export {
  Http3ServerAdapter,
  isMatrixaiQuicReady,
  waitForMatrixaiQuic,
} from "./adapters/http3-matrixai";
export type { Http3ServerOptions } from "koatty_serve/internal";

/** Experimental transport. An unavailable QUIC backend is a startup error, never a mock listener. */
export class Http3Server extends BaseServer<
  Http3ServerOptions,
  Http3ServerAdapter
> {
  constructor(app: KoattyApplication, options: Http3ServerOptions) {
    super(app, ConfigHelper.createHttp3Config(options));
    this.recreate();
    CreateTerminus(app, this);
  }
  protected recreate(): void {
    const ssl = this.options.ssl;
    if (!ssl?.key || !ssl.cert)
      throw new Error("HTTP/3 requires a TLS key and certificate");
    if (ssl.mode === "mutual_tls" || ssl.requestCert)
      throw new Error(
        "The experimental HTTP/3 backend does not support mutual TLS",
      );
    this.server = new Http3ServerAdapter({
      ...this.options.quic,
      ...this.options.http3,
      hostname: this.options.hostname,
      port: this.options.port,
      keyFile: ssl.key,
      certFile: ssl.cert,
      caFile: ssl.ca,
    });
    const health = createHealthCheckMiddleware({
      ...this.options.health,
      ...resolveOpsConfig(this.app),
    });
    const rate = createRateLimitMiddleware(this.options.rateLimit as any);
    this.healthMiddleware = health;
    this.server.on("request", (req: any, res: any) => {
      Promise.resolve(
        health(req, res, () =>
          rate ? rate(req, res, () => this.app.callback()(req, res)) : this.app.callback()(req, res),
        ),
      ).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end("Internal server error");
        }
      });
    });
    this.server.on("session", (session: any) =>
      this.tracker.add({
        once: session.once?.bind(session),
        removeListener: session.removeListener?.bind(session),
        destroy: () => {
          void session.stop?.();
        },
      }),
    );
  }
  Start(callback?: () => void): NativeServer {
    void this.server
      .listen(() => {
        this.markStarted();
        callback?.();
      })
      .catch((error) => (this.app as any).emit("error", error));
    return this.server as unknown as NativeServer;
  }
  protected closeTransport(): Promise<void> {
    return this.server.close();
  }
  protected forceTransport(): void {
    this.tracker.closeAll();
    void this.server.close();
  }
}
