// Run from repo root. Executes current source; adapters are labelled below.
const path=require('path'),fs=require('fs'),os=require('os'),{EventEmitter}=require('events');
const root=process.cwd();
require(root+'/node_modules/ts-node').register({transpileOnly:true,skipProject:true,compilerOptions:{module:'commonjs',target:'es2022',esModuleInterop:true,experimentalDecorators:true,emitDecoratorMetadata:true}});
const req=p=>require(root+'/packages/'+p), sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const {Container}=req('koatty-container/src/container/container.ts');
 const c=new Container(),app=new EventEmitter();c.setApp(app);
 let constructed=0,initialized=0,destroyed=0;
 class Resource {constructor(){constructed++} async init(){initialized++} async dispose(){destroyed++}}
 c.reg('AuditResource',Resource,{isAsync:true,initMethod:'init',destroyMethod:'dispose',scope:'Singleton'});
 const before=constructed;app.emit('appReady');await sleep(0);const after=constructed;
 const sealed=Object.isSealed(c.getInsByClass(Resource));await c.clear();
 console.log('CONTAINER',JSON.stringify({beforeReady:before,afterReady:after,initialized,destroyed,sealed}));
 const {Koatty}=req('koatty-core/src/application.ts');const k=new Koatty();k.silent=true;let stopped=0;k.once('appStop',()=>{stopped++});await k.stop();await k.stop();console.log('APP_STOP_ONCE',stopped);
 const sched=req('koatty-schedule/src/process/schedule.ts');sched.resetScheduleState();let release1,release2,runs=0;
 const task=()=>{runs++;return new Promise(r=>{if(runs===1)release1=r;else release2=r})};
 sched.runScheduledTask('audit',task,'queue');await sleep(0);sched.runScheduledTask('audit',task,'queue');
 const draining=sched.stopSchedule(1000);release1();await draining;
 console.log('SCHEDULE_STOP_RETURNED',JSON.stringify({runs,inFlight:sched.getRunningTaskCount()}));release2();await sleep(0);sched.resetScheduleState();
 const eventApp=new EventEmitter();await sched.initSchedule({},eventApp);let releaseEvent;
 sched.runScheduledTask('event-audit',()=>new Promise(r=>releaseEvent=r));await sleep(0);const listenerReturn=eventApp.listeners('appStop')[0]();await listenerReturn;console.log('SCHEDULE_APPSTOP',JSON.stringify({returnsPromise:!!listenerReturn?.then,inFlight:sched.getRunningTaskCount()}));releaseEvent();await sleep(0);sched.resetScheduleState();
 // A fake lock backend isolates the descriptor watchdog from Redis availability.
 const {RedLocker}=req('koatty-schedule/src/locker/redlock.ts');const original=RedLocker.getInstance;
 let seenSignal,businessRuns=0;const ctrl=new AbortController();RedLocker.getInstance=()=>({using:async(a,b,c,fn)=>fn(ctrl.signal)});
 const {redLockerDescriptor}=req('koatty-schedule/src/process/locker.ts');const wrapped=redLockerDescriptor({value:async({signal})=>{businessRuns++;seenSignal=signal;await sleep(55);return 1}},'audit-lock','work',{lockTimeOut:1000,maxHoldTime:15}).value;
 const outcome=wrapped().catch(e=>e.message);await sleep(30);
 console.log('LOCK_AFTER_MAX_HOLD',JSON.stringify({aborted:seenSignal.aborted,businessRuns}));console.log('LOCK_FINAL',await outcome);RedLocker.getInstance=original;
 // Actual config loader over a temporary JS config file.
 const {LoadConfigs}=req('koatty-config/src/config.ts');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'koatty-c-config-'));
 try{fs.writeFileSync(path.join(dir,'config.js'),'module.exports={port:"not-a-number"}');const schema={type:'object',properties:{config:{type:'object',properties:{port:{type:'integer'}},required:['port']}},required:['config']};try{console.log('JSON_SCHEMA_ACCEPTED',JSON.stringify(LoadConfigs([dir],dir,undefined,undefined,schema)))}catch(e){console.log('JSON_SCHEMA_ERROR',e.message)}
 fs.writeFileSync(path.join(dir,'security.js'),'module.exports={profile:"strict"}');fs.writeFileSync(path.join(dir,'env.js'),'module.exports={url:"${KOATTY_C_AUDIT_MISSING}"}');delete process.env.KOATTY_C_AUDIT_MISSING;process.env.NODE_ENV='development';delete process.env.KOATTY_ENV;
 console.log('EXPLICIT_STRICT_CONFIG',JSON.stringify(LoadConfigs([dir],dir)));}finally{fs.rmSync(dir,{recursive:true,force:true})}
 // Actual RedisStore factory, with ready-client sentinel instead of a DB.
 const {RedisStore}=req('koatty-store/src/store/redis.ts');const redis=Object.create(RedisStore.prototype);redis.client={status:'ready'};console.log('REDIS_CONNECT_REUSES_IDENTITY',(await redis.connect())===(await redis.connect()));console.log('REDIS_TRANSACTION_METHOD',typeof redis.beginTransaction);
 // Actual cache decorator; in-memory string store substitutes only network I/O.
 const cacheStore=req('koatty-cacheable/src/store.ts');const memory=new Map();cacheStore.GetCacheStore=async()=>({get:async k=>memory.get(k),set:async(k,v)=>memory.set(k,String(v)),del:async k=>memory.delete(k)});
 const ioc=req('koatty-cacheable/node_modules/koatty_container').IOCContainer;const oldType=ioc.getType;ioc.getType=()=> 'SERVICE';
 const {CacheAble}=req('koatty-cacheable/src/cache.ts');let cacheCalls=0;class S{async read(){cacheCalls++;await sleep(10);return '123'}};
 Object.defineProperty(S.prototype,'read',CacheAble('audit') (S.prototype,'read',Object.getOwnPropertyDescriptor(S.prototype,'read')));
 const service=new S();await Promise.all(Array.from({length:10},()=>service.read()));const cached=await service.read();console.log('CACHE',JSON.stringify({sourceCalls:cacheCalls,cached,cachedType:typeof cached}));ioc.getType=oldType;
})().catch(e=>{console.error(e);process.exitCode=1});
