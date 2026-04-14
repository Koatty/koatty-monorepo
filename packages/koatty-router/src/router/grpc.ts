/*
 * @Description:
 * @Usage:
 * @Author: richen
 * @Date: 2021-06-29 14:10:30
 * @LastEditTime: 2025-04-06 22:56:00
 */
import { UntypedHandleCall, ServerReadableStream, ServerWritableStream, ServerDuplexStream } from "@grpc/grpc-js";
import path from "path";
import { IOC } from "koatty_container";
import {
  IRpcServerCall,
  IRpcServerCallback,
  Koatty, 
  KoattyContext,
  KoattyRouter,
  RouterImplementation
} from "koatty_core";
import * as Helper from "koatty_lib";
import { DefaultLogger as Logger } from "koatty_logger";
import { ListServices, LoadProto } from "koatty_proto";
import { injectParamMetaData, injectRouter, ParamMetadata } from "../utils/inject";
import { parsePath } from "../utils/path";
import { RouterOptions } from "./router";
import { Handler } from "../utils/handler";
import { getProtocolConfig, validateProtocolConfig, StreamConfig } from "./types";

/**
 * gRPC流类型枚举
 */
export enum GrpcStreamType {
  UNARY = 'unary',
  SERVER_STREAMING = 'server_streaming',
  CLIENT_STREAMING = 'client_streaming',
  BIDIRECTIONAL_STREAMING = 'bidirectional_streaming'
}

/**
 * GrpcRouter Options
 */
export interface GrpcRouterOptions extends RouterOptions {
  protoFile: string;
  streamConfig?: StreamConfig;
}

/**
 * 流状态管理
 */
interface StreamState {
  id: string;
  type: GrpcStreamType;
  startTime: number;
  messageCount: number;
  bufferSize: number;
  isActive: boolean;
}

/**
 * 流管理器
 */
class StreamManager {
  private streams: Map<string, StreamState>;
  private config: StreamConfig;

  constructor(config: StreamConfig = {}) {
    this.streams = new Map();
    this.config = {
      maxConcurrentStreams: config.maxConcurrentStreams || 100,
      streamTimeout: config.streamTimeout || 300000, // 5分钟
      backpressureThreshold: config.backpressureThreshold || 1000,
      ...config
    };
  }

  /**
   * 注册新流
   */
  registerStream(id: string, type: GrpcStreamType): StreamState {
    const state: StreamState = {
      id,
      type,
      startTime: Date.now(),
      messageCount: 0,
      bufferSize: 0,
      isActive: true
    };
    
    this.streams.set(id, state);
    this.cleanupExpiredStreams();
    
    return state;
  }

  /**
   * 移除流
   */
  removeStream(id: string): void {
    this.streams.delete(id);
  }

  /**
   * 获取流状态
   */
  getStreamState(id: string): StreamState | undefined {
    return this.streams.get(id);
  }

  /**
   * 更新流状态
   */
  updateStream(id: string, updates: Partial<StreamState>): void {
    const state = this.streams.get(id);
    if (state) {
      Object.assign(state, updates);
    }
  }

  /**
   * 检查是否达到背压阈值
   */
  isBackpressureTriggered(id: string): boolean {
    const state = this.streams.get(id);
    return state ? state.bufferSize > this.config.backpressureThreshold! : false;
  }

  /**
   * 清理过期流
   */
  private cleanupExpiredStreams(): void {
    const now = Date.now();
    for (const [id, state] of this.streams.entries()) {
      if (now - state.startTime > this.config.streamTimeout!) {
        Logger.Warn(`Stream ${id} expired, removing...`);
        this.streams.delete(id);
      }
    }
  }

  /**
   * 获取活跃流数量
   */
  getActiveStreamCount(): number {
    return Array.from(this.streams.values()).filter(s => s.isActive).length;
  }

