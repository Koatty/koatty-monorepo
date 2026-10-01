// End-to-end CLI inventory -> compiled Loader/Bootstrap, with digest tamper rejection.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {execFileSync}=require('child_process');
const root=path.resolve(__dirname,'../..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'koatty-runtime-manifest-'));
const framework=path.join(root,'packages/koatty/dist/index.js');
try{
 fs.mkdirSync(path.join(dir,'src/service'),{recursive:true});fs.mkdirSync(path.join(dir,'dist/service'),{recursive:true});fs.mkdirSync(path.join(dir,'dist/config'));
 fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'manifest-fixture',version:'1.0.0',dependencies:{koatty:'*'}}));
 fs.writeFileSync(path.join(dir,'tsconfig.json'),JSON.stringify({compilerOptions:{experimentalDecorators:true},include:['src/**/*']}));
 for(let i=0;i<200;i++){
  fs.writeFileSync(path.join(dir,`src/service/Service${i}.ts`),`@Service() export class Service${i} { value=${i}; }`);
  fs.writeFileSync(path.join(dir,`dist/service/Service${i}.js`),`const {Service}=require(${JSON.stringify(framework)});class Service${i}{value=${i}}; Service()(Service${i});module.exports={Service${i}};`);
 }
 fs.writeFileSync(path.join(dir,'dist/config/server.js'),'module.exports={hostname:"127.0.0.1",port:0,protocol:"http"};');
 fs.writeFileSync(path.join(dir,'dist/App.js'),`const {Koatty,createApplication}=require(${JSON.stringify(framework)});class App extends Koatty{init(){this.env='production';this.rootPath=${JSON.stringify(dir)};this.appPath=${JSON.stringify(path.join(dir,'dist'))};this.silent=true;}};module.exports={App,createApplication};`);
 execFileSync(process.execPath,[path.join(root,'packages/koatty_cli/dist/cli/index.js'),'manifest','--root',dir,'--runtime-dir','dist','--out',path.join(dir,'.koatty/manifest.json'),'--validate'],{stdio:'pipe'});
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'.koatty/manifest.json')));assert.equal(manifest.runtime.files.length,202);assert.equal(manifest.components.length,200);
 const child=`const assert=require('assert/strict');const {App,createApplication}=require('./dist/App');(async()=>{const app=await createApplication(App);try{for(let i=0;i<200;i++)assert.equal(app.container.get('Service'+i,'SERVICE').value,i);assert(app.isReady);console.log('BOOTSTRAP_200_PASS')}finally{await app.stop()}})().catch(e=>{console.error(e);process.exitCode=1});`;
 const out=execFileSync(process.execPath,['-e',child],{cwd:dir,encoding:'utf8',timeout:30000});assert.match(out,/BOOTSTRAP_200_PASS/);
 if(process.argv.includes('--benchmark')) {
  const {performance}=require('perf_hooks'), timings={scan:[],manifest:[]};
  const file=path.join(dir,'.koatty/manifest.json'), text=fs.readFileSync(file);
  for(let i=0;i<12;i++) for(const mode of i%2 ? ['manifest','scan'] : ['scan','manifest']) {
   if(mode==='scan') fs.rmSync(file,{force:true});else fs.writeFileSync(file,text);
   fs.rmSync(path.join(dir,'.koatty/scan-cache.json'),{force:true});
   fs.rmSync(path.join(dir,'dist/.koatty'),{recursive:true,force:true});
   const start=performance.now();
   execFileSync(process.execPath,['-e',child],{cwd:dir,stdio:'pipe',timeout:30000});
   if(i>1) timings[mode].push(performance.now()-start);
  }
  fs.writeFileSync(file,text);
  const median=x=>x.slice().sort((a,b)=>a-b)[Math.floor(x.length/2)];
  const report={mode:'fresh-node-full-bootstrap-200-services',node:process.version,platform:process.platform,
   timings,scanMedianMs:median(timings.scan),manifestMedianMs:median(timings.manifest),
   improvementPercent:(1-median(timings.manifest)/median(timings.scan))*100,
   targetMet:median(timings.manifest)<=median(timings.scan)*0.7};
  console.log(JSON.stringify(report,null,2));
  if(process.argv.includes('--check')&&!report.targetMet) process.exitCode=1;
 }
 fs.appendFileSync(path.join(dir,'dist/service/Service199.js'),'\n// tampered');
 assert.throws(()=>execFileSync(process.execPath,['-e',child],{cwd:dir,stdio:'pipe',timeout:10000}),error=>/Runtime manifest file changed/i.test(String(error.stderr)));
 console.log('PHASE_D_MANIFEST_BOOTSTRAP_PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
