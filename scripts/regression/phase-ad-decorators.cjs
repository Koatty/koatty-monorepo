// Execute actual TypeScript Legacy and TC39 emit against the existing APIs.
const assert = require('node:assert/strict');
const ts = require('typescript');
require('ts-node').register({transpileOnly:true,skipProject:true,compilerOptions:{module:'commonjs',target:'es2022',esModuleInterop:true,experimentalDecorators:true}});
const {Container,Autowired,Around,Before,IOC} = require('../../packages/koatty-container/src/index.ts');
(async()=>{
 for(const legacy of [true,false]){
  const fixture=`
    export class Dependency { value = 'initial'; }
    export class AspectClass { run(args,proceed) { proceed(); return proceed(); } }
    export class BeforeClass { async run(){await Promise.resolve();} }
    export class Consumer {
      @Autowired(Dependency) dependency;
      calls = 0;
      @Around(AspectClass) run(){this.calls++;return this.dependency.value;}
      @Before(BeforeClass) async work(){return this.dependency.value;}
    }
  `;
  const output=ts.transpileModule(fixture,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,experimentalDecorators:legacy}}).outputText;
  const exports={};new Function('exports','Autowired','Around','Before',output)(exports,Autowired,Around,Before);
  const containers=[new Container(),new Container()];
  try{
   for(const [i,c] of containers.entries()){
    c.reg(exports.Dependency);c.get('Dependency').value=String(i);
    c.reg(exports.AspectClass);c.reg(exports.BeforeClass);c.reg(exports.Consumer,{scope:'Prototype'});
   }
   for(const [i,c] of containers.entries()){
    const consumer=c.get('Consumer'); assert.equal(consumer.run(),String(i));assert.equal(consumer.calls,1);
    assert.equal(await consumer.work(),String(i)); assert.equal(consumer.calls,1);
   }
   console.log('AD_EXISTING_DECORATORS_PASS',legacy?'legacy':'tc39');
  } finally {for(const c of containers)await c.clear();}
 }
 await IOC.clear();
})().catch(error=>{console.error(error);process.exitCode=1;});
