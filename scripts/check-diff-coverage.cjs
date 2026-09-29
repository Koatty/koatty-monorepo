#!/usr/bin/env node
// Changed executable source lines, including dirty submodules and untracked files.
// Run after uncached Jest coverage. CI supplies KOATTY_COVERAGE_BASE for the PR base.
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..'),base=process.env.KOATTY_COVERAGE_BASE||'HEAD',threshold=80;
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const packages=fs.readdirSync(path.join(root,'packages')).map(p=>path.join(root,'packages',p)).filter(p=>fs.existsSync(path.join(p,'package.json')));
packages.push(path.join(root,'packages/koatty/examples/mcp-order-service'));
const rows=[],missing=[];
for(const dir of packages){
 const nested=dir.endsWith('examples/mcp-order-service');
 const own=fs.existsSync(path.join(dir,'.git'));let reference=base;
 if((own||nested)&&base!=='HEAD'){
  const entry=git(root,['ls-tree',base,nested?'packages/koatty':path.relative(root,dir)]);reference=entry.split(/\s+/)[2];if(!reference)reference=git(dir,['rev-list','--max-parents=0','HEAD']);
 }
 const cwd=nested?path.join(root,'packages/koatty'):own?dir:root,prefix=nested?'examples/mcp-order-service/src/':own?'src/':path.relative(root,dir)+'/src/';
 const diff=git(cwd,['diff','--no-ext-diff','--unified=0',reference,'--',prefix]);const changed=new Map();let file;
 for(const line of diff.split('\n')){
  if(line.startsWith('+++ b/')){file=path.resolve(cwd,line.slice(6));if(!changed.has(file))changed.set(file,new Set());}
  const match=line.match(/^@@ .* \+(\d+)(?:,(\d+))? @@/);if(match&&file){const start=+match[1],count=match[2]===undefined?1:+match[2];for(let n=start;n<start+count;n++)changed.get(file).add(n);}
 }
 for(const name of git(cwd,['ls-files','--others','--exclude-standard','--',prefix]).split('\n').filter(Boolean)){
  const file=path.resolve(cwd,name);if(!/\.[cm]?[jt]s$/.test(file)||file.endsWith('.d.ts'))continue;
  changed.set(file,new Set(fs.readFileSync(file,'utf8').split('\n').map((_,i)=>i+1)));
 }
 if(!changed.size)continue;
 const report=path.join(dir,'coverage/coverage-final.json'),coverage=fs.existsSync(report)?JSON.parse(fs.readFileSync(report)):{};
 let hit=0,total=0;
 for(const [file,lines] of changed){
  if(!fs.existsSync(file)||!file.endsWith('.ts')||file.endsWith('.d.ts')||!lines.size)continue;
  const c=coverage[file]||Object.values(coverage).find(c=>fs.existsSync(c.path)&&fs.realpathSync(c.path)===fs.realpathSync(file));
  if(!c){missing.push(path.relative(root,file));continue;}
  const counts=new Map();for(const [id,loc]of Object.entries(c.statementMap))counts.set(loc.start.line,Math.max(counts.get(loc.start.line)||0,c.s[id]));
  for(const [line,count]of counts)if(lines.has(line)){total++;if(count>0)hit++;}
 }
 rows.push({package:JSON.parse(fs.readFileSync(path.join(dir,'package.json'))).name,covered:hit,total,percent:total?100*hit/total:100});
}
const total=rows.reduce((n,r)=>n+r.total,0),covered=rows.reduce((n,r)=>n+r.covered,0),percent=total?100*covered/total:100;
console.log(JSON.stringify({base,threshold,rows,covered,total,percent,missing,passed:percent>=threshold&&!missing.length},null,2));
if(percent<threshold||missing.length)process.exitCode=1;
