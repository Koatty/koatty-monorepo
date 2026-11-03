// Anonymous, bounded Smart HTTP probes. Can also run through `node --input-type=module` on stdin.
import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export function packet(text) {
  const data = Buffer.from(text);
  return Buffer.concat([Buffer.from((data.length + 4).toString(16).padStart(4, '0')), data]);
}

export function want(head, shallow) {
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('Invalid advertised HEAD');
  return Buffer.concat([packet(`want ${head} side-band-64k ofs-delta\n`),
    ...(shallow ? [packet('deepen 1\n')] : []), Buffer.from('0000'), packet('done\n')]);
}

// Count Git sideband channel 1 separately: progress messages are not pack throughput.
export class PackCounter {
  pending = Buffer.alloc(0);
  bytes = 0;
  error = false;
  feed(chunk) {
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= 4) {
      const prefix = this.pending.subarray(0, 4).toString();
      if (!/^[a-f0-9]{4}$/i.test(prefix)) throw new Error('Invalid Git packet');
      const size = parseInt(prefix, 16);
      if (size === 0) { this.pending = this.pending.subarray(4); continue; }
      if (size < 4) throw new Error('Invalid Git packet size');
      if (this.pending.length < size) break;
      if (this.pending[4] === 1) this.bytes += size - 5;
      if (this.pending[4] === 3 || this.pending.subarray(4, 8).toString() === 'ERR ') this.error = true;
      this.pending = this.pending.subarray(size);
    }
  }
}

export function probe(url, { body, seconds = 30 } = {}) {
  return new Promise(resolve => {
    const start = performance.now();
    const counter = new PackCounter();
    let bytes = 0, firstByte = null, firstPack = null, status = 0, contentType = '', server = '', via = '';
    let settled = false;
    const chunks = [];
    const finish = outcome => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const total = (performance.now() - start) / 1000;
      resolve({ outcome, status, contentType, server, via, bytes, packBytes: counter.bytes,
        firstByteSeconds: firstByte, firstPackSeconds: firstPack, totalSeconds: total,
        averageKiBps: bytes / 1024 / total,
        packKiBps: firstPack === null ? null : counter.bytes / 1024 / Math.max(0.001, total - firstPack),
        // Only small advertisements are retained; pack data is discarded.
        advertisement: body ? undefined : Buffer.concat(chunks).toString() });
    };
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method: body ? 'POST' : 'GET', agent: false, family: 4,
      headers: { 'user-agent': 'koatty-mirror-throughput/1.0', 'accept-encoding': 'identity',
        ...(body ? { 'content-type': 'application/x-git-upload-pack-request', 'content-length': String(body.length) } : {}) },
    }, res => {
      status = res.statusCode;
      contentType = res.headers['content-type'] || '';
      server = res.headers.server || '';
      via = res.headers.via || '';
      res.on('data', chunk => {
        firstByte ??= (performance.now() - start) / 1000;
        bytes += chunk.length;
        if (body && status === 200 && contentType.startsWith('application/x-git-upload-pack-result')) {
          try { counter.feed(chunk); } catch { finish('invalid-git-packets'); req.destroy(); return; }
          if (counter.bytes > 0) firstPack ??= (performance.now() - start) / 1000;
        } else if (!body && bytes <= 1024 * 1024) chunks.push(chunk);
        if (bytes >= (body ? 256 * 1024 * 1024 : 1024 * 1024)) { finish('byte-limit'); req.destroy(); }
      });
      res.on('end', () => finish(counter.error ? 'git-error' : counter.pending.length ? 'truncated-git-packet' : 'complete'));
      res.on('error', () => finish('response-error'));
    });
    const timer = setTimeout(() => { finish('time-limit'); req.destroy(); }, seconds * 1000);
    req.on('error', () => finish('connection-error'));
    req.end(body);
  });
}

export async function main() {
  const repo = process.env.MIRROR_PERF_REPO || 'richenlin/pipewright';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Use OWNER/REPO without .git or credentials');
  const seconds = Number(process.env.MIRROR_PERF_SECONDS || 30);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) throw new Error('Seconds must be 1..120');
  const shallow = process.env.MIRROR_PERF_SHALLOW === '1';
  const endpoints = [['github', `https://github.com/${repo}.git`]];
  for (const [label, base] of [['application', process.env.MIRROR_ORIGIN_BASE_URL], ['public', process.env.MIRROR_BASE_URL]]) {
    if (!base) continue;
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Base must be an HTTP(S) origin without credentials, query or path');
    endpoints.push([label, `${url.origin}/github.com/${repo}.git`]);
  }
  console.log(JSON.stringify({ probe: 'anonymous Git v0 / HTTP 1.1 / IPv4', shallow, seconds, byteLimitMiB: 256 }));
  let head;
  for (const [label, base] of endpoints) {
    const result = await probe(new URL(`${base}/info/refs?service=git-upload-pack`), { seconds });
    const advertised = result.status === 200 && result.contentType.startsWith('application/x-git-upload-pack-advertisement')
      ? result.advertisement.match(/([a-f0-9]{40}) HEAD\x00/)?.[1] : undefined;
    head ||= advertised;
    delete result.advertisement;
    console.log(JSON.stringify({ label, phase: 'discovery', advertisedHead: advertised, ...result }));
  }
  if (!head) throw new Error('No valid public Git HEAD; check connectivity or repository visibility');
  const body = want(head, shallow);
  for (const [label, base] of endpoints) {
    const result = await probe(new URL(`${base}/git-upload-pack`), { body, seconds });
    console.log(JSON.stringify({ label, phase: 'pack', head, ...result }));
  }
}

if ((!process.argv[1] && import.meta.url.endsWith('/[eval1]')) ||
    (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
