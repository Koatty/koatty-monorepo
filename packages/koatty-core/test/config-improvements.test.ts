/**
 * Test cases for improved config function
 * Demonstrates all security and performance enhancements
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { Koatty } from '../src/Application';

describe('Improved config() function', () => {
  let app: any;

  beforeEach(() => {
    // Initialize a test app instance
    app = new (Koatty as any)({
      appDebug: true,
      appPath: __dirname,
      rootPath: __dirname,
      koattyPath: __dirname,
      name: 'TestApp',
      version: '1.0.0'
    });
  });

  describe('Security: Prototype Pollution Protection', () => {
    it('should block __proto__ injection', () => {
      const result = app.config('__proto__.isAdmin', 'config', true);
      expect(result).toBeNull();
      
      // Verify pollution didn't occur
      expect((Object.prototype as any).isAdmin).toBeUndefined();
    });

    it('should block prototype injection', () => {
      const result = app.config('prototype.polluted', 'config', 'hacked');
      expect(result).toBeNull();
    });

    it('should block constructor injection', () => {
      const result = app.config('constructor', 'config', 'malicious');
      expect(result).toBeNull();
    });

    it('should block case-insensitive pollution attempts', () => {
      const result = app.config('__PROTO__.admin', 'config', true);
      expect(result).toBeNull();
    });
  });

  describe('Type Conflict Detection', () => {
    it('should prevent overwriting primitive with nested config', () => {
      // Set a primitive value
      app.config('server', 'config', 'production');
      expect(app.config('server')).toBe('production');

      // Try to set nested property - should fail
      const result = app.config('server.port', 'config', 3000);
      expect(result).toBeNull();

      // Original value should be preserved
      expect(app.config('server')).toBe('production');
    });

    it('should prevent overwriting number with nested config', () => {
      app.config('timeout', 'config', 5000);
      const result = app.config('timeout.value', 'config', 3000);
      
      expect(result).toBeNull();
      expect(app.config('timeout')).toBe(5000);
    });

    it('should allow setting nested config when parent is object', () => {
      app.config('database', 'config', { host: 'localhost' });
      const result = app.config('database.port', 'config', 3306);
      
      expect(result).toBe(3306);
      expect(app.config('database.port')).toBe(3306);
      expect(app.config('database.host')).toBe('localhost');
    });
  });

  describe('Boundary Case Handling', () => {
    it('should handle empty string key', () => {
      const result = app.config('', 'config', 'value');
      expect(result).toBeNull();
    });

    it('should handle leading dots', () => {
      app.config('.database.host', 'config', 'localhost');
      // Should be treated as 'database.host'
      expect(app.config('database.host')).toBe('localhost');
    });

    it('should handle trailing dots', () => {
      app.config('database.host.', 'config', 'localhost');
      // Should be treated as 'database.host'
      expect(app.config('database.host')).toBe('localhost');
    });

    it('should handle consecutive dots', () => {
      app.config('database..host', 'config', 'localhost');
      // Should be treated as 'database.host'
      expect(app.config('database.host')).toBe('localhost');
    });

    it('should handle whitespace in keys', () => {
      app.config(' database . host ', 'config', 'localhost');
      // Should be treated as 'database.host'
      expect(app.config('database.host')).toBe('localhost');
    });

    it('should handle non-string name (number)', () => {
      const result = app.config(123 as any, 'config', 'value');
      // Should still work but log warning
      expect(result).toBe('value');
    });
  });

  describe('Nested Level Limits', () => {
    it('should support 1-level config', () => {
      app.config('port', 'config', 3000);
      expect(app.config('port')).toBe(3000);
    });

    it('should support 2-level config', () => {
      app.config('database.host', 'config', 'localhost');
      expect(app.config('database.host')).toBe('localhost');
    });

    it('should handle 3+ levels with warning (use first 2 levels)', () => {
      // Should log warning and use only 'redis.cluster'
      app.config('redis.cluster.nodes.0', 'config', 'node1');
      
      // Access using 2 levels
      expect(app.config('redis.cluster')).toBe('node1');
    });
  });

  describe('Performance Optimization', () => {
    it('should cache config reference for repeated access', () => {
      // First access initializes cache
      app.config('test1', 'config', 'value1');
      
      // Subsequent accesses should use cached reference
      app.config('test2', 'config', 'value2');
      app.config('test3', 'config', 'value3');
      
      expect(app.config('test1')).toBe('value1');
      expect(app.config('test2')).toBe('value2');
      expect(app.config('test3')).toBe('value3');
    });

    it('should perform well with high-frequency reads', () => {
      app.config('database.host', 'config', 'localhost');
      
      const startTime = Date.now();
      for (let i = 0; i < 10000; i++) {
        app.config('database.host');
      }
      const elapsed = Date.now() - startTime;
      
      // Should complete in reasonable time (< 100ms for 10000 reads)
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('Normal Usage', () => {
    it('should get/set single-level config', () => {
      app.config('port', 'config', 3000);
      expect(app.config('port')).toBe(3000);
    });

    it('should get/set nested config', () => {
      app.config('database.host', 'config', 'localhost');
      app.config('database.port', 'config', 3306);
      
      expect(app.config('database.host')).toBe('localhost');
      expect(app.config('database.port')).toBe(3306);
    });

    it('should get entire config type', () => {
      app.config('key1', 'config', 'value1');
      app.config('key2', 'config', 'value2');
      
      const allConfig = app.config();
      expect(allConfig.key1).toBe('value1');
      expect(allConfig.key2).toBe('value2');
    });

    it('should set entire config type', () => {
      app.config(undefined, 'middleware', { list: ['trace', 'logger'] });
      
      const middleware = app.config(undefined, 'middleware');
      expect(middleware.list).toEqual(['trace', 'logger']);
    });

    it('should return null for non-existent config', () => {
      const result = app.config('nonexistent');
      expect(result).toBeNull();
    });

    it('should handle different config types', () => {
      app.config('timeout', 'config', 5000);
      app.config('timeout', 'middleware', 3000);
      
      expect(app.config('timeout', 'config')).toBe(5000);
      expect(app.config('timeout', 'middleware')).toBe(3000);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle object values correctly', () => {
      const dbConfig = {
        host: 'localhost',
        port: 3306,
        user: 'root'
      };
      
      app.config('database', 'config', dbConfig);
      expect(app.config('database')).toEqual(dbConfig);
    });

    it('should handle null and undefined values', () => {
      app.config('nullable', 'config', null);
      expect(app.config('nullable')).toBeNull();
      
      // undefined means "get", not "set"
      const result = app.config('undefined_test', 'config', undefined);
      expect(result).toBeUndefined();
    });

    it('should maintain independence between config types', () => {
      app.config('value', 'config', 'config-value');
      app.config('value', 'middleware', 'middleware-value');
      app.config('value', 'plugin', 'plugin-value');
      
      expect(app.config('value', 'config')).toBe('config-value');
      expect(app.config('value', 'middleware')).toBe('middleware-value');
      expect(app.config('value', 'plugin')).toBe('plugin-value');
    });
  });
});
