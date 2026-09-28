import { execFileSync } from 'child_process';
import path from 'path';

test('idle metrics and span maintenance do not prevent process exit', () => {
  const root = path.resolve(__dirname, '../..');
  const script = `
    const ts = require('typescript'), fs = require('fs');
    require.extensions['.ts'] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'), {
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,experimentalDecorators:true}
    }).outputText,file);
    require('koatty_logger').DefaultLogger.enable(false);
    const {MeterProvider} = require('@opentelemetry/sdk-metrics');
    const {MetricsCollector} = require('./src/opentelemetry/prometheus.ts');
    const {SpanManager} = require('./src/opentelemetry/spanManager.ts');
    new MetricsCollector(new MeterProvider(), 'idle-test');
    new SpanManager({enableTrace:true});
    console.log('COLLECTORS_READY');
  `;
  expect(execFileSync(process.execPath, ['-e',script], {cwd:root,encoding:'utf8',timeout:5000})).toContain('COLLECTORS_READY');
});
