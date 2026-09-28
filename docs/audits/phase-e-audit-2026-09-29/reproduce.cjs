// Audit-only: every write is confined to a newly allocated temporary fixture.
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const {createRequire}=require('module');
const repo=path.resolve(__dirname,'../../..'),cli=path.join(repo,'packages/koatty-ai');
const req=createRequire(path.join(cli,'package.json'));
const {Client}=req('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=req('@modelcontextprotocol/sdk/client/stdio.js');
const {collectManifest,validateManifest}=require(path.join(cli,'dist/manifest'));
const work=fs.mkdtempSync(path.join(os.tmpdir(),'koatty-e-audit-')),root=path.join(work,'app');fs.mkdirSync(root);
function write(file,text){const p=path.join(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}
const hash=info=>crypto.createHash('sha256').update(JSON.stringify({module:info.module,changes:info.changes.map(c=>({type:c.type,path:c.path,content:c.content??null}))})).digest('hex');
const report={fixture:work,results:{}};
(async()=>{
 write('package.json',JSON.stringify({name:'audit',dependencies:{koatty:'^4.4.0'}}));write('tsconfig.json','{"compilerOptions":{"target":"ES2022"}}');
 write('src/config/server.ts',`export default {protocol:'ws',port:9876};`);
 write('src/config/config.ts',`export default {security:{profile:'strict'},redis:{host:'E_AUDIT_FAKE_HOST'}};`);
 write('src/service/UserService.ts',`@Service('CustomService',{scope:'Request'}) export class UserService {}`);
 write('src/aspect/AuditAspect.ts',`@Aspect() export class AuditAspect {run(args,proceed){return proceed();}}`);
 write('src/controller/UserController.ts',`@Controller('/users',{protocol:'ws'}) export class UserController {
 @Autowired(UserService,'SERVICE') service;
 @Around(AuditAspect) @PostMapping('/create') create(@RequestBody() body:CreateUserDto){return body;}
}`);
 write('src/dto/CreateUserDto.ts',`export class CreateUserDto { @IsString() @MinLength(4) name:string; }`);
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(cli,'dist/cli/index.js'),'mcp','--root',root],cwd:root,stderr:'pipe'});
 const client=new Client({name:'phase-e-audit',version:'1.0.0'});let stderr='';transport.stderr?.on('data',d=>stderr+=d);
 try{
  await client.connect(transport);
  const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});return {error:!!r.isError,text:r.content.map(c=>c.text||'').join('\n')}};
  const listed=await client.listTools();report.results.stdio={tools:listed.tools.length,testAnnotation:listed.tools.find(t=>t.name==='koatty_test').annotations};
  const arbitrary={module:'not-planned',changes:[{type:'create',path:'unplanned.txt',content:'audit-only'}]};
  report.results.unplannedApply=await call('koatty_apply',{changeset:arbitrary,hash:hash(arbitrary),dryRun:false});assert.equal(fs.readFileSync(path.join(root,'unplanned.txt'),'utf8'),'audit-only');
  fs.mkdirSync(path.join(root,'docs'));fs.writeFileSync(path.join(work,'outside.txt'),'E_AUDIT_OUTSIDE_SENTINEL');fs.symlinkSync(path.join(work,'outside.txt'),path.join(root,'docs/linked.txt'));
  report.results.outsideDocs=await call('koatty_docs',{topic:'E_AUDIT_OUTSIDE_SENTINEL'});assert.match(report.results.outsideDocs.text,/E_AUDIT_OUTSIDE_SENTINEL/);
  report.results.standardManifest=collectManifest(root);assert.equal(report.results.standardManifest.config.keys.length,0);
  write('config/security.ts',`export default {profile:process.env.PROFILE || 'E_AUDIT_FAKE_SECRET'};`);
  const leaked=collectManifest(root);report.results.profileLeak={profile:leaked.security.profile,validation:validateManifest(leaked)};assert.match(leaked.security.profile,/E_AUDIT_FAKE_SECRET/);
  write('existing.txt','KEEP_THIS_VALUE');const invalid={module:'audit',changes:[{type:'create',path:'partial.txt',content:'written-first'},{type:'modify',path:'existing.txt',content:{invalid:true}}]};
  report.results.partialApply=await call('koatty_apply',{changeset:invalid,hash:hash(invalid),dryRun:false});report.results.partialApply.after={first:fs.readFileSync(path.join(root,'partial.txt'),'utf8'),existing:fs.readFileSync(path.join(root,'existing.txt'),'utf8')};assert.equal(report.results.partialApply.error,true);assert.equal(report.results.partialApply.after.existing,'');
  write('docs/guide.md','hello');const before=fs.readFileSync(path.join(root,'docs/guide.md'),'utf8');const badBoolean={module:'audit',changes:[{type:'modify',path:'docs/guide.md',content:'zero-is-not-boolean'}]};report.results.invalidBoolean=await call('koatty_apply',{changeset:badBoolean,hash:hash(badBoolean),dryRun:0});assert.notEqual(fs.readFileSync(path.join(root,'docs/guide.md'),'utf8'),before);
  report.results.plan=await call('koatty_plan',{spec:'module: article\nfields:\n  id:\n    type: number\n    primary: true\n'});
 }finally{await client.close();await transport.close();}
 report.stderr=stderr;console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
