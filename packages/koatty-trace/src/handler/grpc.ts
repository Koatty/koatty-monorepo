/**
 * 
 * @Description: 
 * @Author: richen
 * @Date: 2025-03-21 22:07:11
 * @LastEditTime: 2025-03-23 11:41:02
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */
import { BaseHandler, Handler, buildRequestLogData } from './base';
import { Transform, Stream } from 'stream';
import * as zlib from 'zlib';
import { IRpcServerCallImpl, KoattyContext } from "koatty_core";
import { Exception, StatusCodeConvert } from "koatty_exception";
import { DefaultLogger as Logger } from "koatty_logger";
import { catcher } from '../trace/catcher';
import { extensionOptions } from '../trace/itrace';


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
    // COR-04 (C-2): prefer the gRPC deadline forwarded by koatty-serve
    // (`call.koattyDeadlineMs`, derived from `call.getDeadline()`) over the
    // framework-level fixed timeout, so a client deadline is honoured exactly.
    const callDeadline = (ctx?.rpc?.call as any)?.koattyDeadlineMs;
    const timeout = typeof callDeadline === 'number' && callDeadline > 0
      ? Math.max(Math.min(callDeadline, ext.timeout || callDeadline), 1)
      : (ext.timeout || 10000);
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
      // COR-15: span end + metrics happen exactly once in
      // `trace.ts#handleRequest`'s finally; only the access log is written here.
      if (!error || ctx.status < 400) {
        const status = StatusCodeConvert(ctx.status);
        this.commonPostHandle(ctx, ext, buildRequestLogData(ctx, status));
      }
      
      // 确保 finish 事件被触发（用于清理资源）
      ctx.res.emit("finish");
    }
  }
}
