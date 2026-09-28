import 'reflect-metadata';
import { ClassValidator, KoattyValidationError } from 'koatty_validation';
import { detectExtractionStrategy, ExtractionStrategy, StrategyHandlerFactory } from '../../src/utils/strategy-extractor';
import { ParamSourceType } from '../../src/utils/inject';
class Dto {}
const dto = {index:0,name:'body',type:'Dto',isDto:true,clazz:Dto,dtoCheck:true,sourceType:ParamSourceType.BODY,fn:async()=>({}),options:{}};
afterEach(()=>jest.restoreAllMocks());
test.each([ExtractionStrategy.SYNC_DTO_NO_VALIDATION,ExtractionStrategy.SYNC_DTO_WITH_VALIDATION,ExtractionStrategy.ASYNC_DTO_VALIDATION])('DTO validation is HTTP 400 in %s',async strategy=>{
  jest.spyOn(ClassValidator,'valid').mockRejectedValue(new KoattyValidationError([{field:'name',value:undefined,constraint:'IsNotEmpty',message:'required'}],'required'));
  const handler=StrategyHandlerFactory.createHandler(strategy,[dto] as any,{} as any);
  await expect(handler({} as any,[dto] as any)).rejects.toMatchObject({status:400,message:'required'});
});
test('id followed by DTO uses the mixed handler rather than treating id as a class',()=>{
  const params=[{index:0,name:'id',type:'number',isDto:false,sourceType:ParamSourceType.QUERY},{...dto,index:1}];
  expect(detectExtractionStrategy(params as any)).toBe(ExtractionStrategy.ASYNC_MIXED_PARAMS);
});
test('internal validation infrastructure errors are not reclassified as bad requests',async()=>{
  const bug=Error('infrastructure failure');jest.spyOn(ClassValidator,'valid').mockRejectedValue(bug);
  const handler=StrategyHandlerFactory.createHandler(ExtractionStrategy.ASYNC_DTO_VALIDATION,[dto] as any,{} as any);
  await expect(handler({} as any,[dto] as any)).rejects.toBe(bug);
});
