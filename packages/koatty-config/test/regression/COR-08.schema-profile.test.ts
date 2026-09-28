import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LoadConfigs, validateConfig } from '../../src';

test('JSON Schema validates nested fields and applies defaults', () => {
  const schema = { type: 'object', properties: { config: { type: 'object', properties: {
    port: { type: 'integer' }, enabled: { type: 'boolean', default: true }
  }, required: ['port'] } }, required: ['config'] };
  expect(validateConfig({ config: { port: 'bad' } }, schema).valid).toBe(false);
  const config = { config: { port: 123 } };
  expect(validateConfig(config, schema).valid).toBe(true);
  expect((config.config as any).enabled).toBe(true);
  expect(validateConfig({}, false).valid).toBe(false);
});

test('explicit strict wins in development; explicit standard wins in production', () => {
  const dir = mkdtempSync(join(tmpdir(), 'koatty-profile-'));
  const old = process.env.NODE_ENV;
  const oldKoatty = process.env.KOATTY_ENV;
  delete process.env.KOATTY_ENV;
  delete process.env.COR08_MISSING;
  try {
    writeFileSync(join(dir, 'config.js'), "module.exports = { security: { profile: 'strict' }, urls: ['${COR08_MISSING}'] }");
    process.env.NODE_ENV = 'development';
    expect(() => LoadConfigs([dir], dir)).toThrow(/COR08_MISSING/);
    const strictModule = require(join(dir, 'config.js'));
    strictModule.security.profile = 'standard';
    process.env.NODE_ENV = 'production';
    expect(LoadConfigs([dir], dir).config.urls).toEqual(['']);
  } finally {
    if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old;
    if (oldKoatty === undefined) delete process.env.KOATTY_ENV; else process.env.KOATTY_ENV = oldKoatty;
    rmSync(dir, { recursive: true, force: true });
  }
});
