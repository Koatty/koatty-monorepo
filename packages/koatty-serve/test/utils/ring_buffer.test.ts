/*
 * @Description: Tests for connection pool warmup and dynamic ring buffer
 * @Author: richen
 * @Date: 2025-01-27
 * @License: BSD (3-Clause)
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { DynamicRingBuffer, RingBuffer } from '../../src/utils/ring_buffer';

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

  // [SKIP-05] reason not recorded (pre-Phase A); asserts DynamicRingBuffer auto-expansion
  // tracked in docs/reports/test-baseline-2026-09.md#skip-inventory
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

  // [SKIP-06] reason not recorded (pre-Phase A); asserts DynamicRingBuffer auto-shrink
  // tracked in docs/reports/test-baseline-2026-09.md#skip-inventory
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

  // [SKIP-07] reason not recorded (pre-Phase A); asserts min/max capacity clamps
  // tracked in docs/reports/test-baseline-2026-09.md#skip-inventory
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

  // [SKIP-08] reason not recorded (pre-Phase A); percentile assertion depends on exact rounding
  // tracked in docs/reports/test-baseline-2026-09.md#skip-inventory
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

  // [SKIP-09] reason not recorded (pre-Phase A); asserts resizeUpManual()
  // tracked in docs/reports/test-baseline-2026-09.md#skip-inventory
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

  // [SKIP-10] reason not recorded (pre-Phase A); asserts clear() resets capacity
  // tracked in docs/reports/test-baseline-2026-09.md#skip-inventory
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
