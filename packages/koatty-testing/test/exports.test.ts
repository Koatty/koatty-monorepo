/**
 * Public surface self-test (QA-05, Phase E / E-4): the package must export the
 * helpers that generated projects and AGENTS.md tell AI assistants to use.
 */
import * as api from '../src/index';

describe('koatty_testing exports', () => {
  it('exposes the documented helpers', () => {
    for (const name of ['createTestApp', 'createHttpTest', 'mockBean', 'resetContainer', 'clearAll']) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
