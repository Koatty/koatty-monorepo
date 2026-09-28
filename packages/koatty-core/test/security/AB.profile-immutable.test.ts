import { resolveProfile } from '../../src/security/profile';
test('AB-14: every policy section is immutable', () => {
  const profile = resolveProfile(null, 'production');
  for (const section of ['payload','validation','aop','graphql','ws','ops','tls']) {
    expect(Object.isFrozen((profile as any)[section])).toBe(true);
  }
  expect(() => { (profile as any).validation.whitelist = false; }).toThrow();
  expect(profile.validation.whitelist).toBe(true);
});
