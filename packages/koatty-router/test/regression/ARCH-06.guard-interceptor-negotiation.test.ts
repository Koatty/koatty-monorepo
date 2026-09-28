// ADR-108: authentication uses existing middleware; response wrapping uses AOP.
import { prefersJson, negotiateError, errorNegotiation } from '../../src/negotiation';
import { createRouteHandler } from '../../src/utils/handler';
test.each([
 ['application/json',true],['application/json;q=0, text/plain;q=1',false],
 ['text/plain;q=.1, application/json;q=.9',true],['*/*',false],['',false],
])('Accept %s negotiates JSON=%s',(accept,json)=>{expect(prefersJson({headers:{accept}} as any)).toBe(json);});
test('internal errors are redacted',()=>{expect(negotiateError({headers:{accept:'application/json'}} as any,new Error('secret')).body).not.toContain('secret');});
test('existing middleware rejects before parameter extraction or business',async()=>{
 const method=jest.fn();const ctx:any={throw:(status:number)=>{throw Object.assign(new Error('denied'),{status});}};
 const invoke=createRouteHandler({} as any,'work', [{ sourceType:'invalid' }] as any,undefined,async c=>c.throw(403));
 await expect(invoke(ctx,{work:method})).rejects.toMatchObject({status:403});expect(method).not.toHaveBeenCalled();
});
test('non-HTTP errors are not rewritten',async()=>{
 const error=new Error('grpc');const ctx:any={protocol:'grpc',headers:{accept:'application/json'}};
 await expect(errorNegotiation()(ctx,async()=>{throw error;})).rejects.toBe(error);
});

test('respond=false on gRPC still preserves the controller response body', async () => {
  const ctx: any = { protocol: 'grpc', respond: false, body: undefined };
  const invoke = createRouteHandler({} as any, 'unary');
  expect(await invoke(ctx, { unary: () => ({value:'ok'}) })).toEqual({value:'ok'});
  expect(ctx.body).toEqual({value:'ok'});
});
