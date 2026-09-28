/**
 * mockBean / resetContainer / clearAll self-tests (QA-05, Phase E / E-4).
 *
 * These are the smallest example of "点一个 bean 换成假实现" that generated
 * projects are pointed at from `AGENTS.md` and the module test skeleton.
 */
import { Container } from 'koatty_container';
import { mockBean, resetContainer, clearAll } from '../src/mockBean';

describe('mockBean', () => {
  const container = Container.getInstance();

  afterEach(() => {
    resetContainer();
  });

  afterAll(() => {
    clearAll();
  });

  it('intercepts container lookups by bean name', () => {
    class UserService {}
    // Unregistered beans are reported by the container itself.
    expect(() => container.get('UserService')).toThrow(/not found/);

    mockBean('UserService', { find: () => 'mocked' });

    const resolved = container.get<{ find: () => string }>('UserService');
    expect(resolved.find()).toBe('mocked');
    expect(UserService).toBeDefined();
  });

  it('returns the replacement again after an unmocked sibling stays untouched', () => {
    mockBean('CacheStore', { get: (key: string) => `cached:${key}` });
    mockBean('OtherStore', { get: (key: string) => `other:${key}` });

    expect(container.get<{ get: (k: string) => string }>('CacheStore').get('a')).toBe('cached:a');
    expect(container.get<{ get: (k: string) => string }>('OtherStore').get('b')).toBe('other:b');
  });

  it('resetContainer drops all mocks', () => {
    mockBean('UserService', { find: () => 'mocked' });
    expect(container.get<{ find: () => string }>('UserService').find()).toBe('mocked');

    resetContainer();

    expect(() => container.get('UserService')).toThrow(/not found/);
  });

  it('re-registering a mock replaces the previous implementation', () => {
    mockBean('UserService', { find: () => 'first' });
    mockBean('UserService', { find: () => 'second' });

    expect(container.get<{ find: () => string }>('UserService').find()).toBe('second');
  });
});