  /**
   * Close all active streams
   */
  closeAllStreams(): void {
    const activeCount = this.getActiveStreamCount();
    if (activeCount > 0) {
      Logger.Info(`Closing ${activeCount} active gRPC streams...`);
    }

    for (const [id, state] of this.streams.entries()) {
      if (state.isActive) {
        state.isActive = false;
        Logger.Debug(`Closed stream: ${id}`);
      }
    }

    this.streams.clear();
    Logger.Debug('All gRPC streams closed');
  }
}

/**
 * CtlInterface
 *
 * @interface CtlInterface
 */
interface CtlInterface {
  [path: string]: {
    name: string;
    ctl: Function;
    method: string;
    params: ParamMetadata[];
    composedMiddleware?: Function;
  }
}

export class GrpcRouter implements KoattyRouter {
  readonly protocol: string;
  options: GrpcRouterOptions;
  router: Map<string, RouterImplementation>;
  private streamManager: StreamManager;

  constructor(app: Koatty, options: RouterOptions = { protocol: "grpc", prefix: "" }) {
    const extConfig = getProtocolConfig('grpc', options.ext || {});
    
    // 配置验证
    const validation = validateProtocolConfig('grpc', options.ext || {});
    if (!validation.valid) {
      throw new Error(`gRPC router configuration error: ${validation.errors.join(', ')}`);
    }
    if (validation.warnings.length > 0) {
      validation.warnings.forEach((warning: string) => Logger.Warn(`[GrpcRouter] ${warning}`));
    }
    
    // Resolve protoFile path: if relative, resolve against app.rootPath
    let protoFilePath = extConfig.protoFile;
    if (protoFilePath && !path.isAbsolute(protoFilePath) && app.rootPath) {
      protoFilePath = path.resolve(app.rootPath, protoFilePath);
    }
    
    this.options = {
      ...options,
      protoFile: protoFilePath,
      streamConfig: extConfig.streamConfig || {}
    } as GrpcRouterOptions;
    
    this.protocol = options.protocol || "grpc";
    this.router = new Map();
    this.streamManager = new StreamManager(this.options.streamConfig);
  }

  /**
   * SetRouter
   * @param name 
   * @param impl 
   * @returns 
   */
  SetRouter(name: string, impl?: RouterImplementation) {
    if (Helper.isEmpty(name)) return;
    this.router.set(name, {
      service: impl?.service,
      implementation: impl?.implementation
    });
  }

  /**
   * ListRouter
   *
   * @returns {*}  {Map<string, ServiceImplementation>}
   * @memberof GrpcRouter
   */
  ListRouter(): Map<string, RouterImplementation> {
    return this.router;
  }

  /**
   * 检测gRPC流类型
   */
  private detectStreamType(call: any): GrpcStreamType {
    // 一元调用：call.request 存在（包含请求数据）
    // 流调用：call 本身就是流对象，数据通过事件接收
    if (call.request) {
      Logger.Debug(`[GRPC_ROUTER] Stream detection: UNARY (call.request exists)`);
      return GrpcStreamType.UNARY;
    }
    
    // 对于流调用，检查是否是真正的流对象（Stream 类型）
    const isActuallyReadableStream = call.readable === true;
    const isActuallyWritableStream = call.writable === true;
    
    Logger.Debug(`[GRPC_ROUTER] Stream detection: readable=${call.readable}, writable=${call.writable}`);
    
    if (isActuallyReadableStream && isActuallyWritableStream) {
      return GrpcStreamType.BIDIRECTIONAL_STREAMING;
    } else if (isActuallyReadableStream) {
      return GrpcStreamType.CLIENT_STREAMING;
    } else if (isActuallyWritableStream) {
      return GrpcStreamType.SERVER_STREAMING;
    } else {
      // 默认返回一元调用
      Logger.Warn(`[GRPC_ROUTER] Unable to determine stream type, defaulting to UNARY`);
      return GrpcStreamType.UNARY;
    }
  }

