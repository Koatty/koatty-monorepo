/** Dedicated production-profile acceptance fixture. Uses real framework
 * components and real loopback HTTP/WS/TLS listeners, no mocked protocols. */
import 'reflect-metadata';
import path from 'path';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
const root = path.resolve(__dirname, '../..');
const routerRequire = createRequire(path.join(root, 'packages/koatty-router/package.json'));
const { Koatty } = require('../../packages/koatty-core/dist');
const { IOCContainer } = require('../../packages/koatty-container/dist');
const { HttpServer, HttpsServer, WsServer, createHealthCheckMiddleware } = require('../../packages/koatty-serve/dist');
const { bodyParser, FILE_KEY } = require('../../packages/koatty-router/dist');
const { GraphQLRouter } = require('../../packages/koatty-router/src/router/graphql');
const { Validated } = require('../../packages/koatty-validation/dist');
const { getRequestId } = require('../../packages/koatty-trace/src/utils/utils');
const { IsString } = createRequire(path.join(root, 'packages/koatty-validation/package.json'))('class-validator');

export async function startSecurityFixture(dir: string) {
  const app = new Koatty();
  app.silent = true;
  app.env = "production";
  app.setMetaData('_configs', { config: {
    security: { profile: 'strict' },
    ws: { allowedOrigins: ['https://allowed.example'], rateLimit: { enabled: true, max: 3, windowMs: 60000 } },
  } });
  IOCContainer.setApp(app);
  class User { name?: string; }
  IsString()(User.prototype, 'name');
  class Endpoint { save(input: unknown) { return input; } }
  Reflect.defineMetadata('design:paramtypes', [User], Endpoint.prototype, 'save');
  Object.defineProperty(Endpoint.prototype, 'save', Validated(false)(Endpoint.prototype, 'save', Object.getOwnPropertyDescriptor(Endpoint.prototype, 'save')));
  const endpoint = new Endpoint();
  app.use(async (ctx: any, next: () => Promise<void>) => {
    try { await next(); } catch (err: any) { ctx.status = err.status || 500; ctx.body = { error: err.message }; }
    // Koatty core delegates response completion to middleware. This fixture
    // serializes the actual handler result without reshaping DTO/GraphQL data.
    if (!ctx.res.writableEnded) {
      if (typeof ctx.body === 'string') ctx.res.end(ctx.body);
      else { ctx.type = 'application/json'; ctx.res.end(JSON.stringify(ctx.body ?? { error: 'Not found' })); }
    }
  });
  app.use(async (ctx: any, next: () => Promise<void>) => {
    ctx.requestId = getRequestId(ctx, { requestIdHeaderName: 'x-request-id', requestIdName: 'requestId' });
    ctx.set('x-request-id', ctx.requestId);
    if (ctx.method === 'POST') ctx.request.body = await bodyParser(ctx, { uploadDir: path.join(dir, 'uploads') });
    await next();
  });
  app.use(async (ctx: any, next: () => Promise<void>) => {
    if (ctx.path === '/id') { ctx.body = { requestId: ctx.requestId }; return; }
    if (ctx.path === '/dto' && ctx.method === 'POST') {
      try { ctx.body = await endpoint.save(ctx.request.body); }
      catch { ctx.status = 400; ctx.body = { error: 'Invalid DTO' }; }
      return;
    }
    if (ctx.path === '/upload' && ctx.method === 'POST') { ctx.body = ctx.request.body[FILE_KEY]; return; }
    await next();
  });
  const graph = new GraphQLRouter(app, { protocol: 'graphql', ext: { schemaFile: 'fixture.gql' } });
  graph.SetRouter('/graphql', {
    schema: routerRequire('graphql').buildSchema('type Query { hello: String, nested: Nested } type Nested { child: Nested, value: String }'),
    implementation: { hello: () => 'ok' },
  });
  app.use(graph.router.routes());
  app.markReady();
  const base = { hostname: '127.0.0.1', port: 0, shutdown: { preStopDelay: 0, drainTimeout: 1000 } };
  const key = path.join(dir, 'tls-key.pem'), cert = path.join(dir, 'tls-cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const http = new HttpServer(app, { ...base, protocol: 'http' });
  const tls = new HttpsServer(app, { ...base, protocol: 'https', ssl: { mode: 'auto', key, cert } });
  const ws = new WsServer(app, { ...base, protocol: 'ws' });
  const servers = [http, tls, ws];
  try {
    for (const server of servers) await new Promise<void>((resolve, reject) => {
      server.getNativeServer().once('error', reject);
      server.Start(resolve);
    });
  } catch (err) { await Promise.all(servers.map(s => new Promise(r => s.Stop(r)))); throw err; }
  return {
    url: `http://127.0.0.1:${http.getNativeServer().address().port}`,
    wsUrl: `ws://127.0.0.1:${ws.getNativeServer().address().port}`,
    tlsPort: tls.getNativeServer().address().port,
    websocket: routerRequire('ws'),
    // Explicit component-boundary test: source IP is synthetic, not a claim
    // that loopback traffic exercised an external deployment topology.
    async externalMetricsStatus() {
      const mw = createHealthCheckMiddleware({ exposeMetrics: app.security.ops.exposeMetrics });
      let status = 0;
      await mw({ url: '/metrics', headers: { 'x-forwarded-for': '127.0.0.1' }, socket: { remoteAddress: '203.0.113.8' } },
        { writeHead(code: number) { status = code; }, end() {} }, async () => {});
      return status;
    },
    async stop() { await Promise.all(servers.map(s => new Promise<void>((resolve, reject) => s.Stop((e: Error) => e ? reject(e) : resolve())))); },
  };
}
