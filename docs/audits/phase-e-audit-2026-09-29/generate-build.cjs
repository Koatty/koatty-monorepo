const fs=require('fs'),path=require('path'),os=require('os'),{createRequire}=require('module'),{spawnSync}=require('child_process');
const repo=path.resolve(__dirname,'../../..'),cli=path.join(repo,'packages/koatty-ai'),req=createRequire(path.join(cli,'package.json'));
const handlebars=req('handlebars'),{GeneratorPipeline}=require(path.join(cli,'dist/pipeline/GeneratorPipeline'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'koatty-e-generated-'));
(async()=>{
 for(const f of ['package.json','tsconfig.json','jest.config.js'])fs.writeFileSync(path.join(root,f),handlebars.compile(fs.readFileSync(path.join(cli,'templates/project/default',f+'.hbs'),'utf8'))({projectName:'audit'}));
 const cs=await new GeneratorPipeline({module:'article',fields:{id:{name:'id',type:'number',primary:true}}},{workingDirectory:root}).execute();
 for(const c of cs.toJSON().changes){fs.mkdirSync(path.dirname(path.join(root,c.path)),{recursive:true});fs.writeFileSync(path.join(root,c.path),c.content);}
 fs.mkdirSync(path.join(root,'node_modules'));
 for(const [name,dir]of Object.entries({koatty:'koatty',koatty_validation:'koatty-validation'}))fs.symlinkSync(path.join(repo,'packages',dir),path.join(root,'node_modules',name),'dir');
 // Reuse installed type/tool dependencies without hiding absent generated dependencies.
 fs.mkdirSync(path.join(root,'node_modules/@types'));for(const name of ['node','jest'])fs.symlinkSync(path.dirname(req.resolve('@types/'+name+'/package.json')),path.join(root,'node_modules/@types',name),'dir');
 const result=spawnSync(process.execPath,[req.resolve('typescript/bin/tsc'),'--noEmit','--pretty','false'],{cwd:root,encoding:'utf8',timeout:30000});
 console.log(JSON.stringify({root,files:cs.toJSON().changes.map(c=>c.path),dependencies:JSON.parse(fs.readFileSync(path.join(root,'package.json'))).dependencies,compileExit:result.status,stdout:result.stdout,stderr:result.stderr},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
