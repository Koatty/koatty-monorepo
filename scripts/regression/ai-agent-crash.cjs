// Compiled API + real worker death. Local filesystem recovery, not a clustered-store test.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createAgentRunner, createFileAgentRunStore } = require('../../packages/koatty-llm/dist');

function runner(directory, crash) {
  return createAgentRunner({
    store: createFileAgentRunStore(directory), definition: 'process-crash-v1', leaseMs: 500,
    tools: ['write'], registry: { getTool: name => name === 'write' ? { name, inputSchema: { type: 'object' } } : undefined },
    client: { complete: async request => ({ text: 'done', model: 'test', provider: 'local', cached: false,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      toolCalls: request.messages.some(m => m.role === 'tool') ? [] : [{ id: 'write-1', name: 'write', args: {} }] }) },
    invoke: async (_name, _args, call) => {
      fs.appendFileSync(path.join(directory, 'business-effects'), call.idempotencyKey + '\n');
      if (crash) { process.send({ entered: true }); return new Promise(() => {}); }
      throw new Error('A reconciled write must never be invoked again');
    },
  });
}

async function main() {
  if (process.argv[2] === 'worker') {
    const instance = runner(process.argv[3], true);
    await instance.start({ scope: 'tenant', id: 'job', messages: [{ role: 'user', content: 'execute' }] });
    await instance.run('tenant', 'job');
    throw new Error('Worker should have been killed');
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'koatty-agent-crash-'));
  let child;
  try {
    await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [__filename, 'worker', directory], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      let entered = false;
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Worker did not reach the checkpoint')); }, 10000);
      child.once('error', reject);
      child.on('message', message => { if (message.entered) { entered = true; child.kill('SIGKILL'); } });
      child.once('exit', (_code, signal) => { clearTimeout(timer); entered && signal === 'SIGKILL' ? resolve() : reject(new Error('Unexpected worker exit')); });
    });
    await new Promise(resolve => setTimeout(resolve, 550));
    const recovered = runner(directory, false);
    const unknown = await recovered.run('tenant', 'job');
    assert.equal(unknown.status, 'unknown');
    assert.equal(fs.readFileSync(path.join(directory, 'business-effects'), 'utf8').trim().split('\n').length, 1);
    await recovered.resolveUnknown('tenant', 'job', { revision: unknown.revision, idempotencyKey: unknown.inFlight.key,
      output: { committed: true } });
    assert.equal((await recovered.run('tenant', 'job')).status, 'completed');
    assert.equal(fs.readFileSync(path.join(directory, 'business-effects'), 'utf8').trim().split('\n').length, 1);
    console.log('PASS: worker crash -> unknown -> authoritative reconciliation -> completed; business effect count=1');
  } finally { child?.kill('SIGKILL'); fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
