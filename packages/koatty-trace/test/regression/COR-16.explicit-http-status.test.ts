import Koa from 'koa';
import request from 'supertest';
import { BaseHandler } from '../../src/handler/base';

class StatusHandler extends BaseHandler {
  async handle(ctx: any): Promise<void> { this.checkAndSetStatus(ctx, true); }
}

describe('COR-16 preserve explicit HTTP responses', () => {
  const handler = new StatusHandler();
  it.each([404, 403, 429])('preserves explicit %s and its application error body', async status => {
    const app = new Koa();
    app.use(async ctx => { ctx.status = status; ctx.body = { error: 'resource unavailable' }; await handler.handle(ctx); });
    const result = await request(app.callback()).get('/');
    expect(result.status).toBe(status);
    expect(result.body).toEqual({ error: 'resource unavailable' });
  });
  it('retains normal implicit 200 behavior via Koa body setter', async () => {
    const app = new Koa();
    app.use(async ctx => { ctx.body = { ok: true }; await handler.handle(ctx); });
    expect((await request(app.callback()).get('/')).status).toBe(200);
  });
  it('does not throw after a caller-owned raw response', async () => {
    const app = new Koa();
    app.use(async ctx => { ctx.respond = false; ctx.res.statusCode = 416; ctx.res.end(); await handler.handle(ctx); });
    expect((await request(app.callback()).get('/')).status).toBe(416);
  });
  it('still throws for an unhandled status without a response body', async () => {
    await expect(handler.handle({ status:404, body:undefined, message:'Not Found', res:{} })).rejects.toThrow();
  });
});
