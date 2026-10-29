import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'node_modules/koatty_ai/package.json'));
const { Client }=require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport }=require('@modelcontextprotocol/sdk/client/stdio.js');
const client=new Client({name:'mirror-acceptance',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'node_modules/koatty_ai/dist/cli/index.js'),'mcp'],cwd:root,stderr:'pipe'});
try {
  await client.connect(transport);
  const listed=await client.listTools();
  for(const name of ['koatty_ai_context','koatty_ai_check','koatty_ai_plan']) assert.ok(listed.tools.some(tool=>tool.name===name));
  for(const name of ['koatty_ai_context','koatty_ai_check']) {
    const response=await client.callTool({name,arguments:{root}});
    assert.ok(!response.isError);
    const envelope=response.structuredContent || JSON.parse(response.content.find(item=>item.type==='text').text);
    assert.equal(envelope.status,'completed');
    if(name==='koatty_ai_check') assert.equal(envelope.data.counts.error,0);
  }
  console.log('STDIO_MCP_OK: actual child process, tool discovery, project context and framework checks.');
} finally { await client.close(); }
