const path=require('path'),fs=require('fs'),os=require('os');
const root=process.cwd();
require(root+'/node_modules/ts-node').register({transpileOnly:true,skipProject:true,compilerOptions:{module:'commonjs',target:'es2022',esModuleInterop:true,experimentalDecorators:true,emitDecoratorMetadata:true}});
const req=(p)=>require(root+'/packages/'+p);
const {Readable}=require('stream');
(async()=>{
const {resolveInside}=req('koatty-ai/src/utils/sandbox.ts');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'koatty-audit-'));fs.mkdirSync(tmp+'/project');fs.mkdirSync(tmp+'/outside');
fs.symlinkSync(tmp+'/outside/new.txt',tmp+'/project/link.txt');
const resolved=resolveInside(tmp+'/project','link.txt');fs.writeFileSync(resolved,'AUDIT');
console.log('CLI_DANGLING_SYMLINK',fs.readFileSync(tmp+'/outside/new.txt','utf8'));
const {ensureBackupInGitignore}=req('koatty-ai/src/utils/gitignore.ts');
fs.writeFileSync(tmp+'/outside/ignore','outside');fs.symlinkSync(tmp+'/outside/ignore',tmp+'/project/.gitignore');ensureBackupInGitignore(tmp+'/project');console.log('CLI_GITIGNORE_ESCAPE',fs.readFileSync(tmp+'/outside/ignore','utf8'));
const {parseXml}=req('koatty-router/src/payload/parser/xml.ts');
function ctx(body,type='text/xml'){let r=Readable.from([Buffer.from(body)]);r.headers={'content-type':type,'content-length':String(Buffer.byteLength(body))};return {method:'POST',req:r,request:{headers:r.headers},app:{security:{payload:{limit:'1mb'}}},setMetaData(){}};}
console.log('XML_MALFORMED_ACCEPTED',await parseXml(ctx('<root><a>1</root>'),{encoding:'utf8',limit:'1mb'}));
const {bodyParser}=req('koatty-router/src/payload/payload.ts');
const {cacheManager}=req('koatty-router/src/payload/payload_cache.ts');
console.log('MULTIPART_MERGED_KEEP_EXTENSIONS',cacheManager.getMergedOptions().keepExtensions);
console.log('BODY_FIRST',await bodyParser(ctx('{"a":1}','application/json')));
try{console.log('BODY_CHUNKED_SECOND',await bodyParser((()=>{const c=ctx('{"a":123}','application/json');delete c.req.headers['content-length'];c.req.headers['transfer-encoding']='chunked';return c;})()));}catch(e){console.log('BODY_CHUNKED_SECOND_ERROR',e.status,e.message)}
const {checkValidated,Validated}=req('koatty-validation/src/decorators.ts');
const cv=req('koatty-validation/node_modules/class-validator');
class D{};cv.IsString()(D.prototype,'name');
const input={name:'x',admin:true};console.log('DTO_RESULT',await checkValidated([input],[D]));
const {KLogger}=req('koatty-typeorm/src/logger.ts');const log=req('koatty-typeorm/node_modules/koatty_logger').DefaultLogger;const old=log.Info;log.Info=(...a)=>console.log('TYPEORM_INFO_WITH_ERROR_ONLY',...a);new KLogger({logging:['error']}).logQuery('INSERT INTO users(password) VALUES (?)',['audit-secret']);log.Info=old;
const {HealthCheckMiddleware}=req('koatty-serve/src/middleware/healthCheck.ts');await new HealthCheckMiddleware({detailed:true,opsToken:'required'}).middleware()({url:'/health',headers:{},socket:{remoteAddress:'10.0.0.1'}},{writeHead(s){this.s=s},end(b){console.log('HEALTH_DETAIL_WITHOUT_TOKEN',this.s,Object.keys(JSON.parse(b)))}},async()=>{});
fs.rmSync(tmp,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exitCode=1});