  /**
   * 处理一元调用 (Unary RPC)
   */
  private async handleUnaryCall(
    call: IRpcServerCall<any, any>, 
    callback: IRpcServerCallback<any>,
    app: Koatty,
    ctlItem: any
  ): Promise<void> {
    try {
      Logger.Debug(`[GRPC_ROUTER] Handling unary call for ${ctlItem.name}.${ctlItem.method}`);
      
      // 创建 gRPC context (context 已经由 koatty_serve 在调用 handler 之前创建好了)
      // 这里的 call 和 callback 已经被包装在 context 中
      // 直接从 call 中获取 context，或者使用 app.createContext
      const ctx = app.createContext(call, callback, 'grpc');
      
      Logger.Debug(`[GRPC_ROUTER] Context created, getting controller instance`);
      const ctl = IOC.getInsByClass(ctlItem.ctl, [ctx]);
      
      Logger.Debug(`[GRPC_ROUTER] Calling Handler for ${ctlItem.method}`);
      const result = await Handler(app, ctx, ctl, ctlItem.method, ctlItem.params, undefined, ctlItem.composedMiddleware);
      
      // Handler 执行完成后，调用 gRPC callback 返回结果
      const response = result || ctx.body;
      Logger.Debug(`[GRPC_ROUTER] gRPC method ${ctlItem.name}.${ctlItem.method} completed, calling callback with response:`, response);
      callback(null, response);
      
    } catch (error) {
      Logger.Error(`[GRPC_ROUTER] Error executing gRPC method ${ctlItem.name}.${ctlItem.method}:`, error);
      callback(error as Error);
    }
  }

  /**
   * 处理服务器流 (Server Streaming RPC)
   */
  private async handleServerStreaming(
    call: ServerWritableStream<any, any>,
    app: Koatty,
    ctlItem: any
  ): Promise<void> {
    const streamId = `server_${Date.now()}_${Math.random()}`;
    this.streamManager.registerStream(streamId, GrpcStreamType.SERVER_STREAMING);
    
    try {
      Logger.Debug(`[GRPC_ROUTER] Handling server streaming call for ${ctlItem.name}.${ctlItem.method}`);
      
      // 设置流超时
      const timeout = setTimeout(() => {
        Logger.Warn(`[GRPC_ROUTER] Server stream ${streamId} timeout`);
        call.end();
        this.streamManager.removeStream(streamId);
      }, this.options.streamConfig?.streamTimeout || 300000);

      // 处理流结束
      call.on('cancelled', () => {
        Logger.Debug(`[GRPC_ROUTER] Server stream ${streamId} cancelled`);
        clearTimeout(timeout);
        this.streamManager.removeStream(streamId);
      });

      call.on('error', (error) => {
        Logger.Error(`[GRPC_ROUTER] Server stream ${streamId} error:`, error);
        clearTimeout(timeout);
        this.streamManager.removeStream(streamId);
      });

      // 直接创建 context，不再调用 app.callback
      const ctx = app.createContext(call, null, 'grpc');
      
      // 添加流写入方法到上下文
      ctx.writeStream = (data: any) => {
        if (this.streamManager.isBackpressureTriggered(streamId)) {
          Logger.Warn(`[GRPC_ROUTER] Backpressure triggered for stream ${streamId}`);
          return false;
        }
        
        call.write(data);
        const currentState = this.streamManager.getStreamState(streamId);
        if (currentState) {
          currentState.messageCount++;
        }
        return true;
      };
      
      ctx.endStream = () => {
        call.end();
        clearTimeout(timeout);
        this.streamManager.removeStream(streamId);
      };

      // 获取控制器实例并执行
      const ctl = IOC.getInsByClass(ctlItem.ctl, [ctx]);
      await Handler(app, ctx, ctl, ctlItem.method, ctlItem.params, undefined, ctlItem.composedMiddleware);
      
    } catch (error) {
      Logger.Error(`[GRPC_ROUTER] Error in server streaming: ${error}`);
      call.end();
      this.streamManager.removeStream(streamId);
    }
  }

