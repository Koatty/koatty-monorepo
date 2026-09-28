const fs=require('fs'),path=require('path'),os=require('os'),{createRequire}=require('module');
const repo=path.resolve(__dirname,'../../..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'koatty-e-lifecycle-'));
fs.mkdirSync(path.join(root,'dist/config'),{recursive:true});fs.writeFileSync(path.join(root,'dist/config/server.js'),`module.exports={protocol:'http',hostname:'127.0.0.1',port:0};`);
const {Koatty}=require(path.join(repo,'packages/koatty/dist'));const {createTestApp}=require(path.join(repo,'packages/koatty-testing/dist'));
class App extends Koatty{init(){this.rootPath=root;this.appPath=path.join(root,'dist');this.silent=true;}}
(async()=>{
 const a=await createTestApp(App,{env:{KOATTY_E_AUDIT_ENV:'fixture-only'}});
 await a.start();const native=a.app.server.getNativeServer();const immediatelyListening=native.listening;
 if(!native.listening)await new Promise(r=>native.once('listening',r));
 const afterWaiting=native.listening;
 const original=a.app.stop.bind(a.app);a.app.stop=async()=>{throw Error('simulated cleanup failure')};let error;
 try{await a.stop()}catch(e){error=e.message}
 const leakedEnv=process.env.KOATTY_E_AUDIT_ENV; a.app.stop=original;await a.stop();
 console.log('AUDIT_RESULT',JSON.stringify({immediatelyListening,afterWaiting,error,leakedEnv,restored:process.env.KOATTY_E_AUDIT_ENV??null}));
})().catch(e=>{console.error(e);process.exitCode=1});
