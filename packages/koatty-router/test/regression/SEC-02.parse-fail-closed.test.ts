/**
 * SEC-02 + SEC-05 regression tests: payload parsing fail-closed (B-2)
 * and multipart upload limits (B-5).
 *
 * @ license: BSD (3-Clause)
 */
import { IncomingMessage } from "http";
import { PassThrough } from "stream";
import { KoattyContext } from "koatty_core";
import { Exception } from "koatty_exception";
import { parseJson } from "../../src/payload/parser/json";
import { parseForm } from "../../src/payload/parser/form";
import { parseXml } from "../../src/payload/parser/xml";
import { parseText } from "../../src/payload/parser/text";
import { parseMultipart } from "../../src/payload/parser/multipart";
import { deleteFiles } from "../../src/utils/path";
import { parseSize, safeFilename } from "../../src/payload/size";
import { PayloadOptions, FILE_KEY } from "../../src/payload/interface";

/**
 * Build a mock KoattyContext whose `req` streams the given content.
 * A content-length header is always present, mirroring real requests:
 * formidable falls back to its (broken) DummyParser when the length is
 * unknown, which is an upstream limitation for chunked multipart uploads.
 */
function mockContext(content: string | Buffer | null, headers: Record<string, string> = {}, app?: any): KoattyContext {
  const req = new PassThrough() as unknown as IncomingMessage;
  const allHeaders = { 'content-type': 'application/json', ...headers };
  if (content !== null && !allHeaders['content-length']) {
    allHeaders['content-length'] = String(Buffer.byteLength(content as any));
  }
  (req as any).headers = allHeaders;
  (req as any).connection = { remoteAddress: '127.0.0.1' };
  process.nextTick(() => {
    if (content !== null) req.write(content);
    req.end();
  });
  const res = new PassThrough();
  return {
    req,
    res,
    method: 'POST',
    headers: allHeaders,
    request: { headers: allHeaders },
    app,
  } as unknown as KoattyContext;
}

const BASE_OPTS: PayloadOptions = {
  extTypes: {},
  limit: '1mb',
  encoding: 'utf-8',
  multiples: false,
  keepExtensions: false,
} as PayloadOptions;

describe("SEC-02: JSON parse failures are rejected", () => {
  test("malformed JSON throws an Exception with status 400", async () => {
    const ctx = mockContext('{"a": 1, oops}', {});
    await expect(parseJson(ctx, BASE_OPTS)).rejects.toMatchObject({ status: 400 });
  });

  test("400 error message contains no request body fragments", async () => {
    const secret = 'SECRET-TOKEN-ABC';
    const ctx = mockContext(`{"leak": "${secret}"`);
    let message = '';
    try {
      await parseJson(ctx, BASE_OPTS);
    } catch (err: any) {
      message = err.message;
    }
    expect(message).not.toContain(secret);
  });

  test("thrown errors are koatty Exceptions", async () => {
    const ctx = mockContext('not-json', {});
    await expect(parseJson(ctx, BASE_OPTS)).rejects.toBeInstanceOf(Exception);
  });

  test("onParseError:'empty' keeps legacy fallback", async () => {
    const ctx = mockContext('not-json', {});
    await expect(parseJson(ctx, { ...BASE_OPTS, onParseError: 'empty' })).resolves.toEqual({});
  });

  test("valid JSON still parses", async () => {
    const ctx = mockContext('{"a": 1}', {});
    await expect(parseJson(ctx, BASE_OPTS)).resolves.toEqual({ a: 1 });
  });

  test("profile override: app.security.payload.onParseError='empty'", async () => {
    const ctx = mockContext('not-json', {}, { security: { payload: { onParseError: 'empty' } } });
    await expect(parseJson(ctx, BASE_OPTS)).resolves.toEqual({});
  });
});

describe("SEC-02: stream-level failures carry the right status", () => {
  test("body exceeding the limit is rejected with 413", async () => {
    const big = 'x'.repeat(2 * 1024 * 1024);
    const ctx = mockContext(big, { 'content-length': String(2 * 1024 * 1024) });
    await expect(parseJson(ctx, BASE_OPTS)).rejects.toMatchObject({ status: 413 });
  });

  test("unsupported content-encoding is rejected with 415", async () => {
    const ctx = mockContext('irrelevant', { 'content-encoding': 'unsupported-encoding' });
    await expect(parseText(ctx, BASE_OPTS)).rejects.toMatchObject({ status: 415 });
  });
});

describe("SEC-02: form and XML parsers fail closed", () => {
  test("form parser propagates raw-body failure (413)", async () => {
    const big = 'x'.repeat(2 * 1024 * 1024);
    const ctx = mockContext(big, {
      'content-length': String(2 * 1024 * 1024),
      'content-type': 'application/x-www-form-urlencoded',
    });
    await expect(parseForm(ctx, BASE_OPTS)).rejects.toMatchObject({ status: 413 });
  });

  test("form parser handles urlencoded body", async () => {
    const ctx = mockContext('a=1&b=2', { 'content-type': 'application/x-www-form-urlencoded' });
    await expect(parseForm(ctx, BASE_OPTS)).resolves.toEqual({ a: '1', b: '2' });
  });

  test("xml parser resolves for parseable input (fast-xml-parser is lenient)", async () => {
    const ctx = mockContext('<root><a>1</a></root>', { 'content-type': 'text/xml' });
    await expect(parseXml(ctx, BASE_OPTS)).resolves.toMatchObject({ root: { a: 1 } });
  });
});

