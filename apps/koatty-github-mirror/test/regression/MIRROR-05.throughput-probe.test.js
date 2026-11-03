const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const script = pathToFileURL(path.resolve(__dirname, '../../scripts/git-throughput.mjs')).href;
const run = code => execFileSync(process.execPath, ['--input-type=module', '-e',
  `import assert from 'node:assert/strict'; import {packet,want,PackCounter,probe} from ${JSON.stringify(script)}; ${code}`], { timeout: 10000 });

test('probe uses same HEAD, opt-in shallow negotiation and counts fragmented pack separately from progress', () => {
  run(`
    const head = 'a'.repeat(40);
    assert(!want(head, false).includes('deepen'));
    assert(want(head, true).includes('000ddeepen 1\\n'));
    assert.throws(() => want('invalid', false));
    const wire = Buffer.concat([packet('NAK\\n'), packet('\\x02Counting objects...'), packet('\\x01PACKabcd'), Buffer.from('0000')]);
    const counter = new PackCounter();
    for (const byte of wire) counter.feed(Buffer.from([byte]));
    assert.equal(counter.bytes, 8); assert.equal(counter.pending.length, 0);
    counter.feed(packet('\\x03upstream error')); assert.equal(counter.error, true);
    assert.throws(() => new PackCounter().feed(Buffer.from('oops')));
  `);
});

test('probe reports complete pack, Git errors, truncated packets and bounded stalls without keeping sockets alive', () => {
  run(`
    const http = await import('node:http');
    const server = http.createServer((req,res) => {
      req.resume(); res.setHeader('content-type','application/x-git-upload-pack-result');
      if (req.url === '/stall') { res.write(packet('\\x02Waiting')); return; }
      if (req.url === '/error') { res.end(packet('\\x03Rejected')); return; }
      if (req.url === '/truncated') { res.end('0010\\x01PACK'); return; }
      res.end(Buffer.concat([packet('NAK\\n'),packet('\\x01PACKabcd'),Buffer.from('0000')]));
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const url = suffix => new URL('http://127.0.0.1:'+server.address().port+suffix);
    try {
      const complete = await probe(url('/ok'), {body:want('a'.repeat(40),false), seconds:1});
      assert.equal(complete.outcome,'complete'); assert.equal(complete.packBytes,8);
      assert.equal(complete.status,200); assert.notEqual(complete.firstPackSeconds,null);
      assert.equal((await probe(url('/error'),{body:Buffer.from('x'),seconds:1})).outcome,'git-error');
      assert.equal((await probe(url('/truncated'),{body:Buffer.from('x'),seconds:1})).outcome,'truncated-git-packet');
      const stalled = await probe(url('/stall'),{body:Buffer.from('x'),seconds:0.1});
      assert.equal(stalled.outcome,'time-limit'); assert.equal(stalled.packBytes,0);
      assert.equal(stalled.firstPackSeconds,null); assert(stalled.totalSeconds < 2);
    } finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
  `);
});
