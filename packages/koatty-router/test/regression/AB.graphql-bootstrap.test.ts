jest.mock('graphql-query-complexity',()=>{throw new Error('missing optional dependency')},{virtual:true});
jest.mock('../../src/utils/inject',()=>({injectRouter:async()=>({a:{method:'a',ctlPath:'/graphql'}}),injectParamMetaData:()=>({})}));
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { IOC } from 'koatty_container';
import { GraphQLRouter } from '../../src/router/graphql';
test('AB-05: missing security dependency rejects the complete router load',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'koatty-ab-gql-'));
  const spy=jest.spyOn(IOC,'getClass').mockReturnValue(class C{} as any);
  try {
    await fs.writeFile(path.join(dir,'schema.gql'),'type Query { a: String }');
    const app:any={rootPath:dir,security:{graphql:{complexityLimit:1000,depthLimit:10,introspection:false}},use:jest.fn()};
    const router=new GraphQLRouter(app,{protocol:'graphql',ext:{schemaFile:'schema.gql'}});
    await expect(router.LoadRouter(app,['C'])).rejects.toThrow(/graphql-query-complexity/);
    expect(app.use).not.toHaveBeenCalled();
  } finally {spy.mockRestore();await fs.rm(dir,{recursive:true,force:true});}
});
