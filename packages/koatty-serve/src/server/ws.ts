import { createServer, Server as HttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { KoattyApplication, NativeServer } from "koatty_core";
import { WebSocket, WebSocketServer } from "ws";
import { BaseServer, closeIdleConnections } from "./base";
import { ConfigHelper, WebSocketServerOptions } from "../config/config";
import { loadCertificates, minimumTlsVersion } from "../utils/cert-loader";
import { CreateTerminus } from "../utils/terminus";
import { randomUUID } from "crypto";

export class WsServer extends BaseServer<
  WebSocketServerOptions,
  WebSocketServer
> {
  httpServer!: HttpServer;
  private ownHttpServer = true;
  private checkOriginEnabled = false;
  private allowedOrigins: string[] = [];
  private maxBufferedAmount = 1024 * 1024;
  private upgradeRateLimit = { enabled: false, max: 100, windowMs: 60000 };
  private upgradeAttempts = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private upgradeHandler?: (...args: any[]) => void;
  private heartbeat?: NodeJS.Timeout;
  private alive = new WeakMap<WebSocket, boolean>();

  constructor(app: KoattyApplication, options: WebSocketServerOptions) {
    super(app, ConfigHelper.createWebSocketConfig(options));
    this.recreate();
    CreateTerminus(app, this);
  }
  protected recreate(): void {
    const profile = (this.app as any).security?.ws ?? {};
    const config = this.app.config?.("ws") ?? {};
    this.checkOriginEnabled = profile.checkOrigin !== false;
    this.allowedOrigins = Array.isArray(config.allowedOrigins)
      ? config.allowedOrigins
      : [];
    this.maxBufferedAmount = config.maxBufferedAmount ?? 1024 * 1024;
    this.tracker.maxConnections =
      config.maxConnections ?? this.options.connectionPool?.maxConnections ?? 0;
    const rate = config.rateLimit ?? this.options.rateLimit ?? {};
    this.upgradeRateLimit = {
      enabled: rate.enabled === true,
      max: rate.max > 0 ? rate.max : 100,
      windowMs: rate.windowMs > 0 ? rate.windowMs : 60000,
    };
    this.options.wsOptions = {
      ...this.options.wsOptions,
      noServer: true,
      maxPayload:
        this.options.wsOptions?.maxPayload ?? profile.maxPayload ?? 1024 * 1024,
      perMessageDeflate: this.options.wsOptions?.perMessageDeflate ?? false,
    };
    this.server = new WebSocketServer(this.options.wsOptions);
    const external = this.options.ext?.server as HttpServer | undefined;
    this.ownHttpServer = !external;
    if (
      !external &&
      this.protocol === "wss" &&
      (!this.options.ssl?.key || !this.options.ssl?.cert)
    )
      throw new Error("WSS requires an SSL key and certificate");
    this.httpServer =
      external ??
      (this.protocol === "wss"
        ? createHttpsServer({
            ...this.options.ssl,
            ...loadCertificates(this.options.ssl ?? {}),
            minVersion: minimumTlsVersion(
              this.options.ssl?.minVersion,
              (this.app as any).security?.tls?.minVersion,
            ),
          })
        : createServer());
    this.server.address = () => this.httpServer.address();
    this.upgradeHandler = (request: any, socket: any, head: any) => {
      let code = 0;
      if (
        this.isDraining() ||
        !this.acceptUpgrade(socket.remoteAddress ?? "unknown")
      )
        code = 503;
      else if (
        this.checkOriginEnabled &&
        !this.isOriginAllowed(request.headers.origin)
      )
        code = 403;
      else if (
        this.tracker.maxConnections > 0 &&
        this.tracker.size >= this.tracker.maxConnections
      )
        code = 503;
      if (code) {
        socket.end(
          `HTTP/1.1 ${code} ${code === 403 ? "Forbidden" : "Service Unavailable"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        );
        return;
      }
      this.server.handleUpgrade(request, socket, head, (ws) =>
        this.server.emit("connection", ws, request),
      );
    };
    this.httpServer.on("upgrade", this.upgradeHandler);
    this.server.on("connection", (ws, request) => {
      if (!this.tracker.add(ws)) {
        return;
      }
      this.alive.set(ws, true);
      ws.on("pong", () => this.alive.set(ws, true));
      ws.on("error", (error) => this.logger.warn("WebSocket error", {}, error));
      const send = ws.send.bind(ws);
      ws.send = ((...args: any[]) => {
        if (ws.bufferedAmount > this.maxBufferedAmount) {
          ws.close(1008, "Slow consumer");
          const callback = args.at(-1);
          if (typeof callback === "function")
            callback(new Error("Slow consumer"));
          return;
        }
        return (send as any)(...args);
      }) as typeof ws.send;
      ws.on("message", (data) => {
        void this.onMessage(ws, data, request);
      });
      (this.app as any).emit("connection", ws, request);
    });
    const interval = this.options.connectionPool?.pingInterval ?? 30000;
    if (interval > 0) {
      this.heartbeat = setInterval(() => {
        for (const ws of this.tracker.connections as Set<WebSocket>) {
          if (!this.alive.get(ws)) {
            ws.terminate();
            continue;
          }
          this.alive.set(ws, false);
          ws.ping();
        }
      }, interval);
      this.heartbeat.unref?.();
    }
  }
  private async onMessage(
    ws: WebSocket,
    data: any,
    request?: any,
  ): Promise<void> {
    const requestId = randomUUID();
    // The ws library delivers a complete message; preserve the upgrade URL/headers.
    // Core's existing WS context expects req.data and the actual WebSocket as response.
    const req = Object.assign(Object.create(request ?? null), {
      method: "GET",
      url: request?.url ?? "/",
      headers: request?.headers ?? {},
      socket: request?.socket ?? (ws as any)._socket,
      data,
      wsConnectionId: requestId,
    });
    try {
      await this.app.callback(this.protocol)(req, ws);
    } catch (error) {
      this.logger.error("WebSocket message failed", {}, error);
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ error: "Internal server error", requestId }));
    }
  }
  private isOriginAllowed(origin: unknown): boolean {
    if (
      typeof origin !== "string" ||
      origin.length === 0 ||
      origin.length > 256
    ) {
      return false;
    }
    let actual: URL;
    try {
      actual = new URL(origin);
    } catch {
      return false;
    }
    if (
      !["http:", "https:"].includes(actual.protocol) ||
      actual.username ||
      actual.password ||
      actual.pathname !== "/" ||
      actual.search ||
      actual.hash
    )
      return false;
    if (this.allowedOrigins.includes("*")) return true;
    return this.allowedOrigins.some((pattern) => {
      // Host-only entries retain their documented wildcard-host semantics;
      // entries with a scheme always constrain the complete origin.
      const hasScheme = String(pattern).includes("://");
      let allowed: URL;
      try {
        allowed = new URL(
          hasScheme ? pattern : `${actual.protocol}//${pattern}`,
        );
      } catch {
        return false;
      }
      if (
        !["http:", "https:"].includes(allowed.protocol) ||
        allowed.username ||
        allowed.password ||
        allowed.pathname !== "/" ||
        allowed.search ||
        allowed.hash
      )
        return false;
      if (actual.protocol !== allowed.protocol || actual.port !== allowed.port)
        return false;
      const labels = allowed.hostname.toLowerCase().split(".");
      const actualLabels = actual.hostname.toLowerCase().split(".");
      return (
        labels.length === actualLabels.length &&
        labels.every((label, i) =>
          label === "*"
            ? actualLabels[i].length > 0
            : label === actualLabels[i],
        )
      );
    });
  }
  private acceptUpgrade(ip: string): boolean {
    const rate = this.upgradeRateLimit;
    if (!rate.enabled) return true;
    const now = Date.now();
    let entry = this.upgradeAttempts.get(ip);
    if (!entry || entry.resetAt <= now) {
      for (const [key, value] of this.upgradeAttempts) {
        if (value.resetAt <= now) this.upgradeAttempts.delete(key);
      }
      // Refuse new identities under memory pressure rather than grow forever.
      if (this.upgradeAttempts.size >= 10000) return false;
      entry = { count: 0, resetAt: now + rate.windowMs };
      this.upgradeAttempts.set(ip, entry);
    }
    return ++entry.count <= rate.max;
  }
  Start(callback?: () => void): NativeServer {
    if (this.ownHttpServer)
      this.httpServer.listen(this.options.port, this.options.hostname, () => {
        this.markStarted();
        (callback ?? this.listenCallback)?.();
      });
    else {
      this.markStarted();
      (callback ?? this.listenCallback)?.();
    }
    return this.server as NativeServer;
  }
  protected closeTransport(): Promise<void> {
    if (this.upgradeHandler)
      this.httpServer.removeListener("upgrade", this.upgradeHandler);
    for (const ws of this.tracker.connections as Set<WebSocket>)
      ws.close(1001, "Server shutting down");
    return Promise.all([
      new Promise<void>((resolve) => this.server.close(() => resolve())),
      this.ownHttpServer
        ? new Promise<void>((resolve) => {
            this.httpServer.close(() => resolve());
            closeIdleConnections(this.httpServer);
          })
        : Promise.resolve(),
    ]).then((): void => {});
  }
  protected forceTransport(): void {
    this.tracker.closeAll();
    if (this.ownHttpServer) {
      this.httpServer.closeAllConnections?.();
      this.httpServer.close();
    }
  }
  protected cleanup(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.upgradeAttempts.clear();
  }
}
