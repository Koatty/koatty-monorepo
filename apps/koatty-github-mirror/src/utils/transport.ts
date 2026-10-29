import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ipaddr from 'ipaddr.js';
import { MirrorError } from './MirrorError';

export interface UpstreamOptions {
  method: string; headers: Record<string, string>; body?: Buffer | Readable;
  signal: AbortSignal; headerTimeoutMs: number; idleTimeoutMs: number;
}
export type Transport = (url: URL, options: UpstreamOptions) => Promise<IncomingMessage>;
export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export const safeTransport: Transport = async (url, options) => {
  // Resolve once and pin that checked address to the TLS connection (no DNS rebinding).
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new MirrorError(502, 'UNSAFE_ADDRESS', '上游 DNS 返回了非公网地址。');
  }
  options.signal.throwIfAborted();
  const address = addresses.find(item => item.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    let received = false;
    const req = request(url, {
      method: options.method, headers: options.headers, signal: options.signal,
      agent: false, family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      // URL hostname is retained for Host, TLS SNI and certificate verification.
    }, response => { received = true; clearTimeout(timer); resolve(response); });
    let timer = setTimeout(() => req.destroy(new MirrorError(504, 'UPSTREAM_TIMEOUT', '上游响应超时。')), options.headerTimeoutMs);
    timer.unref();
    req.setTimeout(options.idleTimeoutMs, () => req.destroy(new MirrorError(504, 'UPSTREAM_TIMEOUT', '上游传输超时。')));
    req.once('error', error => { clearTimeout(timer); reject(error); });
    req.once('close', () => clearTimeout(timer));
    if (options.body instanceof Readable) {
      // A push can upload longer than headerTimeoutMs. Bound connection setup,
      // then start the response-header deadline only after the upload finishes.
      req.once('socket', socket => socket.once('secureConnect', () => clearTimeout(timer)));
      req.once('finish', () => {
        clearTimeout(timer);
        if (received) return;
        timer = setTimeout(() => req.destroy(new MirrorError(504, 'UPSTREAM_TIMEOUT', '上游响应超时。')), options.headerTimeoutMs);
        timer.unref();
      });
      void pipeline(options.body, req, { signal: options.signal }).catch(error => { clearTimeout(timer); reject(error); });
    } else req.end(options.body);
  });
};
