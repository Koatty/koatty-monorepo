import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer } from 'https';
import { connect, createSecureContext } from 'tls';
import { execFileSync } from 'child_process';
import { loadCertificates, watchCertificates } from '../../src/utils/cert-loader';

test('TLS certificate replacement changes new handshakes, invalid pairs retain current certificate, cleanup stops watching', async () => {
  jest.useRealTimers();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koatty-tls-reload-'));
  const config = { key: path.join(dir,'key.pem'), cert: path.join(dir,'cert.pem') };
  const generate = (name: string) => execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj',`/CN=${name}`,'-keyout',config.key,'-out',config.cert], {stdio:'ignore'});
  generate('first.local');
  const server = createServer(loadCertificates(config));
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const peer = () => new Promise<string>((resolve,reject) => {
    const socket = connect({port:(server.address() as any).port,host:'127.0.0.1',rejectUnauthorized:false}, () => {
      resolve(socket.getPeerCertificate().subject.CN as string); socket.end();
    }); socket.on('error',reject);
  });
  let reloads = 0, failures = 0;
  const stop = watchCertificates(config, () => { const options = loadCertificates(config); createSecureContext(options); server.setSecureContext(options); reloads++; }, () => { failures++; });
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now()+4000;
    while (!predicate() && Date.now()<deadline) await new Promise(r => setTimeout(r,25));
    expect(predicate()).toBe(true);
  };
  try {
    expect(await peer()).toBe('first.local');
    generate('second.local'); await until(() => reloads > 0);
    expect(await peer()).toBe('second.local');
    fs.writeFileSync(config.cert, 'invalid'); await until(() => failures > 0);
    expect(await peer()).toBe('second.local');
    stop(); const before = reloads; generate('third.local');
    // Wait beyond the 500ms polling interval plus the 100ms debounce.
    await new Promise(r => setTimeout(r,800)); expect(reloads).toBe(before);
  } finally {
    stop(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(dir,{recursive:true,force:true});
  }
}, 15000);
