/**
 * createHttpTest self-test (QA-05, Phase E / E-4).
 *
 * The wrapper must accept the application's koa-style callback so a generated
 * project can write `request.get('/health')` without booting a server.
 */
import type { KoattyApplication } from 'koatty_core';
import * as http from 'http';
import { createHttpTest } from '../src/httpTest';

function fakeApp(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  return {
    callback: () => handler,
  } as unknown as KoattyApplication;
}

describe('createHttpTest', () => {
  it('wraps app.callback() and drives it through supertest', async () => {
    const app = fakeApp((req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ path: req.url }));
    });

    const request = createHttpTest(app);
    const response = await request.get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ path: '/health' });
  });

  it('propagates error status codes from the application', async () => {
    const app = fakeApp((_req, res) => {
      res.statusCode = 404;
      res.end('missing');
    });

    const response = await createHttpTest(app).get('/nope');

    expect(response.status).toBe(404);
    expect(response.text).toBe('missing');
  });

  it('supports request bodies', async () => {
    const app = fakeApp((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        res.statusCode = 201;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ created: true, body }));
      });
    });

    const response = await createHttpTest(app).post('/users').send({ name: 'koatty' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ created: true, body: JSON.stringify({ name: 'koatty' }) });
  });
});
