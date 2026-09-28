import { execFileSync } from 'child_process';
import path from 'path';

test('an idle WebSocket router does not keep an otherwise finished process alive', () => {
  const filename = path.resolve(__dirname, '../../src/router/ws.ts');
  const script = `
    const ts = require('typescript'), fs = require('fs');
    require.extensions['.ts'] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,experimentalDecorators:true}
    }).outputText,file);
    require('koatty_logger').DefaultLogger.enable(false);
    const {WebsocketRouter} = require(${JSON.stringify(filename)});
    new WebsocketRouter({config:()=>({})},{protocol:'ws'});
    console.log('ROUTER_READY');
  `;
  expect(execFileSync(process.execPath,['-e',script], {cwd:path.resolve(__dirname,'../..'),encoding:'utf8',timeout:5000})).toContain('ROUTER_READY');
});
