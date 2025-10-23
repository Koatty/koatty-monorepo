/*
 * @Description: router config
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 21:56:32
 * @LastEditTime: 2025-10-07 22:00:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

export default {
  /**
   * prefix of the router
   */
  // prefix: string,
  
  /**
   * Methods which should be supported by the router.
   */
  // methods?: string[];
  // routerPath?: string;
  /**
   * Whether or not routing should be case-sensitive.
   */
  // sensitive?: boolean;
  /**
   * Whether or not routes should matched strictly.
   *
   * If strict matching is enabled, the trailing slash is taken into
   * account when matching routes.
   */
  // strict?: boolean;

  /**
   * payload options
   * 
   */
  // payload?: PayloadOptions;
  // payload: {
  //   extTypes: {
  //     json: ['application/json'],
  //     form: ['application/x-www-form-urlencoded'],
  //     text: ['text/plain'],
  //     multipart: ['multipart/form-data'],
  //     xml: ['text/xml'],
  //     grpc: ['application/grpc'],
  //     graphql: ['application/graphql+json'],
  //     websocket: ['application/websocket']
  //   },
  //   limit: '20mb',
  //   encoding: 'utf-8',
  //   multiples: true,
  //   keepExtensions: true,
  // },

  
  /**
   * protocol specific extension config
   * 
   * all protocol specific parameters are placed in this field:
   * - WebSocket: { maxFrameSize, heartbeatInterval, maxConnections, ... }
   * - gRPC: { protoFile, poolSize, batchSize, streamConfig, ... }
   * - GraphQL: { schemaFile, playground, introspection, keyFile, crtFile, ssl, http2, ... }
   * - HTTP/HTTPS/HTTP2: reserved extension fields
   * 
   * **Important: GraphQL Protocol and Transport**
   * GraphQL is an application-layer protocol that runs over HTTP/HTTPS/HTTP2.
   * When protocol is set to 'graphql', koatty_serve will automatically:
   * - Use HTTP as transport by default
   * - Use HTTP/2 when SSL certificates (keyFile/crtFile) are configured
   * 
   * HTTP/2 benefits for GraphQL:
   * - Multiplexing: Handle multiple queries over single connection
   * - Header compression: Reduce bandwidth for large queries
   * - Server push: Prefetch related resources
   * - HTTP/1.1 fallback: Automatic downgrade for compatibility
   * 
   * To enable HTTP/2 for GraphQL, add SSL certificate configuration in ext.graphql:
   * 
   * For multi-protocol support, use protocol name as key:
   * ext: {
   *   http: {},
   *   grpc: { protoFile: "./proto/service.proto" },
   *   graphql: { 
   *     schemaFile: "./schema.graphql",
   *     keyFile: "./ssl/server.key",  // Enable HTTPS for GraphQL
   *     crtFile: "./ssl/server.crt"
   *   },
   *   ws: { maxFrameSize: 1024 * 1024 }
   * }
   * 
   * @example
   * ```typescript
   * // Single protocol config
   * ext: {
   *   protoFile: "./proto/service.proto",
   *   poolSize: 10,
   *   streamConfig: { maxConcurrentStreams: 50 }
   * }
   * 
   * // Multi-protocol config (recommended for multi-protocol servers)
   * ext: {
   *   http: {},
   *   grpc: {
   *     protoFile: "./proto/service.proto",
   *     poolSize: 10,
   *     streamConfig: { maxConcurrentStreams: 50 }
   *   },
   *   graphql: {
   *     schemaFile: "./resource/graphql/schema.graphql",
   *     // Optional: Enable HTTP/2 with SSL for GraphQL
   *     // keyFile: "./ssl/server.key",
   *     // crtFile: "./ssl/server.crt",
   *     // ssl: { mode: 'auto', allowHTTP1: true },
   *     // http2: { maxConcurrentStreams: 100 }
   *   },
   *   ws: {
   *     maxFrameSize: 1024 * 1024,
   *     heartbeatInterval: 15000,
   *     maxConnections: 1000
   *   }
   * }
   * ```
   */
  // ext?: Record<string, any>;
};