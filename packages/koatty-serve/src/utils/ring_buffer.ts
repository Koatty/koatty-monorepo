/* 
 * @Description: Ring buffer for efficient fixed-size circular data storage
 * @Usage: 用于高效的固定大小循环数据存储，避免频繁的数组操作
 * @Author: richen
 * @Date: 2025-10-12
 * @License: BSD (3-Clause)
 */

import { createLogger } from "./logger";

/**
 * Ring Buffer (Circular Buffer)
 * 环形缓冲区 - 固定大小的循环队列，覆盖最旧的数据
 * 
 * Features:
 * - O(1) write operations (no array shifts or slices)
 * - O(1) amortized read operations
 * - Fixed memory footprint
 * - Automatic overwrite of oldest data when full
 */
export class RingBuffer<T = number> {
  private buffer: T[];
  private head: number = 0;  // Write position
  private tail: number = 0;  // Read position (oldest item)
  private count: number = 0; // Number of items in buffer
  private readonly capacity: number;

  /**
   * Create a ring buffer with fixed capacity
   * @param capacity Maximum number of items to store
   */
  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error('Ring buffer capacity must be greater than 0');
    }
    
    this.capacity = capacity;
    this.buffer = new Array<T>(capacity);
  }

  /**
   * Add an item to the buffer
   * If buffer is full, overwrites the oldest item
   * @param item Item to add
   */
  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    
    if (this.count < this.capacity) {
      this.count++;
    } else {
      // Buffer is full, move tail to overwrite oldest item
      this.tail = (this.tail + 1) % this.capacity;
    }
  }

  /**
   * Get all items in insertion order (oldest to newest)
   * @returns Array of items
   */
  toArray(): T[] {
    if (this.count === 0) {
      return [];
    }
    
    const result: T[] = new Array(this.count);
    let index = this.tail;
    
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buffer[index];
      index = (index + 1) % this.capacity;
    }
    
    return result;
  }

  /**
   * Get a sorted copy of the buffer contents
   * @param compareFn Optional comparison function
   * @returns Sorted array
   */
  toSortedArray(compareFn?: (a: T, b: T) => number): T[] {
    return this.toArray().sort(compareFn);
  }

  /**
   * Clear all items from the buffer
   */
  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  /**
   * Get the number of items currently in the buffer
   * @returns Current item count
   */
  get length(): number {
    return this.count;
  }

  /**
   * Get the maximum capacity of the buffer
   * @returns Buffer capacity
   */
  get size(): number {
    return this.capacity;
  }

  /**
   * Check if buffer is empty
   * @returns True if empty
   */
  isEmpty(): boolean {
    return this.count === 0;
  }

  /**
   * Check if buffer is full
   * @returns True if full
   */
  isFull(): boolean {
    return this.count === this.capacity;
  }

  /**
   * Get an item at a specific index (0 = oldest, length-1 = newest)
   * @param index Index to retrieve
   * @returns Item at index or undefined if out of range
   */
  get(index: number): T | undefined {
    if (index < 0 || index >= this.count) {
      return undefined;
    }
    
    const actualIndex = (this.tail + index) % this.capacity;
    return this.buffer[actualIndex];
  }

  /**
   * Get the oldest item without removing it
   * @returns Oldest item or undefined if buffer is empty
   */
  peek(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    return this.buffer[this.tail];
  }

  /**
   * Get the newest item
   * @returns Newest item or undefined if buffer is empty
   */
  peekLast(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    const lastIndex = (this.head - 1 + this.capacity) % this.capacity;
    return this.buffer[lastIndex];
  }

  /**
   * Calculate percentile from buffer contents (e.g., 0.5 for median, 0.95 for P95)
   * @param percentile Percentile value between 0 and 1
   * @returns Percentile value or undefined if buffer is empty
   */
  getPercentile(percentile: number): T | undefined {
    if (this.count === 0 || percentile < 0 || percentile > 1) {
      return undefined;
    }
    
    // For number types, we can calculate percentile directly
    const sorted = this.toSortedArray((a: unknown, b: unknown) => (a as number) - (b as number));
    const index = Math.floor(sorted.length * percentile);
    return sorted[Math.min(index, sorted.length - 1)];
  }

  /**
   * Get average of numeric buffer contents
   * @returns Average value or undefined if buffer is empty
   */
  getAverage(): number | undefined {
    if (this.count === 0) {
      return undefined;
    }
    
    let sum = 0;
    for (let i = 0; i < this.count; i++) {
      const value = this.get(i) as unknown;
      sum += Number(value) || 0;
    }
    
    return sum / this.count;
  }

  /**
   * Iterate over buffer contents (oldest to newest)
   * @param callback Function to call for each item
   */
  forEach(callback: (item: T, index: number) => void): void {
    for (let i = 0; i < this.count; i++) {
      const item = this.get(i);
      if (item !== undefined) {
        callback(item, i);
      }
    }
  }

  /**
   * Map buffer contents to a new array
   * @param callback Function to transform each item
   * @returns New array of transformed items
   */
  map<U>(callback: (item: T, index: number) => U): U[] {
    const result: U[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const item = this.get(i);
      if (item !== undefined) {
        result[i] = callback(item, i);
      }
    }
    return result;
  }

  /**
   * Filter buffer contents
   * @param predicate Function to test each item
   * @returns New array of items that pass the test
   */
  filter(predicate: (item: T, index: number) => boolean): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const item = this.get(i);
      if (item !== undefined && predicate(item, i)) {
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Reduce buffer contents to a single value
   * @param callback Reducer function
   * @param initialValue Initial value for the accumulator
   * @returns Reduced value
   */
  reduce<U>(callback: (accumulator: U, item: T, index: number) => U, initialValue: U): U {
    let accumulator = initialValue;
    for (let i = 0; i < this.count; i++) {
      const item = this.get(i);
      if (item !== undefined) {
        accumulator = callback(accumulator, item, i);
      }
    }
    return accumulator;
  }
}