  /**
   * 处理客户端流 (Client Streaming RPC)
   */
  private handleClientStreaming(
    call: ServerReadableStream<any, any>,
    callback: IRpcServerCallback<any>,
    app: Koatty,
    ctlItem: any
  ): void {
    const streamId = `client_${Date.now()}_${Math.random()}`;
    this.streamManager.registerStream(streamId, GrpcStreamType.CLIENT_STREAMING);
    const messages: any[] = [];
    
    try {
      Logger.Debug(`[GRPC_ROUTER] Handling client streaming call for ${ctlItem.name}.${ctlItem.method}`);
      
      // 设置流超时
      const timeout = setTimeout(() => {
        Logger.Warn(`[GRPC_ROUTER] Client stream ${streamId} timeout`);
        callback(new Error('Stream timeout'));
        this.streamManager.removeStream(streamId);
      }, this.options.streamConfig?.streamTimeout || 300000);

      // 处理数据接收
      call.on('data', (data: any) => {
        messages.push(data);
        const currentState = this.streamManager.getStreamState(streamId);
        if (currentState) {
          currentState.messageCount++;
          currentState.bufferSize += (Buffer.isBuffer(data) ? data.length : Buffer.byteLength(JSON.stringify(data)));
        }
        
        // 检查背压
        if (this.streamManager.isBackpressureTriggered(streamId)) {
          Logger.Warn(`[GRPC_ROUTER] Backpressure triggered for client stream ${streamId}`);
          call.pause();
          setTimeout(() => call.resume(), 100);
        }
      });

      // 处理流结束
      call.on('end', async () => {
        clearTimeout(timeout);
        Logger.Debug(`[GRPC_ROUTER] Client stream ${streamId} ended with ${messages.length} messages`);
        
        try {
          // 直接创建 context，不再调用 app.callback
          const ctx = app.createContext(call, callback, 'grpc');
          ctx.streamMessages = messages;
          
          // 获取控制器实例并执行
          const ctl = IOC.getInsByClass(ctlItem.ctl, [ctx]);
          const result = await Handler(app, ctx, ctl, ctlItem.method, ctlItem.params, undefined, ctlItem.composedMiddleware);
          
          // 调用 callback 返回结果
          const response = result || ctx.body;
          callback(null, response);
          
          this.streamManager.removeStream(streamId);
        } catch (error) {
          Logger.Error(`[GRPC_ROUTER] Error processing client stream: ${error}`);
          callback(error as Error);
          this.streamManager.removeStream(streamId);
        }
      });

      call.on('error', (error) => {
        Logger.Error(`[GRPC_ROUTER] Client stream ${streamId} error:`, error);
        clearTimeout(timeout);
        callback(error);
        this.streamManager.removeStream(streamId);
      });

      call.on('cancelled', () => {
        Logger.Debug(`[GRPC_ROUTER] Client stream ${streamId} cancelled`);
        clearTimeout(timeout);
        this.streamManager.removeStream(streamId);
      });
      
    } catch (error) {
      Logger.Error(`[GRPC_ROUTER] Error in client streaming: ${error}`);
      callback(error as Error);
      this.streamManager.removeStream(streamId);
    }
  }

