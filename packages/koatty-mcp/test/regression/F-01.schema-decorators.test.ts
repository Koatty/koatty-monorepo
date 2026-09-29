import 'reflect-metadata';
import ts from 'typescript';
import { Container } from 'koatty_container';
import { Validated } from 'koatty_validation';
import { IsJSON, IsPort, IsString, ValidateNested } from 'class-validator';
import { Tool, Resource, Prompt } from '../../src/decorators';
import { createRegistry } from '../../src/registry';
import { createMcpHost } from '../../src/server';
import { dtoToJsonSchema } from '../../src/schema';

class Input { @IsString() value!: string; }
class Nested { @ValidateNested() input!: Input; }
class Strings { @IsPort() port!: string; @IsJSON() json!: string; }

test('F-A19: schemas preserve string validator types and nested object shape', () => {
  expect(dtoToJsonSchema(Strings).properties).toMatchObject({ port: { type: 'string' }, json: { type: 'string' } });
  const nested = dtoToJsonSchema(Nested).properties.input;
  expect(nested).toMatchObject({ type: 'object', properties: { value: { type: 'string' } } });
  expect(nested.properties).not.toHaveProperty('type');
});

describe.each([true, false])('F-A18 actual decorator emit legacy=%s', legacy => {
  test.each(['Singleton', 'Prototype', 'Request'])('discovers and invokes %s without an eager instance', async scope => {
    let constructed = 0;
    const fixture = `export class Fixture {
      constructor(){ made(); }
      @Tool({name:'echo'}) @Validated({async:false,types:[Input]}) echo(input){return input;}
      @Validated({async:false,types:[Input]}) @Tool({name:'reverse'}) reverse(input){return input;}
      @Resource({uri:'item://{id}'}) resource(input){return input;}
      @Prompt({name:'prompt'}) prompt(){return 'prompt';}
    }`;
    const emitted = ts.transpileModule(fixture, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: legacy } }).outputText;
    const exports: any = {};
    new Function('exports', 'Tool', 'Resource', 'Prompt', 'Validated', 'Input', 'made', emitted)(exports, Tool, Resource, Prompt, Validated, Input, () => { constructed++; });
    Object.defineProperty(exports.Fixture.prototype, '_options', { value: { scope }, configurable: true });
    const container = new Container(); container.saveClass('SERVICE', exports.Fixture, 'Fixture');
    const registry = createRegistry({ container });
    expect(constructed).toBe(0);
    expect(registry.tools.map(t => t.name).sort()).toEqual(['echo', 'reverse']);
    expect(registry.tools.every(t => t.inputSchema.properties.value.type === 'string')).toBe(true);
    expect(registry.resources).toHaveLength(1); expect(registry.prompts).toHaveLength(1);
    const host = createMcpHost({ app: { container } });
    for (const name of ['echo', 'reverse']) {
      expect(await host.callTool(name, { value: 'ok', extra: true }, { principal: null, sessionId: 's', requestId: name, headers: {} })).toEqual({ value: 'ok' });
    }
    await container.clear();
  });
});