/**
 * Dynamic Ring Buffer (Auto-resizing Circular Buffer)
 * 动态环形缓冲区 - 支持自动扩容和缩容
 *
 * Features:
 * - O(1) write operations (no array shifts or slices)
 * - O(1) amortized read operations
 * - Dynamic capacity adjustment based on usage
 * - Memory-efficient with upper and lower bounds
 * - Automatic overwrite of oldest data when full
 *
 * Use cases:
 * - High-frequency metrics collection
 * - Adaptive performance monitoring
 * - Memory-constrained environments
 */
export class DynamicRingBuffer<T = number> {
  private buffer: T[];
  private head: number = 0;  // Write position
  private tail: number = 0;  // Read position (oldest item)
  private count: number = 0; // Number of items in buffer

  // Capacity management
  private currentCapacity: number;
  private initialCapacity: number;
  private maxCapacity: number;
  private minCapacity: number;

  // Auto-resize configuration
  private autoResize: boolean;
  private resizeThreshold: number;    // Threshold to trigger resize (0-1)
  private shrinkThreshold: number;    // Threshold to trigger shrink (0-1)
  private resizeFactor: number;      // Factor to grow/shrink by

  // Resize tracking
  private lastResizeTime: number = 0;
  private resizeCooldown: number;     // Minimum time between resizes (ms)
  private resizeCount: number = 0;    // Total resize operations
  private logger = createLogger({ module: 'DynamicRingBuffer' });

  /**
   * Create a dynamic ring buffer with auto-resize capability
   * @param initialCapacity Starting capacity
   * @param options Configuration options
   */
  constructor(
    initialCapacity: number,
    options: {
      maxCapacity?: number;
      minCapacity?: number;
      autoResize?: boolean;
      resizeThreshold?: number;
      shrinkThreshold?: number;
      resizeFactor?: number;
      resizeCooldown?: number;
    } = {}
  ) {
    if (initialCapacity <= 0) {
      throw new Error('Initial capacity must be greater than 0');
    }

    this.initialCapacity = initialCapacity;
    this.currentCapacity = initialCapacity;
    this.maxCapacity = options.maxCapacity || Math.max(initialCapacity * 10, 10000);
    this.minCapacity = options.minCapacity || Math.max(Math.floor(initialCapacity / 2), 10);
    this.autoResize = options.autoResize ?? true;
    this.resizeThreshold = options.resizeThreshold ?? 0.85;
    this.shrinkThreshold = options.shrinkThreshold ?? 0.3;
    this.resizeFactor = options.resizeFactor ?? 2;
    this.resizeCooldown = options.resizeCooldown ?? 5000;

    this.buffer = new Array<T>(this.currentCapacity);
  }

  /**
   * Add an item to buffer with auto-resize
   * If buffer is full, triggers resize or overwrites oldest item
   * @param item Item to add
   */
  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.currentCapacity;

    if (this.count < this.currentCapacity) {
      this.count++;
    } else {
      // Buffer is full
      if (this.autoResize && this.shouldResizeUp()) {
        this.resizeUp();
      } else {
        // Move tail to overwrite oldest item
        this.tail = (this.tail + 1) % this.currentCapacity;
      }
    }

