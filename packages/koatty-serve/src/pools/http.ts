/*
 * @Description: HTTP连接池管理器
 * @Usage: HTTP/HTTPS协议的连接池实现
 * @Author: richen
 * @Date: 2024-11-27 21:30:00
 * @LastEditTime: 2024-11-27 21:30:00
 */

import { Socket } from 'net';
import { TLSSocket } from 'tls';
import { 
  ConnectionPoolManager, 
  ConnectionRequestOptions
} from './pool';
import { ConnectionPoolConfig } from '../config/pool';

/**
 * HTTP连接元数据
 */
interface HttpConnectionMetadata {
  id: string;
  createdAt: number;
  lastUsed: number;
  available: boolean;
  remoteAddress?: string;
  remotePort?: number;
  localAddress?: string;
  localPort?: number;
  encrypted: boolean;
  protocol?: string;
  requestCount: number;
  bytesSent: number;
  bytesReceived: number;
}

/**
 * HTTP连接池管理器
 */
export class HttpConnectionPoolManager extends ConnectionPoolManager<Socket> {
  private keepAliveAgent?: any;

  constructor(config: ConnectionPoolConfig = {}) {
    super('http', config);
  }

  /**
   * 验证HTTP连接
   */
  protected validateConnection(connection: Socket): boolean {
    return connection instanceof Socket && 
           !connection.destroyed && 
           connection.readable && 
           connection.writable;
  }

  /**
   * 清理HTTP连接
   */
  protected async cleanupConnection(connection: Socket): Promise<void> {
    try {
      if (!connection.destroyed) {
        connection.destroy();
      }
    } catch (error) {
      this.logger.warn('Error cleaning up HTTP connection', {}, error);
    }
  }

  /**
   * 获取可用连接
   */
  protected async getAvailableConnection(): Promise<{ connection: Socket; id: string } | null> {
    for (const [id, metadata] of this.connectionMetadata) {
      if (metadata.available && this.isConnectionHealthy(this.connections.get(id)!)) {
        const connection = this.connections.get(id);
        if (connection) {
          // 标记为不可用
          metadata.available = false;
          metadata.lastUsed = Date.now();
          return { connection, id };
        }
      }
    }
    return null;
  }

  /**
   * 创建新连接
   */
  protected async createNewConnection(_options: ConnectionRequestOptions): Promise<{ connection: Socket; id: string; metadata?: any } | null> {
    // HTTP连接通常是被动接受的，这里返回null
    // 在实际的HTTP服务器实现中，连接会通过server.on('connection')事件添加
    return null;
  }

  /**
   * 检查连接是否健康
   */
  isConnectionHealthy(connection: Socket): boolean {
    if (!connection) return false;
    
    const connectionId = this.findConnectionId(connection);
    if (!connectionId) return false;
    
    const metadata = this.connectionMetadata.get(connectionId) as HttpConnectionMetadata;
    if (!metadata) return false;
    
    // 检查连接状态
    const isHealthy = !connection.destroyed && 
                     connection.readable && 
                     connection.writable;
    
    // 检查是否超时
    const now = Date.now();
    const idleTimeout = this.config.keepAliveTimeout || 5000;
    const isIdle = metadata.available && (now - metadata.lastUsed) > idleTimeout;
    
    return isHealthy && !isIdle;
  }

  /**
   * 添加HTTP连接（由服务器调用）
   */
  async addHttpConnection(connection: Socket): Promise<boolean> {
    const metadata: Partial<HttpConnectionMetadata> = {
      remoteAddress: connection.remoteAddress,
      remotePort: connection.remotePort,
      localAddress: connection.localAddress,
      localPort: connection.localPort,
      encrypted: connection instanceof TLSSocket,
      protocol: connection instanceof TLSSocket ? 'https' : 'http',
      requestCount: 0,
      bytesSent: 0,
      bytesReceived: 0
    };

    return this.registerConnection(connection, metadata);
  }


  /**
   * 处理HTTP请求完成
   */
  async handleRequestComplete(connection: Socket, bytesSent: number = 0): Promise<void> {
    const connectionId = this.findConnectionId(connection);
    if (!connectionId) return;

    const metadata = this.connectionMetadata.get(connectionId) as HttpConnectionMetadata;
    if (metadata) {
      metadata.requestCount++;
      metadata.bytesSent += bytesSent;
      metadata.lastUsed = Date.now();
      
      // 检查是否应该关闭连接
      const maxRequests = 100; // 可配置
      if (metadata.requestCount >= maxRequests) {
        await this.removeConnection(connection, 'Max requests reached');
        return;
      }
      
      // 标记为可用状态，可以处理下一个请求
      metadata.available = true;
    }
  }

