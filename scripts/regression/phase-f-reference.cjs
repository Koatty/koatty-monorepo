/** Compiled reference app acceptance: real HTTP/SSE and the bounded mock tool loop. */
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['packages/koatty/examples/mcp-order-service/dist/main.js'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LLM_MODE: 'mock', MCP_API_KEYS: JSON.stringify({ 'local-test-credential': [] }) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const url = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('reference app exited before readiness: ' + stderr);
      try { ready = (await fetch(url + '/readyz', { signal: AbortSignal.timeout(500) })).ok; } catch {}
      if (ready) break; await delay(50);
    }
    assert(ready, 'readiness endpoint');
    const response = await fetch(url + '/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'local-test-credential' }, body: JSON.stringify({ question: 'List orders' }), signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const body = await response.text(); assert.match(body, /order lookup completed/); assert.match(body, /event: done/);
    console.log('Phase F compiled reference acceptance passed (local mock provider, real HTTP/SSE).');
  } finally {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited; clearTimeout(timer);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
