const fs=require('fs'),path=require('path'),os=require('os'),{createRequire}=require('module');
const repo=path.resolve(__dirname,'../../..'),cli=path.join(repo,'packages/koatty-ai');const req=createRequire(path.join(cli,'package.json'));
const {callTool}=require(path.join(cli,'dist/mcp/tools'));
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'koatty-e-test-runner-'));fs.mkdirSync(path.join(root,'test'));
 fs.mkdirSync(path.join(root,'node_modules/.bin'),{recursive:true});fs.writeFileSync(path.join(root,'node_modules/.bin/jest'),'#!/usr/bin/env node\nrequire('+JSON.stringify(req.resolve('jest/bin/jest'))+');',{mode:0o755});
 fs.writeFileSync(path.join(root,'package.json'),'{}');fs.writeFileSync(path.join(root,'jest.config.cjs'),`module.exports={testEnvironment:'node',maxWorkers:1,testTimeout:10000};`);
 fs.writeFileSync(path.join(root,'test/slow.test.js'),`test('slow',async()=>{require('fs').writeFileSync('started.txt','yes');await new Promise(r=>setTimeout(r,2500));require('fs').writeFileSync('after-timeout.txt','yes')});`);
 const started=Date.now();const result=await callTool('koatty_test',{file:'test/slow.test.js',timeoutMs:1500},{root});
 console.log(JSON.stringify({root,elapsedMs:Date.now()-started,started:fs.existsSync(path.join(root,'started.txt')),afterTimeout:fs.existsSync(path.join(root,'after-timeout.txt')),result},null,2));
 await new Promise(r=>setTimeout(r,3500));console.log('AFTER_WAIT',fs.existsSync(path.join(root,'after-timeout.txt')));
})().catch(e=>{console.error(e);process.exitCode=1});