describe("SEC-05: multipart limits and cleanup", () => {
  function multipartRequest(parts: string[], boundary = '----koattytest') {
    const body = parts.map(
      (p) => `--${boundary}\r\n${p}\r\n`
    ).join('') + `--${boundary}--\r\n`;
    return {
      body,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(Buffer.byteLength(body)),
      },
    };
  }

  test("maxFiles default (10) rejects the 11th file with 413", async () => {
    const filePart = 'Content-Disposition: form-data; name="files"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello';
    const parts: string[] = [];
    for (let i = 0; i < 11; i++) {
      parts.push(filePart.replace('name="files"', `name="file${i}"`));
    }
    const { body, headers } = multipartRequest(parts);
    const ctx = mockContext(Buffer.from(body, 'utf-8'), headers);
    await expect(parseMultipart(ctx, BASE_OPTS)).rejects.toMatchObject({ status: 413 });
  });

  test("maxFiles option can be raised", async () => {
    const filePart = 'Content-Disposition: form-data; name="f"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello';
    const parts: string[] = [];
    for (let i = 0; i < 5; i++) {
      parts.push(filePart.replace('name="f"', `name="f${i}"`));
    }
    const { body, headers } = multipartRequest(parts);
    const ctx = mockContext(Buffer.from(body, 'utf-8'), headers);
    const result = await parseMultipart(ctx, { ...BASE_OPTS, maxFiles: 5 }) as any;
    expect(Object.keys(result[FILE_KEY] ?? {}).length).toBe(5);
  });

  test("keepExtensions defaults to false (temp filename has no extension)", async () => {
    const { body, headers } = multipartRequest([
      'Content-Disposition: form-data; name="f"; filename="evil.EXE"\r\nContent-Type: application/octet-stream\r\n\r\nMZ',
    ]);
    const ctx = mockContext(Buffer.from(body, 'utf-8'), headers);
    const result = await parseMultipart(ctx, BASE_OPTS) as any;
    const entry = result[FILE_KEY]?.f;
    expect(entry).toBeDefined();
    // formidable may yield a single file or an array depending on version
    const file = Array.isArray(entry) ? entry[0] : entry;
    expect(file.filepath.endsWith('.EXE')).toBe(false);
    await deleteFiles({ f: entry });
  });

  test("multiples:true yields arrays and deleteFiles cleans them all", async () => {
    const mk = (n: string) => `Content-Disposition: form-data; name="files"; filename="${n}.txt"\r\nContent-Type: text/plain\r\n\r\ndata-${n}`;
    const { body, headers } = multipartRequest([mk('one'), mk('two')]);
    const ctx = mockContext(Buffer.from(body, 'utf-8'), headers);
    const result = await parseMultipart(ctx, { ...BASE_OPTS, multiples: true }) as any;
    const files = result[FILE_KEY]?.files;
    expect(Array.isArray(files)).toBe(true);
    expect(files.length).toBe(2);
    const paths = files.map((f: any) => f.filepath);
    for (const p of paths) {
      await expect((await import('fs')).promises.access(p)).resolves.toBeUndefined();
    }
    await deleteFiles({ files });
    for (const p of paths) {
      await expect((await import('fs')).promises.access(p)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  test("profile provides default limits when opts are unset", async () => {
    const filePart = 'Content-Disposition: form-data; name="f"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello';
    const parts: string[] = [];
    for (let i = 0; i < 11; i++) {
      parts.push(filePart.replace('name="f"', `name="f${i}"`));
    }
    const { body, headers } = multipartRequest(parts);
    const ctx = mockContext(Buffer.from(body, 'utf-8'), headers, { security: { payload: { maxFiles: 5 } } });
    await expect(parseMultipart(ctx, BASE_OPTS)).rejects.toMatchObject({ status: 413 });
  });
});

describe("SEC-05: size helpers", () => {
  test("parseSize understands byte units", () => {
    expect(parseSize('1mb', 0)).toBe(1024 * 1024);
    expect(parseSize('512kb', 0)).toBe(512 * 1024);
    expect(parseSize('20mb', 0)).toBe(20 * 1024 * 1024);
    expect(parseSize('2gb', 0)).toBe(2 * 1024 * 1024 * 1024);
    expect(parseSize(4096, 0)).toBe(4096);
    expect(parseSize(undefined, 777)).toBe(777);
    expect(parseSize('garbage', 777)).toBe(777);
    expect(parseSize('20', 0)).toBe(20);
  });

  test("safeFilename strips directory traversal", () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('..\\windows\\evil.exe')).toBe('evil.exe');
    expect(safeFilename('/abs/path/file.txt')).toBe('file.txt');
    expect(safeFilename('')).toBe('upload');
    expect(safeFilename(undefined)).toBe('upload');
    expect(safeFilename('normal.txt')).toBe('normal.txt');
  });
});