    // Check for shrink opportunity
    if (this.autoResize && this.shouldResizeDown()) {
      this.resizeDown();
    }
  }

  /**
   * Check if buffer should expand
   */
  private shouldResizeUp(): boolean {
    const now = Date.now();
    const timeSinceLastResize = now - this.lastResizeTime;

    // Resize if at threshold and cooldown passed
    return (
      this.count / this.currentCapacity >= this.resizeThreshold &&
      this.currentCapacity < this.maxCapacity &&
      timeSinceLastResize >= this.resizeCooldown
    );
  }

  /**
   * Check if buffer should shrink
   */
  private shouldResizeDown(): boolean {
    const now = Date.now();
    const timeSinceLastResize = now - this.lastResizeTime;

    // Shrink if below threshold and cooldown passed
    return (
      this.count / this.currentCapacity <= this.shrinkThreshold &&
      this.currentCapacity > this.minCapacity &&
      timeSinceLastResize >= this.resizeCooldown
    );
  }

  /**
   * Expand buffer capacity
   */
  private resizeUp(): void {
    const newCapacity = Math.min(
      Math.floor(this.currentCapacity * this.resizeFactor),
      this.maxCapacity
    );

    this.logger.info('Expanding ring buffer', {
      oldCapacity: this.currentCapacity,
      newCapacity,
      itemCount: this.count
    });

    const newBuffer = new Array<T>(newCapacity);

    // Copy items in order (oldest to newest)
    for (let i = 0; i < this.count; i++) {
      newBuffer[i] = this.get(i)!;
    }

    this.buffer = newBuffer;
    this.currentCapacity = newCapacity;
    this.head = this.count;
    this.tail = 0;
    this.lastResizeTime = Date.now();
    this.resizeCount++;
  }

  /**
   * Shrink buffer capacity
   */
  private resizeDown(): void {
    const newCapacity = Math.max(
      Math.floor(this.currentCapacity / this.resizeFactor),
      this.minCapacity
    );

    this.logger.info('Shrinking ring buffer', {
      oldCapacity: this.currentCapacity,
      newCapacity,
      itemCount: this.count
    });

    const newBuffer = new Array<T>(newCapacity);

    // Copy items in order (oldest to newest)
    for (let i = 0; i < this.count; i++) {
      newBuffer[i] = this.get(i)!;
    }

    this.buffer = newBuffer;
    this.currentCapacity = newCapacity;
    this.head = this.count;
    this.tail = 0;
    this.lastResizeTime = Date.now();
    this.resizeCount++;
  }

  /**
   * Get all items in insertion order (oldest to newest)
   * @returns Array of items
   */
  toArray(): T[] {
    if (this.count === 0) {
      return [];
    }

    const result: T[] = new Array(this.count);
    let index = this.tail;

    for (let i = 0; i < this.count; i++) {
      result[i] = this.buffer[index];
      index = (index + 1) % this.currentCapacity;
    }

    return result;
  }

  /**
   * Get a sorted copy of buffer contents
   * @param compareFn Optional comparison function
   * @returns Sorted array
   */
  toSortedArray(compareFn?: (a: T, b: T) => number): T[] {
    return this.toArray().sort(compareFn);
  }

  /**
   * Clear all items from buffer
   */
  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    // Reset to initial capacity
    if (this.autoResize && this.currentCapacity !== this.initialCapacity) {
      this.currentCapacity = this.initialCapacity;
      this.buffer = new Array<T>(this.currentCapacity);
    }
  }

  /**
   * Get number of items currently in buffer
   * @returns Current item count
   */
  get length(): number {
    return this.count;
  }

  /**
   * Get current capacity of buffer
   * @returns Current capacity
   */
  get size(): number {
    return this.currentCapacity;
  }

  /**
   * Get initial capacity
   * @returns Initial capacity
   */
  get initialSize(): number {
    return this.initialCapacity;
  }

  /**
   * Get maximum capacity
   * @returns Maximum capacity
   */
  get maxSize(): number {
    return this.maxCapacity;
  }

  /**
   * Get minimum capacity
   * @returns Minimum capacity
   */
  get minSize(): number {
    return this.minCapacity;
  }

  /**
   * Check if buffer is empty
   * @returns True if empty
   */
  isEmpty(): boolean {
    return this.count === 0;
  }

  /**
   * Check if buffer is full
   * @returns True if full
   */
  isFull(): boolean {
    return this.count === this.currentCapacity;
  }

  /**
   * Get utilization ratio (0-1)
   * @returns Utilization ratio
   */
  get utilization(): number {
    return this.count / this.currentCapacity;
  }

  /**
   * Get an item at a specific index (0 = oldest, length-1 = newest)
   * @param index Index to retrieve
   * @returns Item at index or undefined if out of range
   */
  get(index: number): T | undefined {
    if (index < 0 || index >= this.count) {
      return undefined;
    }

    const actualIndex = (this.tail + index) % this.currentCapacity;
    return this.buffer[actualIndex];
  }

  /**
   * Get oldest item without removing it
   * @returns Oldest item or undefined if buffer is empty
   */
  peek(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    return this.buffer[this.tail];
  }

  /**
   * Get newest item
   * @returns Newest item or undefined if buffer is empty
   */
  peekLast(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    const lastIndex = (this.head - 1 + this.currentCapacity) % this.currentCapacity;
    return this.buffer[lastIndex];
  }

  /**
   * Calculate percentile from buffer contents (e.g., 0.5 for median, 0.95 for P95)
   * @param percentile Percentile value between 0 and 1
   * @returns Percentile value or undefined if buffer is empty
   */
  getPercentile(percentile: number): T | undefined {
    if (this.count === 0 || percentile < 0 || percentile > 1) {
      return undefined;
    }

    // For number types, we can calculate percentile directly
    const sorted = this.toSortedArray((a: unknown, b: unknown) => (a as number) - (b as number));
    const index = Math.floor(sorted.length * percentile);
    return sorted[Math.min(index, sorted.length - 1)];
  }

  /**
   * Get average of numeric buffer contents
   * @returns Average value or undefined if buffer is empty
   */
  getAverage(): number | undefined {
    if (this.count === 0) {
      return undefined;
    }

    let sum = 0;
    for (let i = 0; i < this.count; i++) {
      const value = this.get(i) as unknown;
      sum += Number(value) || 0;
    }

    return sum / this.count;
  }

  /**
   * Iterate over buffer contents (oldest to newest)
   * @param callback Function to call for each item
   */
  forEach(callback: (item: T, index: number) => void): void {
    for (let i = 0; i < this.count; i++) {
      const item = this.get(i);
      if (item !== undefined) {
        callback(item, i);
      }
    }
  }

  /**
   * Map buffer contents to a new array
   * @param callback Function to transform each item
   * @returns New array of transformed items
   */
  map<U>(callback: (item: T, index: number) => U): U[] {
    const result: U[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const item = this.get(i);
      if (item !== undefined) {
        result[i] = callback(item, i);
      }
    }
    return result;
  }

  /**
   * Filter buffer contents
   * @param predicate Function to test each item
   * @returns New array of items that pass test
   */
  filter(predicate: (item: T, index: number) => boolean): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const item = this.get(i);
      if (item !== undefined && predicate(item, i)) {
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Reduce buffer contents to a single value
   * @param callback Reducer function
   * @param initialValue Initial value for accumulator
   * @returns Reduced value
   */
  reduce<U>(callback: (accumulator: U, item: T, index: number) => U, initialValue: U): U {
    let accumulator = initialValue;
    for (let i = 0; i < this.count; i++) {
      const item = this.get(i);
      if (item !== undefined) {
        accumulator = callback(accumulator, item, i);
      }
    }
    return accumulator;
  }

  /**
   * Manually trigger resize up
   * @param factor Optional resize factor override
   */
  resizeUpManual(factor?: number): void {
    const oldFactor = this.resizeFactor;
    if (factor !== undefined) {
      this.resizeFactor = factor;
    }
    if (this.shouldResizeUp()) {
      this.resizeUp();
    }
    this.resizeFactor = oldFactor;
  }

  /**
   * Manually trigger resize down
   * @param factor Optional resize factor override
   */
  resizeDownManual(factor?: number): void {
    const oldFactor = this.resizeFactor;
    if (factor !== undefined) {
      this.resizeFactor = factor;
    }
    if (this.shouldResizeDown()) {
      this.resizeDown();
    }
    this.resizeFactor = oldFactor;
  }

  /**
   * Get resize statistics
   */
  getStats() {
    return {
      resizeCount: this.resizeCount,
      lastResizeTime: this.lastResizeTime,
      currentCapacity: this.currentCapacity,
      utilization: this.utilization,
      resizeThreshold: this.resizeThreshold,
      shrinkThreshold: this.shrinkThreshold
    };
  }

}
