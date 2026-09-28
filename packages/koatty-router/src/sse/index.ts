/** SSE output for ordinary routes. No additional decorator or component model. */
import { Readable } from 'stream';

export interface SSEEvent {
  event?: string;
  data?: unknown;
  id?: string;
  retry?: number;
  comment?: string;
}
export interface SSEOptions {
  heartbeatInterval?: number;
  headers?: Record<string, string>;
  onClose?: () => void;
}
export type SSESource<T = unknown> = AsyncIterable<T> | ReadableStream<T> | Readable;

export function encodeSSE(event: SSEEvent): string {
  const lines: string[] = [];
  for (const field of ['id', 'event'] as const) {
    if (event[field] !== undefined) {
      const value = String(event[field]);
      if (/[\r\n\0]/.test(value)) throw new Error(`Invalid SSE ${field}`);
      lines.push(`${field}: ${value}`);
    }
  }
  if (event.retry !== undefined) {
    if (!Number.isSafeInteger(event.retry) || event.retry < 0) throw new Error('Invalid SSE retry');
    lines.push(`retry: ${event.retry}`);
  }
  if (event.comment !== undefined) for (const line of String(event.comment).split(/\r\n|\r|\n/)) lines.push(`: ${line}`);
  if (event.data !== undefined) {
    const value = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
    if (value !== undefined) for (const line of value.split(/\r\n|\r|\n/)) lines.push(`data: ${line}`);
  }
  return `${lines.join('\n')}\n\n`;
}

function toEvent(value: any): SSEEvent {
  if (Buffer.isBuffer(value)) return { data: value.toString('utf8') };
  if (value && typeof value === 'object' && ['data','event','id','retry','comment'].some(key => key in value)) return value;
  return { data: value };
}

/**
 * Stream with backpressure. Prefer a factory so the producer receives the abort
 * signal before starting work. Arbitrary producers must cooperate with cancellation.
 */
export async function streamSSE<T>(ctx: any,
  source: SSESource<T> | ((signal: AbortSignal) => SSESource<T> | Promise<SSESource<T>>),
  options: SSEOptions = {}): Promise<number> {
  const res = ctx?.res;
  if (!res || typeof res.write !== 'function') throw new Error('streamSSE requires a writable response');
  const abort = new AbortController();
  const stopped = Symbol('stopped');
  let finishAbort!: (value: typeof stopped) => void;
  const cancelled = new Promise<typeof stopped>(resolve => { finishAbort = resolve; });
  let cancelSource: (() => void) | undefined;
  const close = () => {
    if (abort.signal.aborted) return;
    abort.abort(); finishAbort(stopped); cancelSource?.();
    try { options.onClose?.(); } catch { /* cleanup must continue */ }
  };
  res.once?.('close', close);
  res.once?.('error', close);
  ctx.req?.once?.('aborted', close);
  let heartbeat: NodeJS.Timeout | undefined;
  let blocked = false;
  const drained = () => { blocked = false; };
  res.on?.('drain', drained);
  let iterator: AsyncIterator<any> | undefined;
  let written = 0;
  try {
    if (res.destroyed || ctx.req?.aborted) { close(); return 0; }
    const produced = Promise.resolve(typeof source === 'function' ? source(abort.signal) : source);
    // A factory can settle after disconnect; release that late result too.
    void produced.then(async value => {
      if (!abort.signal.aborted || iterator) return;
      if (value instanceof Readable) value.destroy();
      else if (typeof (value as ReadableStream<T>)?.cancel === 'function') await (value as ReadableStream<T>).cancel();
      else await (value as AsyncIterable<T>)?.[Symbol.asyncIterator]?.().return?.();
    }).catch((): void => undefined);
    const resolved = await Promise.race([produced, cancelled]);
    if (resolved === stopped) return 0;
    if (resolved && typeof (resolved as ReadableStream<T>).getReader === 'function') {
      const reader = (resolved as ReadableStream<T>).getReader();
      iterator = { next: () => reader.read() as any, return: async () => { await reader.cancel(); reader.releaseLock(); return { done: true, value: undefined }; } };
      cancelSource = () => { void reader.cancel().catch((): void => undefined); };
    } else if (resolved && typeof (resolved as AsyncIterable<T>)[Symbol.asyncIterator] === 'function') {
      iterator = (resolved as AsyncIterable<T>)[Symbol.asyncIterator]();
      cancelSource = () => {
        if (resolved instanceof Readable) resolved.destroy();
        void Promise.resolve().then(() => iterator?.return?.()).catch((): void => undefined);
      };
    } else throw new Error('SSE source must be an AsyncIterable, ReadableStream or Node Readable');
    if (abort.signal.aborted) { cancelSource(); return 0; }
    res.statusCode = 200;
    for (const [key, value] of Object.entries({ ...options.headers,
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' })) res.setHeader?.(key, value);
    ctx.respond = false;
    res.flushHeaders?.();
    const interval = options.heartbeatInterval ?? 15000;
    if (interval > 0) {
      heartbeat = setInterval(() => {
        if (!blocked && !abort.signal.aborted) {
          try { blocked = res.write(encodeSSE({ comment: 'heartbeat' })) === false; } catch { close(); }
        }
      }, interval);
      heartbeat.unref?.();
    }
    const waitDrain = async () => {
      if (!blocked || abort.signal.aborted) return;
      let drain!: () => void;
      const ready = new Promise<void>(resolve => { drain = resolve; res.once?.('drain', drain); });
      try { await Promise.race([ready, cancelled]); } finally { res.removeListener?.('drain', drain); }
    };
    for (;;) {
      await waitDrain();
      if (abort.signal.aborted) break;
      const item = await Promise.race([iterator!.next(), cancelled]);
      if (item === stopped || item.done || abort.signal.aborted) break;
      // A heartbeat may have filled the buffer while next() was pending.
      await waitDrain();
      if (abort.signal.aborted) break;
      blocked = res.write(encodeSSE(toEvent(item.value))) === false;
      written++;
    }
    await waitDrain();
    return written;
  } catch (error) {
    if (!abort.signal.aborted) throw error;
    return written;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    res.removeListener?.('close', close); res.removeListener?.('error', close); res.removeListener?.('drain', drained);
    ctx.req?.removeListener?.('aborted', close);
    // Never hold request teardown hostage to a non-cooperative pending next().
    if (iterator?.return) void Promise.resolve().then(() => iterator!.return!()).catch((): void => undefined);
    if (ctx.respond === false && !abort.signal.aborted && !res.destroyed) res.end();
  }
}
