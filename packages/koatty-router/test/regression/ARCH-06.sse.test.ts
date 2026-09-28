import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { encodeSSE, streamSSE } from '../../src/sse';
function context() {
  const res: any = new EventEmitter(); const chunks: string[] = [];
  res.setHeader = jest.fn(); res.write = jest.fn((s:string)=>{chunks.push(s);return true;});res.end=jest.fn();
  return {res,req:new EventEmitter(),chunks,respond:true};
}
test.each(['async','node','web'])('streams %s sources using ordinary response helper', async kind=>{
  const ctx=context();
  const source = kind==='node' ? Readable.from(['one','two']) : kind==='web' ? new ReadableStream({start(c){c.enqueue('one');c.enqueue('two');c.close();}}) : (async function*(){yield 'one';yield 'two';})();
  expect(await streamSSE(ctx,source,{heartbeatInterval:0})).toBe(2);
  expect(ctx.chunks.join('')).toBe('data: one\n\ndata: two\n\n');expect(ctx.respond).toBe(false);expect(ctx.res.end).toHaveBeenCalledTimes(1);
});
test('response close signals the producer and releases a pending next',async()=>{
  const ctx=context();let signal!:AbortSignal;
  const pending=streamSSE(ctx, s=>{signal=s;return (async function*(){await new Promise<void>(resolve=>s.addEventListener('abort',()=>resolve(),{once:true}));yield 'late';})();},{heartbeatInterval:0});
  await new Promise(resolve=>setImmediate(resolve));ctx.res.emit('close');
  expect(await pending).toBe(0);expect(signal.aborted).toBe(true);expect(ctx.res.end).not.toHaveBeenCalled();
});
test('write=false pauses pulling until drain',async()=>{
  const ctx=context();let pulled=0;ctx.res.write.mockReturnValueOnce(false);
  const pending=streamSSE(ctx,(async function*(){pulled++;yield 1;pulled++;yield 2;})(),{heartbeatInterval:0});
  await new Promise(resolve=>setImmediate(resolve));expect(pulled).toBe(1);expect(ctx.res.write).toHaveBeenCalledTimes(1);
  ctx.res.emit('drain');expect(await pending).toBe(2);expect(pulled).toBe(2);
});
test('disconnect releases a response waiting for drain',async()=>{
  const ctx=context();ctx.res.write.mockReturnValue(false);
  const pending=streamSSE(ctx,Readable.from(['one','two']),{heartbeatInterval:0});
  await new Promise(resolve=>setImmediate(resolve));ctx.res.emit('close');await pending;expect(ctx.res.listenerCount('drain')).toBe(0);
});
test('encoder handles CR and rejects frame injection',()=>{
  expect(encodeSSE({data:'a\rb\r\nc'})).toBe('data: a\ndata: b\ndata: c\n\n');
  expect(()=>encodeSSE({id:'x\nevent: evil'})).toThrow();expect(()=>encodeSSE({retry:-1})).toThrow();
});
