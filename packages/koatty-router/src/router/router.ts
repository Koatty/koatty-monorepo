/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2023-12-09 12:02:29
 * @LastEditTime: 2025-01-20 10:00:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { KoattyApplication, KoattyRouter } from "koatty_core";
import { Helper } from "koatty_lib";
import { RouterFactory } from "./factory";
import { PayloadOptions } from "../payload/interface";


/**
 * RouterOptions
 *
 * @export
 * @interface RouterOptions
 */
export interface RouterOptions {
  /** 路由前缀 */
  prefix: string;
  /**
   * Methods which should be supported by the router.
   */
  methods?: string[];
  routerPath?: string;
  /**
   * Whether or not routing should be case-sensitive.
   */
  sensitive?: boolean;
  /**
   * Whether or not routes should matched strictly.
   *
   * If strict matching is enabled, the trailing slash is taken into
   * account when matching routes.
   */
  strict?: boolean;
  /** server protocol */
  protocol?: string;

  /**
   * payload options
   */
  payload?: PayloadOptions;
  /**
   * 协议特定的扩展配置
   * 
   * 各协议的特定参数都放在此字段中：
   * - WebSocket: { maxFrameSize, heartbeatInterval, maxConnections, ... }
   * - gRPC: { protoFile, poolSize, batchSize, streamConfig, ... }
   * - GraphQL: { schemaFile, playground, introspection, ... }
   * - HTTP/HTTPS: 预留扩展字段
   * 
   * @example
   * ```typescript
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
  ext?: Record<string, any>;
}

/**
 * get instance of Router using Factory Pattern
 *
 * @export
 * @param {KoattyApplication} app
 * @param {RouterOptions} options
 * @returns {*}  {{ router: KoattyRouter, factory: RouterFactory }}
 */
export function NewRouter(app: KoattyApplication, opt?: RouterOptions): { router: KoattyRouter, factory: RouterFactory } {
  const options: RouterOptions = { protocol: "http", prefix: "", ...opt };

  // Use RouterFactory to create router instance
  const factory = RouterFactory.getInstance();
  const router = factory.create(options.protocol!, app, options);

  Helper.define(router, "protocol", options.protocol);

  // inject payload middleware
  // IMPORTANT: Use app.once() to prevent duplicate middleware registration
  // in multi-protocol environments where each NewRouter() is called separately
  // app.once("appReady", () => {
  //   app.use(payload(options.payload));
  // });

  // Note: app.once("appStop", ...) has been removed.
  // Cleanup logic is now handled by RouterComponent @OnEvent(AppEvent.appStop)

  return { router, factory };
}