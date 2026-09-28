import { createServer, request, Server } from 'http';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { gzipSync } from 'zlib';
import { bodyParser } from '../../src/payload/payload';
import { parseXml } from '../../src/payload/parser/xml';
import { FILE_KEY } from '../../src/payload/interface';
import { cacheManager } from '../../src/payload/payload_cache';
function context(body: Buffer | string, headers: Record<string, string> = {}): any {
  const req = Readable.from([Buffer.from(body)]); (req as any).headers = { 'content-type': 'application/json', ...headers };
  return { req, method:'POST', request:{headers:(req as any).headers}, app:{security:{payload:{limit:'1mb'}}}, setMetaData() {} };
}
describe('AB-10/12: parser validation and request isolation', () => {
  beforeEach(() => cacheManager.clearAll());
  test('malformed XML rejects without reflecting its body', async () => {
    await expect(parseXml(context('<root><a>SECRET</root>'), {encoding:'utf8',limit:'1mb'} as any)).rejects.toMatchObject({status:400});
  });
  test('length from a previous request never contaminates chunked or gzip requests', async () => {
    const opts = { limit:'1mb' };
    await expect(bodyParser(context('{"a":1}', {'content-length':'7'}), opts)).resolves.toEqual({a:1});
    await expect(bodyParser(context('{"a":123}', {'transfer-encoding':'chunked'}), opts)).resolves.toEqual({a:123});
    const compressed = gzipSync('{"a":456}');
    await expect(bodyParser(context(compressed, {'content-encoding':'gzip', 'content-length':String(compressed.length)}), opts)).resolves.toEqual({a:456});
  });
  test('concurrent consumers share the same parse promise', async () => {
    const ctx = context('{"a":1}');
    const first = bodyParser(ctx), second = bodyParser(ctx);
    expect(first).toBe(second); await expect(first).resolves.toEqual({a:1});
  });
});
describe('AB-07/11: real HTTP multipart pipeline', () => {
  let server: Server, dir: string, url: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'koatty-ab-upload-')); cacheManager.clearAll();
    server = createServer(async (req,res) => {
      const ctx:any = {req,res,method:req.method,request:{headers:req.headers},app:{security:{payload:{limit:'1mb',maxFiles:10,maxFields:100,maxFieldsSize:'1mb'}}},setMetaData(){}};
      try { const data = await bodyParser(ctx,{uploadDir:dir}); res.end(JSON.stringify(data[FILE_KEY])); }
      catch(e:any) { res.statusCode=e.status || 500; res.end(e.message); }
    });
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r)); url=`http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r()));
    await fs.rm(dir,{recursive:true,force:true});
  });
  function multipart(n:number, data='hello') {
    return Array.from({length:n},(_,i)=>`--abtest\r\nContent-Disposition: form-data; name="f${i}"; filename="attack.html"\r\nContent-Type: text/html\r\n\r\n${data}\r\n`).join('')+'--abtest--\r\n';
  }
  async function expectClean() {
    // Allow file handles to close; assert a stable empty directory, not just an early empty snapshot.
    await new Promise(r=>setTimeout(r,100)); expect(await fs.readdir(dir)).toEqual([]);
    await new Promise(r=>setTimeout(r,100)); expect(await fs.readdir(dir)).toEqual([]);
  }
  test('default generated filenames have no client extension', async () => {
    const res=await fetch(url,{method:'POST',headers:{'content-type':'multipart/form-data; boundary=abtest'},body:multipart(1)});
    expect(res.status).toBe(200); const files:any=await res.json();
    expect(path.extname(files.f0[0].filepath)).toBe(''); await expectClean();
  });
  test.each([[11,'hello'],[1,'x'.repeat(1024*1024+1)]])('limit failure leaves no files (%i)', async (n,data) => {
    const res=await fetch(url,{method:'POST',headers:{'content-type':'multipart/form-data; boundary=abtest'},body:multipart(n as number,data as string)});
    expect(res.status).toBe(413); await res.text(); await expectClean();
  });
  test('client disconnect removes partially written files', async () => {
    const req=request(url,{method:'POST',headers:{'content-type':'multipart/form-data; boundary=abtest','transfer-encoding':'chunked'}});
    req.on('error',()=>{}); req.write(multipart(1,'x'.repeat(8192)).replace('--abtest--\r\n',''));
    await new Promise(r=>setTimeout(r,50)); req.destroy(); await expectClean();
  });
});
