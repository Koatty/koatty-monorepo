import { createRequire } from "module";
import path from "path";
import { KoattyApplication, KoattyServer, NativeServer } from "koatty_core";
import { ConfigHelper, ListeningOptions } from "../config/config";
import { HttpServer } from "./http";
import { HttpsServer } from "./https";
import { Http2Server } from "./http2";
import { GrpcServer } from "./grpc";
import { WsServer } from "./ws";

/** The wrapper preserves the existing KoattyServer contract; the transport owns resources. */
export class SingleProtocolServer implements KoattyServer {
  readonly protocol: string;
  readonly options: ListeningOptions;
  private serverInstance: any;
  server: NativeServer | null = null;
  status = 0;
  listenCallback?: () => void;
  constructor(
    private app: KoattyApplication,
    opt: ListeningOptions,
  ) {
    this.options = {
      hostname: "127.0.0.1",
      port: 3000,
      protocol: "http",
      ...opt,
      ext: { ...opt.ext },
    };
    this.protocol = this.options.protocol;
    const router = this.app.config?.("config.RouterComponent", "plugin") ?? {
      ext: {},
    };
    if (this.protocol === "grpc")
      this.options.ext.protoFile =
        router.ext?.grpc?.protoFile ?? this.options.ext.protoFile;
    if (this.protocol === "graphql")
      this.options.ext.schemaFile =
        router.ext?.graphql?.schemaFile ?? this.options.ext.schemaFile;
    ConfigHelper.configureSSLForProtocol(this.protocol, this.options);
    let Constructor: any = {
      http: HttpServer,
      https: HttpsServer,
      http2: Http2Server,
      grpc: GrpcServer,
      ws: WsServer,
      wss: WsServer,
    }[this.protocol];
    if (this.protocol === "graphql") {
      Constructor = this.options.ssl?.enabled ? Http2Server : HttpServer;
      this.options.ext._underlyingProtocol = this.options.ssl?.enabled
        ? "http2"
        : "http";
      this.options.ext._actualProtocol = this.options.ext._underlyingProtocol;
    }
    if (this.protocol === "http3") {
      const requireFromApp = createRequire(
        path.join(this.app.rootPath ?? process.cwd(), "package.json"),
      );
      let filename: string;
      try {
        filename = requireFromApp.resolve("koatty_http3");
      } catch {
        throw new Error(
          "HTTP/3 is optional: install koatty_http3 in this application (experimental).",
        );
      }
      Constructor = requireFromApp(filename).Http3Server;
    }
    if (!Constructor)
      throw new Error(`Unsupported server protocol: ${this.protocol}`);
    this.serverInstance = new Constructor(app, this.options);
  }
  Start(callback?: () => void): any {
    this.listenCallback = callback;
    this.serverInstance.Start(() => {
      this.server = this.serverInstance.getNativeServer();
      this.status = 200;
      callback?.();
    });
    return this;
  }
  beginDrain(): void {
    this.status = 503;
    this.serverInstance.beginDrain();
  }
  Stop(callback?: (error?: Error) => void): void {
    this.beginDrain();
    this.serverInstance.Stop((error?: Error) => {
      this.status = 0;
      this.server = null;
      callback?.(error);
    });
  }
  RegisterService(impl: any): any {
    return this.serverInstance.RegisterService?.(impl);
  }
  getStatus(): number {
    return this.serverInstance.getStatus();
  }
  getNativeServer(): NativeServer {
    return this.serverInstance.getNativeServer();
  }
  getHealthStatus() {
    const pool = this.serverInstance.getConnectionPoolHealth?.();
    const status =
      this.getStatus() !== 200
        ? "unhealthy"
        : pool?.status === "overloaded" || pool?.status === "degraded"
          ? "degraded"
          : "healthy";
    return {
      status,
      checks: {
        server: {
          status: this.getStatus() === 200 ? "healthy" : "unhealthy",
          uptime: Date.now() - (this.serverInstance.startTime || Date.now()),
          protocol: this.protocol,
          port: this.options.port,
        },
        connectionPool: pool,
      },
      timestamp: Date.now(),
    };
  }
  /** @deprecated Application request metrics are exported by koatty_trace. */
  getMetrics(): string {
    return `# TYPE koatty_server_status gauge\nkoatty_server_status{protocol="${this.protocol}"} ${this.getStatus() === 200 ? 1 : 0}`;
  }
  healthCheckMiddleware() {
    return async (ctx: any, next: () => Promise<void>) => {
      const path = ctx.path || ctx.url;

      // Liveness endpoint (SEC-06 / B-6): minimal body only — no memory,
      // CPU or connection details
      if (path === "/health" || path === "/healthz") {
        const health = this.getHealthStatus();
        ctx.status = health.status === "healthy" ? 200 : 503;
        ctx.type = "application/json";
        ctx.body = { status: health.status === "healthy" ? "ok" : "unhealthy" };
        return;
      }

      // Metrics endpoint (SEC-06 / B-6): exposure governed by the security
      // profile; internal policy restricts to loopback/RFC1918 or ops token
      if (path === "/metrics") {
        const policy =
          (this.app as any)?.security?.ops?.exposeMetrics ?? "internal";
        if (policy === "off") {
          ctx.status = 404;
          ctx.body = { message: "Not Found" };
          return;
        }
        if (policy !== "public") {
          const ip = String(ctx.req?.socket?.remoteAddress || "");
          const { isTrustedRemoteIp } =
            await import("../middleware/healthCheck");
          const auth = String(ctx.headers?.authorization || "");
          const token = (this.app as any)?.config?.("ops")?.token;
          const trusted =
            isTrustedRemoteIp(ip) || (token && auth === `Bearer ${token}`);
          if (!trusted) {
            ctx.status = 403;
            ctx.body = { message: "Forbidden" };
            return;
          }
        }
        ctx.status = 200;
        ctx.type = "text/plain; version=0.0.4; charset=utf-8";
        ctx.body = this.getMetrics();
        return;
      }

      await next();
    };
  }
}
export function NewServe(
  app: KoattyApplication,
  opt?: ListeningOptions,
): KoattyServer {
  const port = Number(process.env.PORT ?? process.env.APP_PORT ?? 3000);
  const options: ListeningOptions = {
    hostname: process.env.IP ?? "127.0.0.1",
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 3000,
    protocol: "http",
    ...opt,
  };
  if (
    !Number.isInteger(options.port) ||
    options.port < 0 ||
    options.port > 65535
  )
    throw new Error("Port must be an integer between 0 and 65535");
  return new SingleProtocolServer(app, options);
}
