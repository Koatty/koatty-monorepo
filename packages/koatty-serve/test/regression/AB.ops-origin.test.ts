import { WsServer } from '../../src/server/ws';
import { createHealthCheckMiddleware } from '../../src/middleware/healthCheck';
describe('AB-08: complete Origin comparison', () => {
  const server:any=Object.create(WsServer.prototype);
  beforeEach(()=>{server.allowedOrigins=['https://app.example.com:8443','https://*.other.org'];});
  test.each(['http://app.example.com:8443','http://app.example.com','https://app.example.com','https://user@app.example.com:8443','https://app.example.com:8443/path','http://a.other.org'])('rejects %s',origin=>{
    expect(server.isOriginAllowed(origin)).toBe(false);
  });
  test.each(['https://app.example.com:8443','https://a.other.org','https://a.other.org:443'])('accepts %s',origin=>{
    expect(server.isOriginAllowed(origin)).toBe(true);
  });
});
describe('AB-13: health details require token even inside trusted networks',()=>{
  test.each(['/health','/ready'])('%s hides details without the correct token',async url=>{
    for(const authorization of [undefined,'Bearer wrong','Bearer required']) {
      const mw=createHealthCheckMiddleware({detailed:true,opsToken:'required',memoryThresholdMB:8192});
      let body:any; const res:any={writeHead(){},end(s:string){body=JSON.parse(s)}};
      await mw({url,headers:{authorization},socket:{remoteAddress:'10.0.0.1'}} as any,res,async()=>{});
      const details=url==='/health'?body.details:body.checks;
      if(authorization==='Bearer required') expect(details).toBeDefined(); else expect(details).toBeUndefined();
    }
  });
});

test('AB-08: configured handshake rate limit rejects before handleUpgrade', () => {
  const server:any=Object.create(WsServer.prototype);
  server.upgradeRateLimit={enabled:true,max:1,windowMs:60000};
  server.upgradeAttempts=new Map(); server.checkOriginEnabled=false; server.maxConnections=0;
  server.server={handleUpgrade:jest.fn()}; server.logger={warn:jest.fn()};
  server.setupUpgradeHandling();
  const socket={remoteAddress:'203.0.113.5',write:jest.fn(),destroy:jest.fn()};
  server.upgradeHandler({headers:{}},socket,Buffer.alloc(0));
  server.upgradeHandler({headers:{}},socket,Buffer.alloc(0));
  expect(server.server.handleUpgrade).toHaveBeenCalledTimes(1);
  expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('503'));
  expect(socket.destroy).toHaveBeenCalledTimes(1);
});

test('AB-08: constructor and Start bind each upgrade handler only once', () => {
  const { EventEmitter } = require('events');
  const server:any=Object.create(WsServer.prototype);
  server.httpServer=new EventEmitter(); server.upgradeHandler=jest.fn(); server.clientErrorHandler=jest.fn();
  server.ensureUpgradeHandlersAreBound(); server.ensureUpgradeHandlersAreBound();
  server.httpServer.emit('upgrade', {}, {}, Buffer.alloc(0));
  expect(server.upgradeHandler).toHaveBeenCalledTimes(1);
});
