import { buildSchema, parse, validate } from 'graphql';
import { createQueryDepthLimitRule } from '../../src/router/graphql';
test('AB-06: repeated acyclic fragments are visited within a linear budget', () => {
  let query='query { ...F0 } ';
  for(let i=0;i<15;i++) query+=`fragment F${i} on Query { ...F${i+1} ...F${i+1} } `;
  query+='fragment F15 on Query { a }';
  const document=parse(query); let visits=0;
  for(const def of document.definitions) {
    if(def.kind==='FragmentDefinition') {
      const selectionSet=def.selectionSet;
      Object.defineProperty(def,'selectionSet',{get(){ if(++visits>200) throw new Error('fragment traversal budget exceeded'); return selectionSet; }});
    }
  }
  expect(validate(buildSchema('type Query { a: String }'),document,[createQueryDepthLimitRule(10)])).toEqual([]);
  expect(visits).toBeLessThan(200);
});