  /**
   * 获取连接统计信息
   */
  getConnectionStats() {
    const stats = this.getMetrics();
    const activeConnections = this.getActiveConnectionCount();
    
    let availableConnections = 0;
    let totalRequests = 0;
    let totalBytesSent = 0;
    let totalBytesReceived = 0;
    let httpsConnections = 0;
    
    for (const [connectionId, _connection] of this.connections) {
      const metadata = this.connectionMetadata.get(connectionId) as HttpConnectionMetadata;
      
      if (metadata) {
        if (metadata.available) {
          availableConnections++;
        }
        
        totalRequests += metadata.requestCount;
        totalBytesSent += metadata.bytesSent;
        totalBytesReceived += metadata.bytesReceived;
        
        if (metadata.encrypted) {
          httpsConnections++;
        }
      }
    }
    
    return {
      ...stats,
      availableConnections,
      totalRequests,
      totalBytesSent,
      totalBytesReceived,
      httpsConnections,
      httpConnections: activeConnections - httpsConnections,
      averageRequestsPerConnection: activeConnections > 0 ? totalRequests / activeConnections : 0,
      utilizationRatio: this.config.maxConnections ? 
        activeConnections / this.config.maxConnections : 0
    };
  }

  /**
   * 设置Keep-Alive超时
   */
  setKeepAliveTimeout(timeout: number): void {
    this.config.keepAliveTimeout = timeout;
    
    // 更新现有连接的超时设置
    for (const connection of this.connections.values()) {
      if (connection instanceof Socket) {
        connection.setTimeout(timeout);
      }
    }
  }

  /**
   * 获取连接详细信息
   */
  getConnectionDetails(): Array<{
    id: string;
    remoteAddress: string;
    protocol: string;
    requestCount: number;
    bytesSent: number;
    bytesReceived: number;
    age: number;
    idle: number;
  }> {
    const now = Date.now();
    const details: Array<any> = [];
    
    for (const [connectionId, metadata] of this.connectionMetadata) {
      const httpMetadata = metadata as HttpConnectionMetadata;
      
      details.push({
        id: connectionId,
        remoteAddress: httpMetadata.remoteAddress || 'unknown',
        protocol: httpMetadata.protocol || 'unknown',
        requestCount: httpMetadata.requestCount,
        bytesSent: httpMetadata.bytesSent,
        bytesReceived: httpMetadata.bytesReceived,
        age: now - httpMetadata.createdAt,
        idle: now - httpMetadata.lastUsed
      });
    }
    
    return details;
  }

  /**
   * 销毁连接池
   */
  async destroy(): Promise<void> {
    // 调用父类销毁方法（会清理所有TimerManager的定时器）
    await super.destroy();
  }

  /**
   * 协议特定的连接处理器设置
   */
  protected async setupProtocolSpecificHandlers(connection: Socket): Promise<void> {
    const connectionId = this.findConnectionId(connection);
    if (!connectionId) return;

    // 处理连接关闭
    connection.on('close', () => {
      this.removeConnection(connection, 'Connection closed').catch(error => {
        this.logger.error('Error removing closed HTTP connection', {}, error);
      });
    });

    // 处理连接错误
    connection.on('error', (error) => {
      this.logger.warn('HTTP connection error', {}, { 
        connectionId, 
        error: error.message 
      });
      this.removeConnection(connection, `Connection error: ${error.message}`).catch(err => {
        this.logger.error('Error removing errored HTTP connection', {}, err);
      });
    });

    // 处理连接超时
    connection.on('timeout', () => {
      this.removeConnection(connection, 'Connection timeout').catch(error => {
        this.logger.error('Error removing timed out HTTP connection', {}, error);
      });
    });

    // 监控数据传输（字节统计与活跃时间更新）
    connection.on('data', (data) => {
      const metadata = this.connectionMetadata.get(connectionId) as HttpConnectionMetadata;
      if (metadata) {
        metadata.bytesReceived += data.length;
        metadata.lastUsed = Date.now();
      }
    });

    // 设置空闲超时
    const timeout = this.config.connectionTimeout || 30000;
    connection.setTimeout(timeout);
  }

  /**
   * 协议特定的连接创建逻辑
   */
  protected async createProtocolConnection(_options: ConnectionRequestOptions): Promise<{ connection: Socket; metadata?: any } | null> {
    // HTTP连接由客户端发起，服务端不主动创建连接
    // 连接通过registerConnection方法注册到池中
    return null;
  }
} 