import { BaseHandler, Handler, buildRequestLogData } from './base';
import { KoattyContext } from 'koatty_core';
import { StatusCodeConvert } from 'koatty_exception';
import { extensionOptions } from '../trace/itrace';

/** gRPC completion follows the RPC shape, never the shape of Node's stream object. */
export class GrpcHandler extends BaseHandler implements Handler {
  private static instance: GrpcHandler;
  private constructor() { super(); }
  public static getInstance(): GrpcHandler {
    return GrpcHandler.instance ?? (GrpcHandler.instance = new GrpcHandler());
  }

  async handle(ctx: KoattyContext, next: Function, ext: extensionOptions): Promise<any> {
    const call: any = ctx.rpc.call;
    const streaming = call.koattyMethodKind === 'server_stream' || call.koattyMethodKind === 'bidi_stream'
      || typeof ctx.rpc.callback !== 'function';
    const deadline = typeof call.getDeadline === 'function' ? Number(call.getDeadline()) : Infinity;
    const remaining = Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : call.koattyDeadlineMs;
    const timeout = typeof remaining === 'number' ? remaining : (streaming ? undefined : (ext?.timeout || 10000));
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    let finish!: () => void;
    let fail!: (error: any) => void;
    const terminal = new Promise<void>((resolve, reject) => {
      finish = () => { if (!settled) { settled = true; resolve(); } };
      fail = (error) => { if (!settled) { settled = true; reject(error); } };
    });
    const cancelled = () => {
      const expired = Number.isFinite(deadline) && Date.now() >= deadline;
      fail(Object.assign(new Error(expired ? 'Deadline exceeded' : 'RPC cancelled'), { code: expired ? 4 : 1 }));
    };
    const closed = () => call.cancelled ? cancelled() : finish();
    call.once?.('cancelled', cancelled);
    call.once?.('error', fail);
    if (streaming) {
      call.once?.('finish', finish);
      call.once?.('close', closed);
    }
    if (timeout !== undefined) timer = setTimeout(() => fail(Object.assign(new Error('Deadline exceeded'), { code: 4 })), timeout);

    try {
      this.commonPreHandle(ctx, ext);
      const business = Promise.resolve().then(() => next()).then(() => {
        this.checkAndSetStatus(ctx);
        if (!streaming) finish();
      });
      // A stream middleware may return immediately after installing data/end listeners.
      // Keep Trace alive until finish/error/cancellation, not middleware return.
      business.catch(fail);
      await terminal;
      if (!streaming && !call.cancelled) ctx.rpc.callback(null, ctx.body);
      return null;
    } catch (error: any) {
      ext.terminated = true;
      const code = !error?.status && Number.isInteger(error?.code) && error.code >= 0 && error.code <= 16
        ? error.code : StatusCodeConvert(error?.status || 500);
      ctx.status = code === 4 ? 504 : code === 1 ? 499 : (error?.status || 500);
      if (!streaming && !call.cancelled && ext.globalErrorHandler && code !== 4 && code !== 1) {
        return this.handleError(error, ctx, ext);
      }
      const rpcError = Object.assign(new Error(code === 13 ? 'Internal Server Error' : error.message), { code });
      if (!call.cancelled) {
        if (streaming) call.destroy?.(rpcError);
        else ctx.rpc.callback(rpcError, null);
      }
      return null;
    } finally {
      if (timer) clearTimeout(timer);
      call.removeListener?.('cancelled', cancelled);
      call.removeListener?.('finish', finish);
      call.removeListener?.('close', closed);
      // Preserve an error listener until destroy's asynchronous error delivery.
      if (!streaming || !call.destroyed) call.removeListener?.('error', fail);
      this.commonPostHandle(ctx, ext, buildRequestLogData(ctx, StatusCodeConvert(ctx.status)));
    }
  }
}
