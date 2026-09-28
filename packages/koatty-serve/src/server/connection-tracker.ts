/** Incoming connections are owned by a listener; they are never leased or pooled. */
export interface TrackedConnection {
  once?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
  destroy?(): unknown;
  terminate?(): unknown;
  close?(): unknown;
}

export class ConnectionTracker<T extends TrackedConnection = any> {
  readonly connections = new Set<T>();
  private readonly removers = new Map<T, () => void>();
  private total = 0;
  private rejected = 0;
  constructor(public maxConnections = 0) {}

  add(connection: T): boolean {
    if (this.connections.has(connection)) return true;
    if (
      this.maxConnections > 0 &&
      this.connections.size >= this.maxConnections
    ) {
      this.rejected++;
      this.close(connection);
      return false;
    }
    this.connections.add(connection);
    this.total++;
    const remove = () => this.remove(connection);
    this.removers.set(connection, remove);
    connection.once?.("close", remove);
    return true;
  }

  remove(connection: T): void {
    const remove = this.removers.get(connection);
    if (remove) connection.removeListener?.("close", remove);
    this.removers.delete(connection);
    this.connections.delete(connection);
  }

  private close(connection: T): void {
    if (connection.terminate) connection.terminate();
    else if (connection.destroy) connection.destroy();
    else connection.close?.();
  }

  closeAll(): void {
    const errors: unknown[] = [];
    for (const connection of this.connections) {
      try {
        this.close(connection);
      } catch (error) {
        errors.push(error);
      } finally {
        this.remove(connection);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Connection cleanup failed");
  }

  get size(): number {
    return this.connections.size;
  }
  stats() {
    return {
      activeConnections: this.size,
      totalConnections: this.total,
      rejectedConnections: this.rejected,
    };
  }
  health() {
    const ratio = this.maxConnections > 0 ? this.size / this.maxConnections : 0;
    return {
      ...this.stats(),
      maxConnections: this.maxConnections,
      utilizationRatio: ratio,
      utilizationRate: ratio,
      status: ratio >= 1 ? "overloaded" : ratio >= 0.9 ? "degraded" : "healthy",
    };
  }
}
