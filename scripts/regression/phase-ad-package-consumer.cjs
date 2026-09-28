// Real tarballs in an isolated generated project. Run only after `pnpm build`.
const fs = require('fs'), path = require('path'), os = require('os');
const assert = require('assert/strict'), http = require('http');
const { execFileSync, fork } = require('child_process');
const root = path.resolve(__dirname, '../..');
const pnpmPath = process.env.KOATTY_PNPM_BIN || process.env.npm_execpath;
const pnpm = (args, cwd, timeout = 300000) => execFileSync(pnpmPath ? process.execPath : 'pnpm', pnpmPath ? [pnpmPath, ...args] : args, { cwd, stdio: 'inherit', timeout });
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'koatty-tarball-acceptance-'));
const tarballs = path.join(output, 'tarballs'), app = path.join(output, 'app');
fs.mkdirSync(tarballs);
const overrides = {};
async function main() {
  for (const folder of fs.readdirSync(path.join(root, 'packages'))) {
    const dir = path.join(root, 'packages', folder), file = path.join(dir, 'package.json');
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file));
    if (!pkg.name.startsWith('koatty') || pkg.private) continue;
    assert(fs.existsSync(path.join(dir, pkg.main || 'dist/index.js')), `Build ${pkg.name} first`);
    pnpm(['pack', '--pack-destination', tarballs], dir);
    const name = `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`;
    assert(fs.existsSync(path.join(tarballs, name)), `Missing tarball: ${name}`);
    overrides[pkg.name] = 'file:' + path.join(tarballs, name);
  }
  execFileSync(process.execPath, [path.join(root, 'packages/koatty-ai/dist/cli/index.js'), 'new', 'acceptance', '--dir', app], { cwd: output, stdio: 'inherit' });
  const file = path.join(app, 'package.json'), pkg = JSON.parse(fs.readFileSync(file));
  pkg.pnpm = { overrides };
  // The additional package is consumed through its published entry point, not a workspace link.
  pkg.devDependencies.koatty_http3 = overrides.koatty_http3;
  pkg.devDependencies.koatty_serve = overrides.koatty_serve;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2));
  const install = ['install', '--ignore-scripts', '--prefer-offline'];
  if (process.env.KOATTY_ACCEPTANCE_STORE) install.push('--store-dir', process.env.KOATTY_ACCEPTANCE_STORE);
  if (process.env.KOATTY_ACCEPTANCE_CACHE) install.push('--cache-dir', process.env.KOATTY_ACCEPTANCE_CACHE);
  pnpm(install, app);
  // Test-only ephemeral listener and IPC observation; framework/app behavior remains real.
  const config = path.join(app, 'src/config/server.ts');
  fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace(/port:\s*\d+/, 'port: 0'));
  const entry = path.join(app, 'src/App.ts');
  fs.writeFileSync(entry, fs.readFileSync(entry, 'utf8').replace('public init() {', `public init() {
    this.once('appStart', () => process.send?.({ port: (this.server as any).getNativeServer().address().port }));`));
  pnpm(['run', 'build'], app, 60000);
  pnpm(['test', '--', '--runInBand'], app, 60000);
  for (const mode of ['cjs', 'esm']) {
    const code = mode === 'cjs'
      ? `const assert=require('assert/strict');for(const name of ['koatty','koatty_serve','koatty_serve/internal','koatty_http3'])assert(Object.keys(require(name)).length);assert(require('koatty_serve').HttpServer.prototype instanceof require('koatty_serve/internal').BaseServer);assert(require('koatty_http3').Http3Server.prototype instanceof require('koatty_serve/internal').BaseServer);console.log('CJS_CONSUMER_PASS');`
      : `import assert from 'node:assert/strict';for(const name of ['koatty','koatty_serve','koatty_serve/internal','koatty_http3'])assert(Object.keys(await import(name)).length);assert((await import('koatty_serve')).HttpServer.prototype instanceof (await import('koatty_serve/internal')).BaseServer);assert((await import('koatty_http3')).Http3Server.prototype instanceof (await import('koatty_serve/internal')).BaseServer);console.log('ESM_CONSUMER_PASS');`;
    execFileSync(process.execPath, [...(mode === 'esm' ? ['--input-type=module'] : []), '-e', code], { cwd: app, stdio: 'inherit', timeout: 10000, env: { ...process.env, NODE_PATH: '' } });
  }
  const child = fork(path.join(app, 'dist/App.js'), [], { cwd: app, env: { ...process.env, NODE_ENV: 'production', NODE_PATH: '' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 30000);
  try {
    const { port } = await Promise.race([new Promise(resolve => child.once('message', resolve)), exited.then(() => { throw Error('Startup failed:\n' + logs); })]);
    const get = route => new Promise((resolve, reject) => http.get({ hostname: '127.0.0.1', port, path: route }, res => {
      let body = ''; res.on('data', d => body += d); res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject));
    const response = await get('/'); assert.equal(response.status, 200); assert.match(response.body, /Hello, Koatty!/);
    assert.equal((await get('/ready')).status, 200);
    child.kill('SIGTERM'); assert.deepEqual(await exited, { code: 0, signal: null });
    console.log('TARBALL_GENERATED_PROJECT_BUILD_HTTP_SHUTDOWN_PASS', JSON.stringify({ packages: Object.keys(overrides).length, output }));
  } finally { clearTimeout(watchdog); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
}
main().catch(error => { console.error(error); console.error('Retained fixture:', output); process.exitCode = 1; });
