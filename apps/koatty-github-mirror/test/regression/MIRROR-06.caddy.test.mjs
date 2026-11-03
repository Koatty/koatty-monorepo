// Run with node --test in Linux with CADDY_BINARY pointing to the deployed Caddy version.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

let server, caddy, dir, seen = [], canceled = false;
const prefix = '/github.com/owner/repo.git';
function request(path, { method = 'GET', headers = {}, body, chunked = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: 18080, path, method,
      headers: { host: 'git.localhost:18080', ...headers } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('test timeout')));
    req.on('error', reject);
    if (chunked && body) { req.write(body); req.end(); } else req.end(body);
  });
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mirror-caddy-'));
  const source = await readFile(new URL('../../deploy/Caddyfile.git', import.meta.url), 'utf8');
  assert(source.includes('max_size 536870912'));
  assert(source.includes('max_size 8388608'));
  // Scale only the push limit down for a low-cost overflow probe; read limit stays 8 MiB.
  const config = source.replace('servers :443', 'servers :18080')
    .replace('{$SITE_ADDRESS}', 'http://web.localhost:18080')
    .replace('git.koatty.org {', 'http://git.localhost:18080 {')
    .replaceAll('mirror:3000', '127.0.0.1:19090')
    .replace('max_size 536870912', 'max_size 1024');
  await writeFile(join(dir, 'Caddyfile'), config);
  server = http.createServer((req, res) => {
    seen.push({ path: req.url, headers: req.headers });
    req.on('error', () => res.destroy());
    if (req.url.includes('/slow/')) {
      res.writeHead(200); res.write('start');
      const timer = setInterval(() => res.write('chunk'), 20);
      res.on('close', () => { clearInterval(timer); canceled = true; });
      return;
    }
    if (req.url.includes('/auth/')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fixture PAT"' }); res.end(); return;
    }
    let size = 0;
    req.on('data', c => size += c.length);
    req.on('end', () => res.end(JSON.stringify({ size, headers: req.headers })));
  });
  await new Promise(r => server.listen(19090, '127.0.0.1', r));
  caddy = spawn(process.env.CADDY_BINARY || 'caddy', ['run', '--config', join(dir, 'Caddyfile'), '--adapter', 'caddyfile'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = '';
  caddy.stderr.on('data', c => { logs = (logs + c).slice(-8000); });
  for (let i = 0; i < 60; i++) {
    if (caddy.exitCode !== null) throw new Error('Caddy failed: ' + logs);
    try { if ((await request('/healthz')).status === 200) return; } catch {}
    await delay(100);
  }
  throw new Error('Caddy did not start: ' + logs);
});
after(async () => {
  if (caddy && caddy.exitCode === null) { caddy.kill('SIGTERM'); await new Promise(r => caddy.once('exit', r)); }
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  if (dir) await rm(dir, { recursive: true, force: true });
});
test('unknown paths, methods and discovery queries never reach upstream', async () => {
  for (const [path, method, status] of [
    ['/', 'GET', 404], ['/.env', 'GET', 404], ['/api/links', 'POST', 404],
    ['/raw.githubusercontent.com/a/b/main/x', 'GET', 404],
    [prefix + '/info/refs?service=git-delete-pack', 'GET', 404],
    [prefix + '/info/refs?service=git-upload-pack&extra=1', 'GET', 404],
    [prefix + '/git-upload-pack', 'GET', 404], [prefix + '/git-upload-pack?x=1', 'POST', 404],
    [prefix, 'GET', 405], ['/healthz', 'POST', 404], ['/', 'TRACE', 404],
  ]) {
    const count = seen.length;
    assert.equal((await request(path, { method })).status, status, path);
    assert.equal(seen.length, count, path);
  }
});
test('Git discovery preserves authentication and protocol; strips cookies and spoofed identity', async () => {
  for (const service of ['git-upload-pack', 'git-receive-pack']) {
    const r = await request(prefix + '/info/refs?service=' + service, { headers: {
      authorization: 'Basic Zml4dHVyZTpub3QtYS1yZWFsLXRva2Vu', 'git-protocol': 'version=2',
      cookie: 'fixture=1', forwarded: 'for=198.51.100.1', 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '198.51.100.1',
    } });
    assert.equal(r.status, 200);
    const { headers } = JSON.parse(r.body);
    assert.equal(headers.authorization, 'Basic Zml4dHVyZTpub3QtYS1yZWFsLXRva2Vu');
    assert.equal(headers['git-protocol'], 'version=2');
    assert.equal(headers['x-real-ip'], '127.0.0.1');
    assert.equal(headers['x-forwarded-for'], '127.0.0.1');
    assert.equal(headers.cookie, undefined); assert.equal(headers.forwarded, undefined);
  }
  const denied = await request('/github.com/auth/repo.git/info/refs?service=git-receive-pack');
  assert.equal(denied.status, 401); assert.equal(denied.headers['www-authenticate'], 'Basic realm="fixture PAT"');
});
test('read/write POST streams, media type checks and known/chunked body limits', async () => {
  for (const service of ['git-upload-pack', 'git-receive-pack']) {
    const path = prefix + '/' + service;
    const headers = { 'content-type': 'application/x-' + service + '-request' };
    assert.equal((await request(path, { method: 'POST', headers, body: Buffer.alloc(100), chunked: true })).status, 200);
    const count = seen.length;
    assert.equal((await request(path, { method: 'POST', body: 'bad' })).status, 415);
    assert.equal(seen.length, count);
    const size = service === 'git-upload-pack' ? 8388609 : 1025;
    for (const chunked of [false, true]) {
      const result = await request(path, { method: 'POST', headers: { ...headers,
        ...(!chunked ? { 'content-length': String(size) } : {}) }, body: Buffer.alloc(size), chunked });
      assert.equal(result.status, 413, service + ' chunked=' + chunked);
    }
  }
});
test('client disconnect cancels the Git upstream request', async () => {
  await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 18080,
      path: '/github.com/slow/repo.git/info/refs?service=git-upload-pack', headers: { host: 'git.localhost:18080' } }, res => {
      res.once('data', () => { res.destroy(); req.destroy(); resolve(); });
    });
    req.on('error', reject);
  });
  for (let i = 0; i < 30 && !canceled; i++) await delay(100);
  assert.equal(canceled, true);
});