  /**
   * 处理双向流 (Bidirectional Streaming RPC)
   */
  private handleBidirectionalStreaming(
    call: ServerDuplexStream<any, any>,
    app: Koatty,
    ctlItem: any
  ): void {
    const streamId = `bidi_${Date.now()}_${Math.random()}`;
    this.streamManager.registerStream(streamId, GrpcStreamType.BIDIRECTIONAL_STREAMING);
    
    try {
      Logger.Debug(`[GRPC_ROUTER] Handling bidirectional streaming call for ${ctlItem.name}.${ctlItem.method}`);
      
      // 设置流超时
      const timeout = setTimeout(() => {
        Logger.Warn(`[GRPC_ROUTER] Bidirectional stream ${streamId} timeout`);
        call.end();
        this.streamManager.removeStream(streamId);
      }, this.options.streamConfig?.streamTimeout || 300000);

      // 处理数据接收
      call.on('data', async (data: any) => {
        const currentState = this.streamManager.getStreamState(streamId);
        if (currentState) {
          currentState.messageCount++;
          currentState.bufferSize += (Buffer.isBuffer(data) ? data.length : Buffer.byteLength(JSON.stringify(data)));
        }
        
        // 检查背压
        if (this.streamManager.isBackpressureTriggered(streamId)) {
          Logger.Warn(`[GRPC_ROUTER] Backpressure triggered for bidirectional stream ${streamId}`);
          call.pause();
          setTimeout(() => call.resume(), 100);
        }

        try {
          // 直接创建 context，不再调用 app.callback
          const ctx = app.createContext(call, null, 'grpc');
          ctx.streamMessage = data;
          
          // 添加流写入方法到上下文
          ctx.writeStream = (responseData: any) => {
            if (this.streamManager.isBackpressureTriggered(streamId)) {
              Logger.Warn(`[GRPC_ROUTER] Write backpressure triggered for stream ${streamId}`);
              return false;
            }
            call.write(responseData);
            return true;
          };
          
          ctx.endStream = () => {
            call.end();
            clearTimeout(timeout);
            this.streamManager.removeStream(streamId);
          };

          // 获取控制器实例并执行
          const ctl = IOC.getInsByClass(ctlItem.ctl, [ctx]);
          await Handler(app, ctx, ctl, ctlItem.method, ctlItem.params, undefined, ctlItem.composedMiddleware);
        } catch (error) {
          Logger.Error(`[GRPC_ROUTER] Error processing bidirectional stream message: ${error}`);
        }
      });

      // 处理流结束
      call.on('end', () => {
        Logger.Debug(`[GRPC_ROUTER] Bidirectional stream ${streamId} ended`);
        clearTimeout(timeout);
        call.end();
        this.streamManager.removeStream(streamId);
      });

      call.on('error', (error) => {
        Logger.Error(`[GRPC_ROUTER] Bidirectional stream ${streamId} error:`, error);
        clearTimeout(timeout);
        call.end();
        this.streamManager.removeStream(streamId);
      });

      call.on('cancelled', () => {
        Logger.Debug(`[GRPC_ROUTER] Bidirectional stream ${streamId} cancelled`);
        clearTimeout(timeout);
        this.streamManager.removeStream(streamId);
      });
      
    } catch (error) {
      Logger.Error(`[GRPC_ROUTER] Error in bidirectional streaming: ${error}`);
      call.end();
      this.streamManager.removeStream(streamId);
    }
  }

  /**
   * 统一的流处理入口
   */
  private handleStreamCall(
    call: IRpcServerCall<any, any>, 
    callback: IRpcServerCallback<any>,
    app: Koatty,
    ctlItem: any
  ): void {
    Logger.Debug(`[GRPC_ROUTER] handleStreamCall called for ${ctlItem.name}.${ctlItem.method}`);
    
    // 检测流类型
    const streamType = this.detectStreamType(call);
    Logger.Debug(`[GRPC_ROUTER] Detected stream type: ${streamType}`);
    
    // 检查并发流限制（只对真正的流调用进行限制）
    if (streamType !== GrpcStreamType.UNARY && 
        this.streamManager.getActiveStreamCount() >= (this.options.streamConfig?.maxConcurrentStreams || 100)) {
      Logger.Warn('[GRPC_ROUTER] Maximum concurrent streams reached');
      if (callback) {
        callback(new Error('Server busy'));
      } else {
        (call as any).end();
      }
      return;
    }

    Logger.Debug(`[GRPC_ROUTER] Processing stream type: ${streamType} for ${ctlItem.name}.${ctlItem.method}`);

    switch (streamType) {
      case GrpcStreamType.UNARY:
        Logger.Debug(`[GRPC_ROUTER] Calling handleUnaryCall for ${ctlItem.name}.${ctlItem.method}`);
        this.handleUnaryCall(call, callback, app, ctlItem);
        break;
      case GrpcStreamType.SERVER_STREAMING:
        this.handleServerStreaming(call as ServerWritableStream<any, any>, app, ctlItem);
        break;
      case GrpcStreamType.CLIENT_STREAMING:
        this.handleClientStreaming(call as ServerReadableStream<any, any>, callback, app, ctlItem);
        break;
      case GrpcStreamType.BIDIRECTIONAL_STREAMING:
        this.handleBidirectionalStreaming(call as ServerDuplexStream<any, any>, app, ctlItem);
        break;
      default:
        Logger.Error(`Unknown stream type: ${streamType}`);
        (call as any).end();
    }
  }

