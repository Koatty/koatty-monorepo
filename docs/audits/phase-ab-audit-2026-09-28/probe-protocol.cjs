const root=process.cwd(), fs=require('fs'),path=require('path'),os=require('os');
require(root+'/node_modules/ts-node').register({transpileOnly:true,skipProject:true,compilerOptions:{module:'commonjs',target:'es2022',esModuleInterop:true,experimentalDecorators:true,emitDecoratorMetadata:true}});
const req=p=>require(root+'/packages/'+p);
(async()=>{
const {WsServer}=req('koatty-serve/src/server/ws.ts');const ws=Object.create(WsServer.prototype);ws.allowedOrigins=['https://app.example.com:8443'];console.log('WS_ORIGIN', ['https://app.example.com:8443','http://app.example.com:8443','http://app.example.com'].map(x=>[x,ws.isOriginAllowed(x)]));
const {Validated}=req('koatty-validation/src/decorators.ts');const cv=req('koatty-validation/node_modules/class-validator');class D{};cv.IsString()(D.prototype,'name');class S{m(x){return x;}}Reflect.defineMetadata('design:paramtypes',[D],S.prototype,'m');Object.defineProperty(S.prototype,'m',Validated(false)(S.prototype,'m',Object.getOwnPropertyDescriptor(S.prototype,'m')));console.log('DTO_BUSINESS_INPUT',await new S().m({name:'x',admin:true}));
const {resolveProfile}=req('koatty-core/src/security/profile.ts');const p=resolveProfile(null,'production');p.validation.whitelist=false;console.log('PROFILE_NESTED_MUTABLE',p.validation.whitelist);
const {GraphQLRouter,createQueryDepthLimitRule}=req('koatty-router/src/router/graphql.ts');const graphql=req('koatty-router/node_modules/graphql');
const inject=req('koatty-router/src/utils/inject.ts');inject.injectRouter=async()=>({a:{method:'a',ctlPath:'/graphql'}});inject.injectParamMetaData=()=>({});
const IOC=req('koatty-router/node_modules/koatty_container').IOC;const old=IOC.getClass;IOC.getClass=()=>class C{};
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'koatty-gql-audit-'));fs.writeFileSync(tmp+'/schema.gql','type Query { a: String }');
const app={rootPath:tmp,security:{graphql:{playground:false,introspection:false,depthLimit:10,complexityLimit:1000}},use(){}};
const g=new GraphQLRouter(app,{protocol:'graphql',ext:{schemaFile:'schema.gql'}});
try{await g.LoadRouter(app,['C']);console.log('GRAPHQL_MISSING_COMPLEXITY_LOAD_RESOLVED',g.ListRouter().size)}catch(e){console.log('GRAPHQL_LOAD_REJECTED',e.message)}
IOC.getClass=old;fs.rmSync(tmp,{recursive:true,force:true});
const schema=graphql.buildSchema('type Query { a: String }');for(const n of [10,15,20]){let q='query { ...F0 } ';for(let i=0;i<n;i++)q+=`fragment F${i} on Query { ...F${i+1} ...F${i+1} } `;q+=`fragment F${n} on Query { a }`;let t=performance.now();const e=graphql.validate(schema,graphql.parse(q),[createQueryDepthLimitRule(10)]);console.log('GRAPHQL_DEPTH_FRAGMENT_COST',n,Math.round(performance.now()-t)+'ms','errors='+e.length,'bytes='+q.length)}
})().catch(e=>{console.error(e);process.exitCode=1});
