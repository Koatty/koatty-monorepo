// Requires a disposable test Redis; never flushes a database or touches unrelated keys.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const root=process.cwd();
require('ts-node').register({transpileOnly:true,skipProject:true,compilerOptions:{module:'commonjs',target:'es2022',esModuleInterop:true,experimentalDecorators:true,emitDecoratorMetadata:true}});
const {RedisStore}=require('../../packages/koatty-store/src/store/redis.ts');
const {RedLocker}=require('../../packages/koatty-schedule/src/locker/redlock.ts');
const {runWithBoundedLock}=require('../../packages/koatty-schedule/src/process/locker.ts');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  if(!process.env.KOATTY_TEST_REDIS_PORT)throw new Error('Set KOATTY_TEST_REDIS_PORT to an isolated test Redis port');
  const options={host:process.env.KOATTY_TEST_REDIS_HOST||'127.0.0.1',port:Number(process.env.KOATTY_TEST_REDIS_PORT)};
  const store=new RedisStore({type:'redis',...options});
  const prefix='koatty-phase-c-'+randomUUID()+':';
  const keys=[prefix+'blocked',prefix+'counter',prefix+'lock'];
  const locker=RedLocker.getInstance({retryCount:0,redisConfig:{mode:'standalone',...options,keyPrefix:''}});
  try{
    const shared=await store.getSharedConnection();
    const blocked=await store.getConnection();let completed=false;
    const blocking=blocked.blpop(keys[0],1).then(v=>{completed=true;return v});
    await sleep(50);
    await Promise.race([shared.set(keys[1],'1'),sleep(300).then(()=>{throw new Error('Blocking command stalled shared connection')})]);
    assert.equal(completed,false);await shared.rpush(keys[0],'ready');await blocking;await store.release(blocked);
    const tx=await store.beginTransaction([keys[1]]);
    tx.commands.set(keys[1],'2');await shared.set(keys[1],'3');assert.equal(await tx.commit(),null);
    const tx2=await store.beginTransaction();tx2.commands.set(keys[1],'4');await tx2.commit();assert.equal(await shared.get(keys[1]),'4');
    let release;let entered;const started=new Promise(r=>entered=r);let calls=0;
    const held=runWithBoundedLock(locker,keys[2],1000,3000,'renew',async()=>{calls++;entered();await new Promise(r=>release=r)});
    await started;await sleep(1200);
    // A second acquisition after the original TTL must still fail: renewal is real.
    await assert.rejects(locker.acquire([keys[2]],1000));release();await held;assert.equal(calls,1);
    let signal;
    await assert.rejects(runWithBoundedLock(locker,keys[2],1000,50,'bounded',async s=>{
      signal=s;await new Promise(r=>s.addEventListener('abort',r,{once:true}));
    }),/exceeded maxHoldTime/);
    assert.equal(signal.aborted,true);
    const acquired=await locker.acquire([keys[2]],1000);await locker.release(acquired);
    console.log('REAL_REDIS_PHASE_C_PASS');
  }finally{
    try{await (await store.getSharedConnection()).del(...keys)}finally{await locker.close();await store.close()}
  }
})().catch(error=>{console.error(error);process.exitCode=1});
