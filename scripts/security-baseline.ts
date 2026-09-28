/** Release security gate: real production-profile HTTP/GraphQL/WS/TLS fixture.
 * Every check is mandatory. External-source admission is a separately labelled
 * component check, not a claim of testing an external network deployment.
 * Run after building the workspace: pnpm security:baseline
 */
import assert from 'assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import http from 'http';
import tls from 'tls';

async function main() {
  if (process.argv.length > 2) throw new Error('This gate uses its own mandatory multi-protocol fixture; run pnpm security:baseline without external URL flags.');
  process.env.NODE_ENV = 'production';
  delete process.env.KOATTY_ENV;
  const { startSecurityFixture } = await import('./fixtures/security-app');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'koatty-security-gate-'));
  const results: { name: string; passed: boolean; detail?: string }[] = [];
  let fixture: Awaited<ReturnType<typeof startSecurityFixture>> | undefined;
  const check = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); results.push({ name, passed: true }); }
    catch (err) { results.push({ name, passed: false, detail: err instanceof Error ? err.message : String(err) }); }
    const r = results[results.length - 1];
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? ': ' + r.detail : ''}`);
  };
  try {
    fixture = await startSecurityFixture(dir);
    const f = fixture;
    const fetchAt = (route: string, init?: RequestInit) => fetch(f.url + route, { ...init, signal: AbortSignal.timeout(5000) });
    const post = (route: string, body: unknown) => fetchAt(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await check('wire: minimal /health and /healthz', async () => {
      for (const route of ['/health', '/healthz']) {
        const r = await fetchAt(route); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: 'ok' });
      }
    });
    await check('wire: valid DTO reaches the real decorated method', async () => {
      const r = await post('/dto', { name: 'alice' }); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { name: 'alice' });
    });
    await check('wire: malformed JSON is 400 without reflection', async () => {
      const r = await fetchAt('/dto', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"audit-secret":' });
      assert.equal(r.status, 400); assert.ok(!(await r.text()).includes('audit-secret'));
    });
    await check('wire: fixed 2MiB request is 413', async () => {
      const body = Buffer.from('x'.repeat(2 * 1024 * 1024));
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(f.url + '/dto', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': body.length }, timeout: 5000 }, res => {
          res.resume(); resolve(res.statusCode || 0);
        });
        req.on('error', reject); req.on('timeout', () => req.destroy(new Error('request timed out'))); req.end(body);
      });
      assert.equal(status, 413);
    });
    await check('wire: strict DTO rejects undeclared fields and missing required fields', async () => {
      for (const body of [{ name: 'alice', admin: true }, {}]) {
        const r = await post('/dto', body); assert.equal(r.status, 400); await r.text();
      }
    });
    await check('wire: invalid and oversized IDs are replaced; valid ID survives', async () => {
      for (const value of ['bad<script>', 'x'.repeat(200), 'valid.request:1']) {
        const r = await fetchAt('/id', { headers: { 'x-request-id': value } }); assert.equal(r.status, 200);
        const id = r.headers.get('x-request-id'); assert.match(id || '', /^[A-Za-z0-9._:-]{1,128}$/);
        assert.deepEqual(await r.json(), { requestId: id });
        if (value === 'valid.request:1') assert.equal(id, value); else assert.notEqual(id, value);
      }
    });
    await check('wire: GraphQL enabled and normal query succeeds', async () => {
      const r = await post('/graphql', { query: '{ hello }' }); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { data: { hello: 'ok' } });
    });
    await check('wire: no GraphQL playground', async () => {
      const r = await fetchAt('/graphql'); assert.ok(r.status >= 400 && r.status < 500); assert.ok(!(await r.text()).includes('<script'));
    });
    await check('wire: GraphQL introspection rejected by its security rule', async () => {
      const r = await post('/graphql', { query: '{ __schema { types { name } } }' }); const body: any = await r.json();
      assert.ok(body.errors?.some((e: any) => /introspection/i.test(e.message))); assert.ok(!body.data);
    });
    await check('wire: GraphQL depth and complexity enforced', async () => {
      const depth = '{ nested {' + 'child {'.repeat(11) + 'value' + '}'.repeat(11) + '} }';
      const complexity = '{ ' + Array.from({ length: 1001 }, (_, i) => `a${i}: hello`).join(' ') + ' }';
      for (const [query, pattern] of [[depth, /maximum depth/i], [complexity, /complexity/i]] as const) {
        const r = await post('/graphql', { query }); const body: any = await r.json();
        assert.ok(body.errors?.some((e: any) => pattern.test(e.message)), JSON.stringify(body)); assert.ok(!body.data);
      }
    });
    await check('wire: 11-file upload is 413 and temporary files are removed', async () => {
      const body = Array.from({ length: 11 }, (_, i) => `--baseline\r\nContent-Disposition: form-data; name="f${i}"; filename="evil.html"\r\nContent-Type: text/html\r\n\r\nhello\r\n`).join('') + '--baseline--\r\n';
      const r = await fetchAt('/upload', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=baseline' }, body });
      assert.equal(r.status, 413); await r.text();
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.deepEqual(await fs.readdir(path.join(dir, 'uploads')), []);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.deepEqual(await fs.readdir(path.join(dir, 'uploads')), []);
    });
    await check('wire: WS origin checks and configured handshake rate limit', async () => {
      async function upgrade(origin: string): Promise<number> {
        return new Promise((resolve, reject) => {
          const ws = new f.websocket(f.wsUrl, { origin, handshakeTimeout: 5000 });
          ws.on('open', () => { ws.close(); resolve(101); });
          ws.on('unexpected-response', (_req: unknown, res: any) => { res.resume(); ws.terminate(); resolve(res.statusCode); });
          ws.on('error', reject);
        });
      }
      assert.equal(await upgrade('https://allowed.example'), 101);
      assert.equal(await upgrade('http://allowed.example'), 403);
      assert.equal(await upgrade('https://evil.example'), 403);
      assert.equal(await upgrade('https://allowed.example'), 503);
    });
    await check('wire: TLS1.2 succeeds and TLS1.1 handshake is rejected', async () => {
      function connect(version: tls.SecureVersion): Promise<string> {
        return new Promise((resolve, reject) => {
          const socket = tls.connect({ host: '127.0.0.1', port: f.tlsPort, minVersion: version, maxVersion: version, ciphers: 'DEFAULT:@SECLEVEL=0', rejectUnauthorized: false });
          socket.setTimeout(5000, () => socket.destroy(new Error('TLS timeout')));
          socket.once('secureConnect', () => { const protocol = socket.getProtocol(); socket.end(); resolve(protocol || ''); });
          socket.once('error', reject);
        });
      }
      assert.equal(await connect('TLSv1.2'), 'TLSv1.2');
      await assert.rejects(connect('TLSv1.1'), /alert protocol version|unsupported protocol/i);
    });
    await check('component: external socket address denied despite forged XFF', async () => {
      assert.equal(await f.externalMetricsStatus(), 403);
    });
  } finally {
    await fixture?.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
  const failed = results.filter(r => !r.passed).length;
  console.log(`PASS ${results.length - failed} / FAIL ${failed} / SKIP 0`);
  if (failed || results.length !== 14) process.exitCode = 1;
}
main().catch(err => { console.error('[security-baseline] fatal:', err); process.exitCode = 1; });
