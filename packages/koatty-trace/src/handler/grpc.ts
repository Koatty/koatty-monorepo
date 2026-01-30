/**
 * 
 * @Description: 
 * @Author: richen
 * @Date: 2025-03-21 22:07:11
 * @LastEditTime: 2025-03-23 11:41:02
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */
import { BaseHandler, Handler } from './base';
import { Transform, Stream } from 'stream';
import * as zlib from 'zlib';
import { IRpcServerCallImpl, KoattyContext } from "koatty_core";
import { Exception, StatusCodeConvert } from "koatty_exception";
import { DefaultLogger as Logger } from "koatty_logger";
import { Span } from '@opentelemetry/api';
import { SemanticAttributes } from '@opentelemetry/semantic-conventions';
import { catcher } from '../trace/catcher';
import { extensionOptions } from '../trace/itrace';
import { collectRequestMetrics } from '../opentelemetry/prometheus';


/**
 * gRPC request handler middleware for Koatty framework.
 * Handles gRPC requests with tracing, timeout, error handling and logging capabilities.
 * 
 * @param {KoattyContext} ctx - The Koatty context object
 * @param {Function} next - The next middleware function
 * @param {extensionOptions} [ext] - Extension options including timeout, encoding, span and error handler
 * @returns {Promise<any>} Returns null on success or error result from catcher
 * 
 * @throws {Exception} When response status is >= 400
 * @throws {Error} When request timeout exceeded
 */
export class GrpcHandler extends BaseHandler implements Handler {
  private static instance: GrpcHandler;

  private constructor() {
    super();
  }

  public static getInstance(): GrpcHandler {
    if (!GrpcHandler.instance) {
      GrpcHandler.instance = new GrpcHandler();
    }
    return GrpcHandler.instance;
  }

  async handle(ctx: KoattyContext, next: Function, ext?: extensionOptions): Promise<any> {
    const timeout = ext.timeout || 10000;
    const acceptEncoding = ctx.rpc.call.metadata.get('accept-encoding')[0] || '';
    const compression = acceptEncoding.includes('br') ? 'brotli' : 
                      acceptEncoding.includes('gzip') ? 'gzip' : 'none';
    let error: any = null;

    ctx?.rpc?.call?.sendMetadata(ctx.rpc.call.metadata);

    this.commonPreHandle(ctx, ext);

    // 监听 gRPC call 的错误事件
    (<IRpcServerCallImpl<any, any>>ctx?.rpc?.call).once("error", (err) => {
      error = err;
      this.handleError(err, ctx, ext);
    });

    try {
      // 使用基类的通用超时处理方法
      await this.handleWithTimeout(ctx, next, ext, timeout);

      // 使用基类的通用状态检查方法
      this.checkAndSetStatus(ctx);

      // 安全的流压缩处理
      if (compression !== 'none' && ctx.body instanceof Stream) {
        try {
          const compressStream = compression === 'gzip' ? 
            zlib.createGzip({ level: 6 }) : zlib.createBrotliCompress({
              params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 4
              }
            });
          
          // 监听压缩流的错误
          compressStream.once('error', (compressErr) => {
            Logger.Error('gRPC compression stream error:', compressErr);
            // 如果压缩失败,使用原始body
            ctx.body = ctx.body;
          });
          
          // 监听源流的错误
          (ctx.body as Stream).once('error', (streamErr) => {
            Logger.Error('gRPC source stream error:', streamErr);
            compressStream.destroy();
          });
          
          ctx.body = (ctx.body as Stream).pipe(compressStream);
        } catch (pipeErr) {
          Logger.Error('gRPC stream pipe error:', pipeErr);
          // 如果pipe失败,继续使用原始body
        }
      }
      
      // 安全的gRPC回调
      try {
        ctx.rpc.callback(null, ctx.body);
      } catch (callbackErr) {
        Logger.Error('gRPC callback error:', callbackErr);
        // 尝试发送错误响应
        try {
          ctx.rpc.callback(callbackErr, null);
        } catch (fallbackErr) {
          Logger.Error('gRPC fallback callback error:', fallbackErr);
        }
      }
      
      return null;
    } catch (err: any) {
      error = err;
      return this.handleError(err, ctx, ext);
    } finally {
      // 统一在 finally 块中记录日志和结束追踪
      // 只记录成功请求或非4xx/5xx的日志（错误日志已由Exception.handler记录）
      if (!error || ctx.status < 400) {
        const now = Date.now();
        const status = StatusCodeConvert(ctx.status);
        const msg = `{"action":"${ctx.method}","status":"${status}","startTime":"${ctx.startTime}","duration":"${(now - ctx.startTime) || 0}","requestId":"${ctx.requestId}","endTime":"${now}","path":"${ctx.originalPath}"}`;
        this.commonPostHandle(ctx, ext, msg);
      } else {
        // 错误情况只处理追踪和指标，日志已经记录过了
        this.endTraceSpanOnly(ctx, ext);
        this.collectMetricsOnly(ctx, ext);
      }
      
      // 确保 finish 事件被触发（用于清理资源）
      ctx.res.emit("finish");
    }
  }

  /**
   * 只结束追踪span，不记录日志
   */
  private endTraceSpanOnly(ctx: KoattyContext, ext: extensionOptions) {
    if (ext.spanManager) {
      const now = Date.now();
      const status = StatusCodeConvert(ctx.status);
      const msg = `{"action":"${ctx.method}","status":"${status}","startTime":"${ctx.startTime}","duration":"${(now - ctx.startTime) || 0}","requestId":"${ctx.requestId}","endTime":"${now}","path":"${ctx.originalPath}"}`;
      
      // 设置span属性
      ext.spanManager.setSpanAttributes(ctx, {
        [SemanticAttributes.HTTP_STATUS_CODE]: ctx.status,
        [SemanticAttributes.HTTP_METHOD]: ctx.method,
        [SemanticAttributes.HTTP_URL]: ctx.url
      });
      ext.spanManager.addSpanEvent(ctx, "request", { "message": msg });
      ext.spanManager.endSpan(ctx);
    }
  }

  /**
   * 只收集指标，不记录日志
   */
  private collectMetricsOnly(ctx: KoattyContext, ext: extensionOptions) {
    if (ctx.startTime) {
      const duration = Date.now() - ctx.startTime;
      collectRequestMetrics(ctx, duration);
    }
  }
}
