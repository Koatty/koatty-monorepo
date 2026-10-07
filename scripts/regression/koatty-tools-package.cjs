/** Two-tool tarball acceptance, without workspace links to either tool.
 * Run from the monorepo root after building the two tools and framework packages.
 * Uses local framework tarballs and installs external npm dependencies with scripts disabled.
 * This is not an npm publication or a real external Agent/model evaluation.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'koatty-tools-package-'));
const packages = new Map(fs.readdirSync(path.join(root,'packages')).flatMap(dir=>{
  const file=path.join(root,'packages',dir,'package.json');
  if(!fs.existsSync(file)) return [];
  const pkg=JSON.parse(fs.readFileSync(file,'utf8'));return [[pkg.name,{dir,pkg}]];
}));
function run(command,args,cwd=root){
 const r=spawnSync(command,args,{cwd,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
 if(r.status!==0) throw Error(`${command} failed (${r.status}): ${r.error||''}\n${r.stdout}\n${r.stderr}`);
 return r.stdout;
}
try {
 const needed=new Set();
 function visit(name){if(needed.has(name)||!packages.has(name))return;needed.add(name);for(const dep of Object.keys(packages.get(name).pkg.dependencies||{}))visit(dep);}
 visit('koatty_cli');visit('koatty_ai');
 const tarballs={};
 for(const name of needed){
   const {pkg,dir}=packages.get(name);
   run('pnpm',['--dir',path.join(root,'packages',dir),'pack','--pack-destination',temp]);
   tarballs[name]=path.join(temp,`${name}-${pkg.version}.tgz`);
   assert(fs.existsSync(tarballs[name]),`Missing tarball ${name}`);
 }
 // No tool source, parent tsconfig, sibling repository or workspace alias is available here.
 fs.writeFileSync(path.join(temp,'package.json'),JSON.stringify({name:'koatty-tools-acceptance',version:'1.0.0',private:true,dependencies:Object.fromEntries(Object.entries(tarballs).map(([name,file])=>[name,`file:${file}`]))}));
 run('npm',['install','--ignore-scripts','--no-audit','--no-fund','--cache',path.join(temp,'npm-cache')],temp);
 for(const name of ['koatty_cli','koatty_ai']) {
   const dir=path.join(temp,'node_modules',name);
   assert(!fs.lstatSync(dir).isSymbolicLink(),`${name} unexpectedly linked`);
   const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json')));
   assert(!JSON.stringify(pkg.dependencies).includes('workspace:'),'Unresolved workspace dependency');
 }
 const ai=path.join(temp,'node_modules/koatty_ai/dist/cli/index.js');
 const cli=path.join(temp,'node_modules/koatty_cli/dist/cli/index.js');
 const invoke=(...args)=>JSON.parse(run(process.execPath,[ai,...args],temp));
 assert.equal(invoke('capabilities','--json').status,'completed');
 assert(invoke('docs','--guide','http-dto').data.content.includes('Validated'));
 run(process.execPath,[cli,'new','sample','--offline','--no-skill','--json'],temp);
 const project=path.join(temp,'sample');
 const recipe=invoke('recipes','--id','component').data.recipe;
 const plan=invoke('plan','--root',project,'--recipe','component','--params',JSON.stringify(recipe.example),'--savePlan');
 assert.equal(plan.status,'preview',JSON.stringify(plan));
 assert.equal(invoke('apply','--root',project,'--planId',plan.data.planId,'--yes').status,'applied');
 assert(fs.existsSync(path.join(project,'src/service/BillingService.ts')));
 assert.equal(invoke('skill','--root',project,'--yes').status,'applied');
 const script=`const assert=require('node:assert/strict'); const before=process.cwd(); const api=require('koatty_cli/generation'); assert.equal(typeof api.renderComponent,'function'); assert.equal(before,process.cwd()); console.log('PUBLIC_API_OK');`;
 assert(run(process.execPath,['-e',script],temp).includes('PUBLIC_API_OK'));
 console.log(JSON.stringify({status:'passed',packages:[...needed],checks:['tarball dependency resolution','no tool workspace symlinks','public API import','traditional new','AI capabilities/docs/recipe/plan/apply','project Skill installation'],boundary:'Local unpublished framework/tool tarballs; external npm dependencies installed, scripts disabled; no real external Agent'},null,2));
} finally {fs.rmSync(temp,{recursive:true,force:true});}
