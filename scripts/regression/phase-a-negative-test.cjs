// Prove an actual failing submodule test propagates through the root Turbo gate.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '../..');
const fixture = path.join(root, 'packages/koatty-lib/test', `negative-ci-${process.pid}.test.ts`);
const marker = 'KOATTY_EXPECTED_NEGATIVE_GATE_FAILURE';
try {
  fs.writeFileSync(fixture, `test('${marker}',()=>{throw new Error('${marker}')});\n`, { flag: 'wx' });
  const result = spawnSync('pnpm', ['exec', 'turbo', 'run', 'test', '--force', '--filter=koatty_lib', '--', '--runInBand'], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
  const output = (result.stdout || '') + (result.stderr || '');
  assert.ifError(result.error);
  assert.notEqual(result.status, 0, 'Turbo swallowed the failing submodule test');
  assert.match(output, new RegExp(marker), 'Failure must come from the injected test');
  console.log(JSON.stringify({ gate: 'actual-submodule-test-through-turbo', exitCode: result.status, marker, passed: true }));
} finally { fs.rmSync(fixture, { force: true }); }
