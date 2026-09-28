import { Container } from 'koatty_container';
import { Config } from '../../src/config';
import { EventEmitter } from 'events';
class Configured { @Config('name') name: string; }
test('Config reads the injected instance application, not the default IOC application', async () => {
  const a = new Container(), b = new Container();
  a.setApp(Object.assign(new EventEmitter(), {config: () => 'a'}) as any);
  b.setApp(Object.assign(new EventEmitter(), {config: () => 'b'}) as any);
  a.reg(Configured); b.reg(Configured);
  expect(a.get<Configured>('Configured').name).toBe('a'); expect(b.get<Configured>('Configured').name).toBe('b');
  await Promise.all([a.clear(),b.clear()]);
});

import ts from 'typescript';
test.each([true, false])('compiled Config fields stay app-local in Legacy=%s', async legacy => {
  const source = `export class ConfiguredMatrix { @Config('name') name; @Config() region; }`;
  const result = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:legacy},reportDiagnostics:true});
  expect(result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)).toEqual([]);
  const exports:any={};new Function('exports','Config',result.outputText)(exports,Config);
  const containers=[new Container(),new Container()];
  try {
    for (const [i,c] of containers.entries()) {
      c.setApp({config:(key:string)=>`${i}:${key}`} as any);c.reg(exports.ConfiguredMatrix,{scope:'Prototype'});
      const first:any=c.get('ConfiguredMatrix'),second:any=c.get('ConfiguredMatrix');
      expect(first.name).toBe(`${i}:name`);expect(first.region).toBe(`${i}:region`);
      expect(first).not.toBe(second);expect(second.name).toBe(first.name);
    }
  } finally {for(const c of containers)await c.clear();}
});