  /**
   * LoadRouter
   *
   * @memberof Router
   */
  async LoadRouter(app: Koatty, list: any[]) {
    try {
      const pdef = LoadProto(this.options.protoFile);
      
      const services = ListServices(pdef);
      
      const ctls: CtlInterface = {};

      for (const n of list) {
        Logger.Debug(`[GRPC_ROUTER] Processing controller: ${n}`);
        const ctlClass = IOC.getClass(n, "CONTROLLER");
        const ctlRouters = await injectRouter(app, ctlClass, this.options.protocol);
        Logger.Debug(`[GRPC_ROUTER] Controller ${n} routers:`, ctlRouters ? Object.keys(ctlRouters).length : 0);
        if (!ctlRouters) continue;

        // 传递 protoFile 给 payload 解析器，用于可能的自动解码
        const ctlParams = injectParamMetaData(app, ctlClass, {
          ...this.options.payload,
          protoFile: this.options.protoFile
        });
        for (const router of Object.values(ctlRouters)) {
          ctls[router.path] = {
            name: n,
            ctl: ctlClass,
            method: router.method,
            params: ctlParams[router.method],
            composedMiddleware: router.composedMiddleware
          };
          Logger.Debug(`[GRPC_ROUTER] Registered controller route: "${router.path}" => ${n}.${router.method}`);
        }
      }


      for (const si of services) {        
        if (!si.service || si.handlers.length === 0) {
          Logger.Warn(`[GRPC_ROUTER] Ignore ${si.name} which is an empty service`);
          continue;
        }

        Logger.Debug(`[GRPC_ROUTER] Processing gRPC service: ${si.name} with ${si.handlers.length} handlers`);

        // Register placeholder implementations for gRPC service
        // These are just shells - the actual routing is handled by middleware
        const impl: Record<string, UntypedHandleCall> = {};
        for (const handler of si.handlers) {
          const path = parsePath(handler.path);
          Logger.Debug(`[GRPC_ROUTER] Looking for handler: "${handler.path}" (parsed: "${path}") => handler name: "${handler.name}"`);
          const ctlItem = ctls[path];
          if (!ctlItem) {
            Logger.Warn(`[GRPC_ROUTER] ❌ No matching controller route found for gRPC handler "${handler.path}" (parsed: "${path}")`);
            continue;
          }

          Logger.Debug(`[GRPC_ROUTER] ✅ Register request mapping: ["${path}" => ${ctlItem.name}.${ctlItem.method}]`);
          
          // Register a placeholder handler
          // This handler will never be called because koatty_serve will call app.callback instead
          // But we still need to register it so grpc server knows this method exists
          impl[handler.name] = (call: IRpcServerCall<any, any>, callback: IRpcServerCallback<any>) => {
            const methodPath = `${si.name}/${handler.name}`;
            Logger.Warn(`[GRPC_ROUTER] Placeholder handler invoked for ${methodPath}. No controller matched this gRPC method.`);
            callback({
              code: 12, // UNIMPLEMENTED
              message: `Method ${methodPath} not implemented. Ensure a controller with @GrpcMethod('${handler.name}') is registered.`
            } as any);
          };
        }
        
        // only register service when impl is not empty
        if (Object.keys(impl).length > 0) {
          this.SetRouter(si.name, { service: si.service, implementation: impl });
          
          // Handle both single server and multi-protocol server
          const server = app.server as any;

          let grpcServer = null;
          
          // Check if server is an array (multi-protocol mode)
          if (Helper.isArray(server)) {
            // Multi-protocol server: find gRPC server instance in array
            for (const s of server) {
              const protocol = s.options?.protocol || s.protocol;
              if (protocol === 'grpc' && Helper.isFunction(s.RegisterService)) {
                grpcServer = s;
                break;
              }
            }
          } else if (Helper.isFunction(server.getAllServers)) {
            // Alternative multi-protocol structure with getAllServers method
            const allServers = server.getAllServers();
            if (allServers && allServers.size > 0) {
              allServers.forEach((s: any) => {
                const protocol = Helper.isString(s.options?.protocol) ? s.options.protocol : 
                               (Helper.isArray(s.options?.protocol) ? s.options.protocol[0] : '');
                if (protocol === 'grpc' && Helper.isFunction(s.RegisterService)) {
                  grpcServer = s;
                }
              });
            }
          } else if (Helper.isFunction(server.RegisterService)) {
            // Single protocol gRPC server
            grpcServer = server;
          }
          
          // Register service to gRPC server
          if (grpcServer) {
            grpcServer.RegisterService({ service: si.service, implementation: impl });
          } else {
            Logger.Error(`[GRPC_ROUTER] ❌ Failed to find gRPC server instance for service registration: ${si.name}`);
          }
        } else {
          Logger.Warn(`[GRPC_ROUTER] Skip registering service ${si.name}: no matching controller handlers found`);
        }
      }
      
      // Register gRPC router middleware to app
      // Similar to HTTP router, this middleware handles routing for gRPC protocol
      
      app.use(async (ctx: KoattyContext, next: any) => {
        // Only handle gRPC protocol
        if (ctx.protocol !== 'grpc') {
          await next();
          return;
        }
        
        Logger.Debug('[GRPC_ROUTER] gRPC router middleware executing', {
          protocol: ctx.protocol,
          rpc: ctx.rpc
        });
        
        // Get method path from ctx.rpc (call object)
        // The call object should have a path property like "/Hello/SayHello"
        const methodPath = (ctx.rpc as any)?.path || (ctx.rpc as any)?.call?.path;
        
        if (!methodPath) {
          Logger.Error('[GRPC_ROUTER] No method path found in ctx.rpc');
          throw new Error('gRPC method path not found');
        }
        
        Logger.Debug(`[GRPC_ROUTER] Looking up controller for method: ${methodPath}`);
        
        // Find matching controller
        const ctlItem = ctls[methodPath];
        if (!ctlItem) {
          Logger.Error(`[GRPC_ROUTER] No controller found for method: ${methodPath}`);
          throw new Error(`gRPC method not implemented: ${methodPath}`);
        }
        
        Logger.Debug(`[GRPC_ROUTER] Found controller: ${ctlItem.name}.${ctlItem.method}`);
        
        // Execute controller
        const ctl = IOC.getInsByClass(ctlItem.ctl, [ctx]);
        const result = await Handler(app, ctx, ctl, ctlItem.method, ctlItem.params, undefined, ctlItem.composedMiddleware);
        
        // Set result to ctx.body
        ctx.body = result;
        
        Logger.Debug('[GRPC_ROUTER] Controller execution completed', {
          method: methodPath,
          hasResult: !!result
        });
      });
      
      
      // Protocol Isolation Note:
      // gRPC router now works through Koa middleware chain, just like HTTP router
      // The gRPC server calls app.callback("grpc") which executes this middleware
      Logger.Debug('gRPC router middleware registered (integrated with middleware chain)');
    } catch (err) {
      Logger.Error(err);
    }
  }

  /**
   * Cleanup all gRPC resources (for graceful shutdown)
   */
  public cleanup(): void {
    Logger.Info('Starting gRPC router cleanup...');

    // Close all active streams
    this.streamManager.closeAllStreams();

    Logger.Info('gRPC router cleanup completed');
  }
}
