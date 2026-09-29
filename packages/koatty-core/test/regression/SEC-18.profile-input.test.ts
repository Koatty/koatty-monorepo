import { resolveProfile, resolveProfileName } from '../../src/security/profile';
test('P2 environment selection uses complete names', () => {
  expect(resolveProfileName('latest')).toBe('standard'); expect(resolveProfileName('devops')).toBe('standard'); expect(resolveProfileName('production')).toBe('strict');
});
test('P2 security input rejects unknown, unsafe and invalid values without prototype mutation', () => {
  for (const options of [{ profile: '__proto__' }, { ws: { checkOrigin: 'false' } }, { ops: { exposeMetrics: 'yes' } }, JSON.parse('{"ws":{"__proto__":{"checkOrigin":false}}}')]) expect(() => resolveProfile(options as any)).toThrow(/security/);
  expect(resolveProfile({}, 'production').ws.checkOrigin).toBe(true);
});
