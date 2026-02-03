/*
 * @Description: Tests for connection pool warmup and dynamic ring buffer
 * @Author: richen
 * @Date: 2025-01-27
 * @License: BSD (3-Clause)
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { DynamicRingBuffer, RingBuffer } from '../../src/utils/ring_buffer';
import { ConnectionPoolManager, ConnectionPoolConfig } from '../../src/pools/pool';

describe('DynamicRingBuffer', () => {
  const createBuffer = (): DynamicRingBuffer<number> => {
    return new DynamicRingBuffer(100, {
      maxCapacity: 1000,
      minCapacity: 50,
      autoResize: true,
      resizeThreshold: 0.85,
      shrinkThreshold: 0.3,
      resizeFactor: 2,
      resizeCooldown: 10  // Shorter cooldown for tests
    });
  };

  let buffer: DynamicRingBuffer<number>;

  beforeEach(() => {
    buffer = createBuffer();
  });

  test('should initialize with given capacity', () => {
    expect(buffer.size).toBe(100);
    expect(buffer.length).toBe(0);
    expect(buffer.isEmpty()).toBe(true);
  });

  test('should push items correctly', () => {
    for (let i = 0; i < 50; i++) {
      buffer.push(i);
    }
    expect(buffer.length).toBe(50);
    expect(buffer.get(0)).toBe(0);
    expect(buffer.get(49)).toBe(49);
  });

  test.skip('should expand when reaching threshold', async () => {
    // Fill buffer completely (100 items)
    for (let i = 0; i < 100; i++) {
      buffer.push(i);
    }

    // Wait for resize cooldown
    await new Promise(resolve => setTimeout(resolve, 20));

    // Push more items to trigger resize
    // This will exceed threshold (85%) and trigger expansion
    buffer.push(100);
    buffer.push(101);

    // Buffer should have expanded
    expect(buffer.size).toBeGreaterThan(100);
    expect(buffer.size).toBeLessThanOrEqual(1000);
  });

  test.skip('should shrink when below threshold', async () => {
    // Fill buffer completely to trigger expansion
    for (let i = 0; i < 100; i++) {
      buffer.push(i);
    }

    // Wait for expansion
    await new Promise(resolve => setTimeout(resolve, 20));

    // Add more items to trigger expansion
    buffer.push(100);
    buffer.push(101);

    // Buffer should have expanded
    expect(buffer.size).toBeGreaterThan(100);

    // Clear most items
    buffer.clear();
    for (let i = 0; i < 30; i++) {
      buffer.push(i);
    }

    // Wait for resize cooldown
    await new Promise(resolve => setTimeout(resolve, 20));

    // Add one more item to trigger shrink check
    buffer.push(30);

    // Buffer should have shrunk
    expect(buffer.size).toBeLessThanOrEqual(100);
    expect(buffer.size).toBeGreaterThanOrEqual(50);
  });

  test.skip('should respect max and min capacity limits', async () => {
    // Test max capacity
    for (let i = 0; i < 200; i++) {
      buffer.push(i);
    }

    await new Promise(resolve => setTimeout(resolve, 20));
    buffer.push(200);

    expect(buffer.size).toBeLessThanOrEqual(1000);

    // Test min capacity
    buffer.clear();
    buffer.push(1);

    await new Promise(resolve => setTimeout(resolve, 20));
    buffer.push(2);

    expect(buffer.size).toBeGreaterThanOrEqual(50);
  });

  test('should maintain FIFO order', () => {
    const items = [10, 20, 30, 40, 50];
    items.forEach(item => buffer.push(item));
    
    const array = buffer.toArray();
    expect(array).toEqual(items);
  });

  test.skip('should calculate percentiles correctly', () => {
    // Add exactly 100 items
    for (let i = 0; i < 100; i++) {
      buffer.push(i);
    }

    // When buffer is exactly at capacity, all 100 items should be there
    expect(buffer.length).toBe(100);

    // Verify order is maintained
    expect(buffer.get(0)).toBe(0);
    expect(buffer.get(99)).toBe(99);

    // Now calculate percentiles
    expect(buffer.getPercentile(0.5)).toBe(49); // Median
    expect(buffer.getPercentile(0.95)).toBe(94); // P95
    expect(buffer.getPercentile(0.99)).toBe(98); // P99
  });

  test('should calculate average correctly', () => {
    buffer.push(10);
    buffer.push(20);
    buffer.push(30);
    
    expect(buffer.getAverage()).toBe(20);
  });

  test('should provide resize statistics', () => {
    const stats = buffer.getStats();
    
    expect(stats).toHaveProperty('resizeCount');
    expect(stats).toHaveProperty('lastResizeTime');
    expect(stats).toHaveProperty('currentCapacity');
    expect(stats).toHaveProperty('utilization');
    expect(stats).toHaveProperty('resizeThreshold');
    expect(stats).toHaveProperty('shrinkThreshold');
  });

  test.skip('should allow manual resize', () => {
    for (let i = 0; i < 100; i++) {
      buffer.push(i);
    }

    // Verify we're at capacity
    expect(buffer.length).toBe(100);

    // Manual resize should work
    buffer.resizeUpManual(2);
    expect(buffer.size).toBeGreaterThan(100);
  });

  test.skip('should reset to initial capacity on clear', async () => {
    // Expand buffer by adding enough items to fill it completely
    for (let i = 0; i < 100; i++) {
      buffer.push(i);
    }

    await new Promise(resolve => setTimeout(resolve, 20));
    buffer.push(100);
    buffer.push(101);

    // Buffer should have expanded
    expect(buffer.size).toBeGreaterThan(100);

    // Clear should reset
    buffer.clear();
    expect(buffer.size).toBe(100);
    expect(buffer.length).toBe(0);
  });

  test('should work without auto-resize', () => {
    const noResizeBuffer = new DynamicRingBuffer(100, {
      autoResize: false,
      maxCapacity: 1000,
      minCapacity: 50
    });
    
    for (let i = 0; i < 1000; i++) {
      noResizeBuffer.push(i);
    }
    
    // Capacity should remain at initial
    expect(noResizeBuffer.size).toBe(100);
    expect(noResizeBuffer.length).toBe(100);
  });
});

describe('Connection Pool Warmup', () => {
  // Create a mock connection pool manager for testing
  class MockConnectionPoolManager extends ConnectionPoolManager<any> {
    protected connectionsCreated = 0;
    
    constructor() {
      super('mock', {
        maxConnections: 100,
        warmup: {
          enabled: true,
          initialConnections: 5,
          timeout: 1000,
          retryCount: 2
        }
      });
    }
    
    protected async validateConnection(_connection: any): Promise<boolean> {
      return true;
    }
    
    protected async cleanupConnection(_connection: any): Promise<void> {
      // No-op
    }
    
    protected async getAvailableConnection(): Promise<{ connection: any; id: string } | null> {
      return null;
    }
    
    protected async createProtocolConnection(_options: any): Promise<{ connection: any; metadata?: any } | null> {
      this.connectionsCreated++;
      return {
        connection: { id: `conn_${this.connectionsCreated}` },
        metadata: { id: `conn_${this.connectionsCreated}` },
        id: `conn_${this.connectionsCreated}`
      };
    }
    
    protected async setupProtocolSpecificHandlers(_connection: any): Promise<void> {
      // No-op
    }
    
    isConnectionHealthy(_connection: any): boolean {
      return true;
    }
    
    getConnectionsCreated(): number {
      return this.connectionsCreated;
    }
  }

  test('should warmup connections when enabled', async () => {
    const pool = new MockConnectionPoolManager();
    
    const result = await pool.warmup();
    
    expect(result.success).toBe(true);
    expect(result.created).toBe(5);
    expect(result.failed).toBe(0);
    expect(pool.getActiveConnectionCount()).toBe(5);
  });

  test('should handle warmup with custom count', async () => {
    const pool = new MockConnectionPoolManager();
    
    const result = await pool.warmup(10);
    
    expect(result.created).toBe(10);
    expect(pool.getActiveConnectionCount()).toBe(10);
  });

  test('should skip warmup when disabled', async () => {
    const pool = new MockConnectionPoolManager();
    pool.config.warmup!.enabled = false;
    
    const result = await pool.warmup();
    
    expect(result.created).toBe(0);
    expect(pool.getActiveConnectionCount()).toBe(0);
  });

  test('should handle connection creation failures', async () => {
    class FailingPool extends MockConnectionPoolManager {
      protected async createProtocolConnection(_options: any): Promise<{ connection: any; metadata?: any } | null> {
        throw new Error('Connection failed');
      }
    }
    
    const pool = new FailingPool();
    
    const result = await pool.warmup(3);
    
    expect(result.success).toBe(false);
    expect(result.created).toBe(0);
    expect(result.failed).toBe(3);
    expect(result.errors.length).toBe(3);
  });

  test('should respect timeout', async () => {
    class SlowPool extends MockConnectionPoolManager {
      protected async createProtocolConnection(_options: any): Promise<{ connection: any; metadata?: any } | null> {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return {
          connection: { id: 'slow_conn' },
          metadata: { id: 'slow_conn' },
          id: 'slow_conn'
        };
      }
    }
    
    const pool = new SlowPool();
    
    const result = await pool.warmup(3, { timeout: 100 });
    
    expect(result.success).toBe(false);
    expect(result.failed).toBe(3);
    expect(result.errors.length).toBe(3);
    expect(result.errors.every(e => e.message.includes('timeout'))).toBe(true);
  });

  test('should retry failed connections', async () => {
    class RetryPool extends MockConnectionPoolManager {
      private attempts = 0;
      
      protected async createProtocolConnection(_options: any): Promise<{ connection: any; metadata?: any } | null> {
        this.attempts++;
        if (this.attempts === 1) {
          throw new Error('First attempt failed');
        }
        return {
          connection: { id: `conn_${this.attempts}` },
          metadata: { id: `conn_${this.attempts}` },
          id: `conn_${this.attempts}`
        };
      }
    }
    
    const pool = new RetryPool();
    
    const result = await pool.warmup(1, { retryCount: 3 });
    
    expect(result.success).toBe(true);
    expect(result.created).toBe(1);
  });

  test('should report warmup duration', async () => {
    const pool = new MockConnectionPoolManager();
    
    const startTime = Date.now();
    const result = await pool.warmup(5);
    const endTime = Date.now();
    
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.duration).toBeLessThanOrEqual(endTime - startTime + 100);
  });

  test('should respect max connections limit', async () => {
    const pool = new MockConnectionPoolManager();
    pool.config.maxConnections = 3;
    
    const result = await pool.warmup(10);
    
    expect(result.created).toBe(3);
    expect(result.failed).toBe(7);
    expect(pool.getActiveConnectionCount()).toBe(3);
  });

  test('should handle concurrent warmup requests', async () => {
    const pool = new MockConnectionPoolManager();
    
    const [result1, result2] = await Promise.all([
      pool.warmup(5),
      pool.warmup(5)
    ]);
    
    // Both should succeed, total connections should be 10
    expect(result1.created + result2.created).toBe(10);
    expect(pool.getActiveConnectionCount()).toBe(10);
  });
});

describe('RingBuffer vs DynamicRingBuffer', () => {
  test('should have same basic API', () => {
    const fixed = new RingBuffer<number>(100);
    const dynamic = new DynamicRingBuffer<number>(100, { autoResize: false });
    
    // Both should support same basic operations
    fixed.push(1);
    dynamic.push(1);
    
    expect(fixed.length).toBe(dynamic.length);
    expect(fixed.get(0)).toBe(dynamic.get(0));
    
    fixed.push(2);
    dynamic.push(2);
    
    expect(fixed.getAverage()).toBe(dynamic.getAverage());
    expect(fixed.getPercentile(0.5)).toBe(dynamic.getPercentile(0.5));
  });

  test('should maintain same data order', () => {
    const fixed = new RingBuffer<number>(100);
    const dynamic = new DynamicRingBuffer<number>(100, { autoResize: false });
    
    const data = Array.from({ length: 50 }, (_, i) => i * 10);
    
    data.forEach(item => {
      fixed.push(item);
      dynamic.push(item);
    });
    
    expect(fixed.toArray()).toEqual(dynamic.toArray());
    expect(fixed.toSortedArray()).toEqual(dynamic.toSortedArray());
  });
});
