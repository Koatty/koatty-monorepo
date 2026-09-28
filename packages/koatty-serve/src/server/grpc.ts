import {
  Server,
  ServerCredentials,
  ServiceDefinition,
  UntypedHandleCall,
} from "@grpc/grpc-js";
import { KoattyApplication, NativeServer } from "koatty_core";
import { BaseServer } from "./base";
import { ConfigHelper, GrpcServerOptions } from "../config/config";
import { loadCertificate } from "../utils/cert-loader";
import { CreateTerminus } from "../utils/terminus";

type GrpcMethodKind =
  | "unary"
  | "client_stream"
  | "server_stream"
  | "bidi_stream";
interface ServiceImplementation {
  service: ServiceDefinition;
  implementation: Record<string, UntypedHandleCall>;
}
export function getGrpcMethodKind(
  service: ServiceDefinition,
  name: string,
): GrpcMethodKind {
  const method = service?.[name];
  return method?.requestStream
    ? method.responseStream
      ? "bidi_stream"
      : "client_stream"
    : method?.responseStream
      ? "server_stream"
      : "unary";
}
export function getGrpcDeadlineMs(call: any): number | undefined {
  try {
    const deadline = call.getDeadline?.();
    if (!deadline || deadline === Infinity) return undefined;
    const time = new Date(deadline).getTime();
    return Number.isFinite(time) ? Math.max(1, time - Date.now()) : undefined;
  } catch {
    return undefined;
  }
}

export class GrpcServer extends BaseServer<GrpcServerOptions, Server> {
  private services: ServiceImplementation[] = [];
  private cancellations = new Set<() => void>();
  constructor(app: KoattyApplication, options: GrpcServerOptions) {
    super(app, ConfigHelper.createGrpcConfig(options));
    this.recreate();
    CreateTerminus(app, this);
  }
  protected recreate(): void {
    const config = this.options.connectionPool ?? {};
    this.server = new Server({
      "grpc.keepalive_time_ms": config.protocolSpecific?.keepAliveTime ?? 30000,
      "grpc.keepalive_timeout_ms": config.keepAliveTimeout ?? 5000,
      "grpc.max_receive_message_length":
        config.protocolSpecific?.maxReceiveMessageLength ?? 4 * 1024 * 1024,
      "grpc.max_send_message_length":
        config.protocolSpecific?.maxSendMessageLength ?? 4 * 1024 * 1024,
      ...this.options.channelOptions,
    });
    for (const service of this.services) this.install(service);
  }
  private createSSLCredentials(): ServerCredentials {
    const ssl = this.options.ssl;
    if (
      !ssl ||
      ssl.enabled === false ||
      !(ssl.key || ssl.cert || ssl.ca || ssl.enabled)
    )
      return ServerCredentials.createInsecure();
    if (!ssl.key || !ssl.cert)
      throw new Error("SSL enabled but key or cert file path not provided");
    return ServerCredentials.createSsl(
      ssl.ca ? Buffer.from(loadCertificate(ssl.ca, "CA certificate")) : null,
      [
        {
          private_key: Buffer.from(loadCertificate(ssl.key, "private key")),
          cert_chain: Buffer.from(loadCertificate(ssl.cert, "certificate")),
        },
      ],
      ssl.clientCertRequired === true,
    );
  }
  Start(callback?: () => void): NativeServer {
    const credentials = this.createSSLCredentials();
    this.server.bindAsync(
      `${this.options.hostname}:${this.options.port}`,
      credentials,
      (error) => {
        if (error) {
          (this.app as any).emit("error", error);
          return;
        }
        this.markStarted();
        (callback ?? this.listenCallback)?.();
      },
    );
    return this.server;
  }
  RegisterService(service: ServiceImplementation): void {
    this.services.push(service);
    this.install(service);
  }
  private install(service: ServiceImplementation): void {
    const wrapped: Record<string, UntypedHandleCall> = {};
    for (const name of Object.keys(service.service)) {
      if (typeof service.implementation[name] !== "function") continue;
      const kind = getGrpcMethodKind(service.service, name);
      const invoke = (call: any, callback?: any) => {
        const handler = this.app.callback("grpc");
        call.koattyMethodKind = kind;
        call.koattyDeadlineMs = getGrpcDeadlineMs(call);
        if (!this.tracker.add(call)) {
          callback?.(
            { code: 8, message: "Server connection limit reached" },
            null,
          );
          return;
        }
        let finished = false;
        let timer: NodeJS.Timeout | undefined;
        const finish = () => {
          if (finished) return false;
          finished = true;
          if (timer) clearTimeout(timer);
          this.tracker.remove(call);
          this.cancellations.delete(cancel);
          call.removeListener?.("cancelled", cancel);
          call.removeListener?.("close", cancel);
          return true;
        };
        const cancel = () => {
          finish();
        };
        this.cancellations.add(cancel);
        call.once?.("cancelled", cancel);
        call.once?.("close", cancel);
        const fail = (error: any) =>
          error && typeof error.code === "number"
            ? error
            : { code: 13, message: error?.message ?? String(error) };
        if (kind === "unary" || kind === "client_stream") {
          const done = (error: any, value: any) => {
            if (finish()) callback?.(error ? fail(error) : null, value);
          };
          timer = setTimeout(
            () => done({ code: 4, message: "Method execution timeout" }, null),
            call.koattyDeadlineMs ??
              this.options.connectionPool?.requestTimeout ??
              30000,
          );
          try {
            Promise.resolve(handler(call, done)).catch((error) =>
              done(error, null),
            );
          } catch (error) {
            done(error, null);
          }
        } else {
          let cancelled = false;
          call.once?.("cancelled", () => {
            cancelled = true;
          });
          const write = call.write?.bind(call);
          if (write)
            call.write = (...args: any[]) =>
              cancelled || call.destroyed || call.writableEnded
                ? false
                : write(...args);
          const failed = (error: any) => {
            finish();
            if (!cancelled)
              call.destroy?.(
                Object.assign(
                  new Error(error?.message ?? "Stream failed"),
                  fail(error),
                ),
              );
          };
          try {
            Promise.resolve(handler(call, undefined)).then(
              () => finish(),
              failed,
            );
          } catch (error) {
            failed(error);
          }
        }
      };
      wrapped[name] = (
        kind === "unary" || kind === "client_stream"
          ? (call: any, callback: any) => invoke(call, callback)
          : (call: any) => invoke(call)
      ) as UntypedHandleCall;
    }
    this.server.addService(service.service, wrapped);
  }
  protected closeTransport(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.server.tryShutdown((error) => (error ? reject(error) : resolve())),
    );
  }
  protected forceTransport(): void {
    this.server.forceShutdown();
  }
  protected cleanup(): void {
    for (const cancel of this.cancellations) cancel();
    this.cancellations.clear();
  }
}
