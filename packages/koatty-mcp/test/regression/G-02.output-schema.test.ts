import 'reflect-metadata';
import { Container } from 'koatty_container';
import { Service } from 'koatty_core';
import { Tool } from '../../src/decorators';
import { createMcpHost } from '../../src/server';

@Service()
class ResultTools {
  @Tool({ name: 'bad', outputSchema: { type: 'object', required: ['count'], properties: { count: { type: 'integer' } } } })
  bad() { return { count: 'incorrect' }; }
  @Tool({ name: 'good', outputSchema: { type: 'object', required: ['count'], properties: { count: { type: 'integer' } } } })
  good() { return { count: 3 }; }
}

test('G-02 output schemas are enforced for internal Agent calls as well as MCP dispatch', async () => {
  const container = new Container();
  const app = { container };
  container.setApp(app as any);
  container.reg('ResultTools', ResultTools, { type: 'SERVICE' } as any);
  const records: any[] = [];
  const host = createMcpHost({ app, audit: { record: r => { records.push(r); } } });
  const identity: import('../../src/types').ToolCallIdentity = { principal: null, headers: {}, requestId: '1', sessionId: 'test' };
  await expect(host.callTool('bad', {}, identity)).rejects.toThrow('MCP_OUTPUT_INVALID');
  expect(records[0].status).toBe('error');
  await expect(host.callTool('good', {}, identity)).resolves.toEqual({ count: 3 });
  expect(records[1].status).toBe('success');
});
