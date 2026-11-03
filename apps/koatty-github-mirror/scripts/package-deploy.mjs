import { readFile, readdir, mkdir, cp, writeFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run after rebuilding the workspace. A fresh directory makes each artifact reviewable.
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(app, '../..');
const output = path.join(app, '.deployment', 'koatty-github-mirror-' + new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(path.join(output,'vendor'), { recursive:true });
const packages = new Map();
for (const folder of await readdir(path.join(repo,'packages'))) {
  const dir = path.join(repo,'packages',folder);
  try { const pkg=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8')); packages.set(pkg.name,{dir,pkg}); } catch { /* Non-package folder. */ }
}
const appPackage = JSON.parse(await readFile(path.join(app,'package.json'),'utf8'));
const required = new Map();
function visit(name, production) {
  if(!packages.has(name)) return;
  if(required.has(name) && (required.get(name) || !production)) return;
  required.set(name,production);
  const pkg=packages.get(name).pkg;
  for(const dependency of Object.keys({...pkg.dependencies,...pkg.peerDependencies})) visit(dependency,production);
}
for(const name of Object.keys(appPackage.dependencies)) visit(name,true);
for(const name of Object.keys(appPackage.devDependencies)) visit(name,false);
const evidence = [];
appPackage.overrides = {};
for(const [name,production] of required) {
  const {dir,pkg}=packages.get(name);
  await stat(path.join(dir,pkg.main || 'dist/index.js'));
  execFileSync('pnpm',['pack','--pack-destination',path.join(output,'vendor')],{cwd:dir,stdio:'pipe'});
  const filename=name.replace('@','').replace('/','-')+'-'+pkg.version+'.tgz';
  const bytes=await readFile(path.join(output,'vendor',filename));
  evidence.push({name,version:pkg.version,sha256:createHash('sha256').update(bytes).digest('hex')});
  const group=production?'dependencies':'devDependencies';
  appPackage[group][name]='file:vendor/'+filename;
  if(production) delete appPackage.devDependencies[name];
  appPackage.overrides[name]='$'+name;
}
for(const name of ['src','static','test','scripts','docs','deploy','tsconfig.json','jest.config.js','.eslintrc.cjs','Dockerfile','compose.yaml','Caddyfile','.dockerignore','.env.example','README.md','CHANGELOG.md']) {
  await cp(path.join(app,name),path.join(output,name),{recursive:true});
}
await writeFile(path.join(output,'package.json'),JSON.stringify(appPackage,null,2)+'\n');
await writeFile(path.join(output,'vendor','snapshot.json'),JSON.stringify({mode:'local-source-tarballs',packages:evidence},null,2)+'\n');
const npmArgs=['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund','--cache',path.join(app,'.local-deps','.cache')];
execFileSync('npm',npmArgs,{cwd:output,stdio:'inherit'});
execFileSync('tar',['-czf',output+'.tar.gz','-C',output,'.']);
console.log('Portable deployment source directory: '+output);
console.log('Uploadable archive: '+output+'.tar.gz');
console.log('Transfer this whole directory, including vendor/ and package-lock.json.');
