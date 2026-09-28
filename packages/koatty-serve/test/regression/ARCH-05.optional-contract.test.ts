import {BaseServer,ConnectionTracker,ConfigHelper,createHealthCheckMiddleware} from '../../src/internal';
import {registerConnectionPoolMetrics,unregisterConnectionPoolMetrics} from '../../src/pools/pool-metrics-integration';
test('optional transport contract uses shared limits and drain semantics',async()=>{
 expect(BaseServer).toBeDefined();const config=ConfigHelper.createHttp3Config({protocol:'http3',hostname:'127.0.0.1',port:8443});
 const tracker=new ConnectionTracker(config.connectionPool?.maxConnections);expect(tracker.size).toBe(0);
 const health=createHealthCheckMiddleware();health.setDraining(true);const end=jest.fn(),writeHead=jest.fn();
 await health({url:'/ready',headers:{}} as any,{writeHead,end} as any,async()=>{});expect(writeHead.mock.calls[0][0]).toBe(503);
});
test('connection metrics remain application-local and can be detached',()=>{
 let read:any;const app:any={server:[{protocol:'http',getConnectionStats:()=>({activeConnections:2})}],setConnectionPoolMetricsCallback:(fn:any)=>read=fn};
 registerConnectionPoolMetrics(app);expect(read()).toEqual({'http:0':{activeConnections:2}});
 unregisterConnectionPoolMetrics(app);expect(read()).toEqual({});
});

test('explicit stop releases only its own signal-coordinator registration', async () => {
 const {HttpServer}=await import('../../src/server/http');const {TerminusManager}=await import('../../src/utils/terminus');
 const {EventEmitter}=await import('events');const app:any=Object.assign(new EventEmitter(),{config:()=>({}),callback:()=>()=>{}});
 const options={protocol:'http',hostname:'127.0.0.1',port:0};const a=new HttpServer(app,options),b=new HttpServer(app,options);
 try{expect(TerminusManager.getInstance().getServerCount()).toBe(2);await a.destroy();expect(TerminusManager.getInstance().getServerCount()).toBe(1);}
 finally{await b.destroy();}expect(TerminusManager.getInstance().getServerCount()).toBe(0);
});
