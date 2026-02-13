import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import type { KoattyApplication } from 'koatty_core';
import type { ServerlessAdapter } from './adapter';

export class TencentScfAdapter implements ServerlessAdapter {
  readonly name = 'tencent-scf';

  createHandler(app: KoattyApplication) {
    const httpHandler = app.getRequestHandler();

    return async (event: any, context: any) => {
      const { req, res, promise } = createMockHttpPair(event);
      (req as any).scfContext = context;
      httpHandler(req, res);
      return promise;
    };
  }
}

function createMockHttpPair(event: any): {
  req: IncomingMessage;
  res: ServerResponse;
  promise: Promise<any>;
} {
  const {
    httpMethod = 'GET',
    path = '/',
    headers = {},
    queryString = {},
    body,
    isBase64Encoded,
  } = event;

  const qs = Object.entries(queryString)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const url = qs ? `${path}?${qs}` : path;

  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = httpMethod;
  req.url = url;
  req.headers = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])
  ) as any;

  if (body) {
    const bodyBuf = isBase64Encoded
      ? Buffer.from(body, 'base64')
      : Buffer.from(body);
    req.push(bodyBuf);
  }
  req.push(null);

  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];

  const promise = new Promise<any>((resolve) => {
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    res.write = function (chunk: any, ...args: any[]) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return originalWrite(chunk, ...args);
    } as any;

    res.end = function (chunk?: any, ...args: any[]) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

      const responseBody = Buffer.concat(chunks).toString('utf8');
      const responseHeaders: Record<string, string> = {};
      const rawHeaders = res.getHeaders();
      for (const [key, val] of Object.entries(rawHeaders)) {
        responseHeaders[key] = String(val);
      }

      resolve({
        isBase64Encoded: false,
        statusCode: res.statusCode,
        headers: responseHeaders,
        body: responseBody,
      });

      // 清理模拟 socket，释放资源
      socket.destroy();

      return originalEnd(chunk, ...args);
    } as any;
  });

  return { req, res, promise };
}
