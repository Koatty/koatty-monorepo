import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, symlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Explicit workspace development only. Deployment uses actual tarballs instead.
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(app, '../..');
const pkg = JSON.parse(await readFile(path.join(app, 'package.json'), 'utf8'));
const dirs = (await readdir(path.join(repo, 'packages'))).map(p => path.join(repo, 'packages', p));
const sources = [repo, ...dirs];
for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
  let source;
  for (const dir of sources) {
    try {
      const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
      if (manifest.name === name) { source = dir; break; }
      source = path.dirname(createRequire(path.join(dir, 'package.json')).resolve(name + '/package.json'));
      break;
    } catch { /* Try the next installed workspace package. */ }
  }
  if (!source && !name.startsWith('koatty')) {
    const local = path.join(app, '.local-deps');
    await mkdir(local, { recursive: true });
    execFileSync('npm', ['install', '--prefix', local, '--cache', path.join(local, '.cache'), '--ignore-scripts', '--no-audit', '--no-fund', name + '@' + (pkg.dependencies?.[name] || pkg.devDependencies[name])], { stdio: 'inherit' });
    source = path.dirname(createRequire(path.join(local, 'package.json')).resolve(name + '/package.json'));
  }
  if (!source) throw new Error('Missing installed workspace dependency: ' + name);
  const target = path.join(app, 'node_modules', name);
  await mkdir(path.dirname(target), { recursive: true });
  if (!await lstat(target).catch(() => null)) await symlink(source, target, 'dir');
  const dep = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  const bins = typeof dep.bin === 'string' ? { [name]: dep.bin } : dep.bin || {};
  for (const [bin, file] of Object.entries(bins)) {
    const dest = path.join(app, 'node_modules/.bin', bin);
    await mkdir(path.dirname(dest), { recursive: true });
    if (!await lstat(dest).catch(() => null)) await symlink(path.join(source, file), dest);
  }
}
console.log('Workspace development dependencies linked; this is not isolated-package acceptance.');
