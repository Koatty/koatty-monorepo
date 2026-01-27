/**
 * Circuit Breaker Integration Tests
 */

import { Koatty } from "../src/Application";

describe('Application Circuit Breaker Integration', () => {
  let app: Koatty;

  beforeEach(() => {
    app = new Koatty();
  });

  afterEach(async () => {
    // Clean up all circuit breakers
    const stats = app.getCircuitBreakersStats();
    Object.keys(stats).forEach(name => {
      app.removeCircuitBreaker(name);
    });

    // Stop server only if it was started
    if (app.server) {
      await new Promise<void>((resolve) => {
        app.stop(() => {
          resolve();
        });
      });
    }
  });

  describe('Circuit Breaker Management', () => {
    test('should create circuit breaker with default config', () => {
      const breaker = app.getCircuitBreaker('test-service');
      expect(breaker).toBeDefined();
      expect(breaker.getStats().state).toBe('closed');
    });

    test('should create circuit breaker with custom config', () => {
      const breaker = app.getCircuitBreaker('test-service', {
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 500
      });

      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
    });

    test('should return same circuit breaker instance for same name', () => {
      const breaker1 = app.getCircuitBreaker('test-service');
      const breaker2 = app.getCircuitBreaker('test-service');
      expect(breaker1).toBe(breaker2);
    });

    test('should create different circuit breaker for different names', () => {
      const breaker1 = app.getCircuitBreaker('service-1');
      const breaker2 = app.getCircuitBreaker('service-2');
      expect(breaker1).not.toBe(breaker2);
    });
  });

  describe('withCircuitBreaker', () => {
    test('should execute successful function through circuit breaker', async () => {
      const result = await app.withCircuitBreaker('test-service', async () => {
        return 'success';
      });

      expect(result).toBe('success');
    });

    test('should handle function errors and record failures', async () => {
      const failingFn = async () => {
        throw new Error('Service unavailable');
      };

      for (let i = 0; i < 5; i++) {
        try {
          await app.withCircuitBreaker('test-service', failingFn);
        } catch {
          // Expected
        }
      }

      const breaker = app.getCircuitBreaker('test-service');
      const stats = breaker.getStats();
      expect(stats.state).toBe('open');
      expect(stats.failureCount).toBe(5);
    });

    test('should throw CircuitBreakerOpenError when circuit is open', async () => {
      const failingFn = async () => {
        throw new Error('Service unavailable');
      };

      // Trigger circuit open
      for (let i = 0; i < 5; i++) {
        try {
          await app.withCircuitBreaker('test-service', failingFn);
        } catch {
          // Expected
        }
      }

      // Try to execute while circuit is open
      try {
        await app.withCircuitBreaker('test-service', failingFn);
        fail('Should have thrown CircuitBreakerOpenError');
      } catch (error: any) {
        expect(error.name).toBe('CircuitBreakerOpenError');
        expect(error.message).toContain('Circuit breaker is OPEN');
      }
    });

    test('should recover after successful requests in half-open state', async () => {
      const failingFn = async () => {
        throw new Error('Service unavailable');
      };

      const successFn = async () => 'success';

      // Configure short timeout for testing
      const breaker = app.getCircuitBreaker('test-service', {
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 100
      });

      // Trigger circuit open
      try {
        await app.withCircuitBreaker('test-service', failingFn);
      } catch {
        // Expected
      }
      try {
        await app.withCircuitBreaker('test-service', failingFn);
      } catch {
        // Expected
      }

      expect(breaker.getStats().state).toBe('open');

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Execute successful requests to close circuit
      await app.withCircuitBreaker('test-service', successFn);
      await app.withCircuitBreaker('test-service', successFn);

      expect(breaker.getStats().state).toBe('closed');
    });
  });

  describe('Circuit Breaker Statistics', () => {
    test('should return statistics for all circuit breakers', async () => {
      // Create multiple circuit breakers
      await app.withCircuitBreaker('service-1', async () => 'success');
      await app.withCircuitBreaker('service-2', async () => {
        throw new Error('fail');
      }).catch(() => {});

      const stats = app.getCircuitBreakersStats();

      expect(stats['service-1']).toBeDefined();
      expect(stats['service-2']).toBeDefined();
      expect(stats['service-1'].totalRequests).toBe(1);
      expect(stats['service-2'].failureCount).toBe(1);
    });
  });

  describe('Circuit Breaker Management Methods', () => {
    test('should reset specific circuit breaker', async () => {
      const failingFn = async () => {
        throw new Error('fail');
      };

      // Trigger failures
      for (let i = 0; i < 5; i++) {
        try {
          await app.withCircuitBreaker('test-service', failingFn);
        } catch {
          // Expected
        }
      }

      const breaker = app.getCircuitBreaker('test-service');
      expect(breaker.getStats().state).toBe('open');

      // Reset
      app.resetCircuitBreaker('test-service');

      expect(breaker.getStats().state).toBe('closed');
      expect(breaker.getStats().failureCount).toBe(0);
    });

    test('should remove specific circuit breaker', async () => {
      const breaker = app.getCircuitBreaker('test-service');
      expect(breaker).toBeDefined();

      // Remove
      app.removeCircuitBreaker('test-service');

      // Verify it's removed (new instance should be created)
      const newBreaker = app.getCircuitBreaker('test-service');
      expect(newBreaker).not.toBe(breaker);
    });
  });
});
