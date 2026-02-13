/**
 * @ author: richen
 * @ copyright: Copyright (c) - <richenlin(at)gmail.com>
 * @ license: BSD (3-Clause)
 * @ version: 2020-07-06 11:21:37
 */

import { Server as gRPCServer, ServiceDefinition, UntypedHandleCall } from "@grpc/grpc-js";
import { Server } from "http";
import { Http2SecureServer } from "http2";
import { Server as SecureServer } from "https";
import Koa from "koa";
import { WebSocketServer } from "ws";
import { KoattyContext, KoattyNext, RequestType, ResponseType } from "./IContext";

/**
 * InitOptions
 *
 * @interface InitOptions
 */
export interface InitOptions {
  name?: string;
  version?: string;
  appPath?: string;
  appDebug?: boolean;
  rootPath?: string;
  // koatty framework path
  koattyPath?: string;
}

// 
export type NativeServer = Server | SecureServer | Http2SecureServer | gRPCServer | WebSocketServer;

/**
 * Interface representing a Koatty application that extends Koa.
 * Defines the structure and capabilities of a Koatty application instance.
 * 
 * @interface KoattyApplication
 * @extends Koa
 */
export interface KoattyApplication extends Koa {
  env: string;
  name: string;
  version: string;

  options: InitOptions;

  /**
   * Server instance
   * - Single protocol: KoattyServer instance
   * - Multi-protocol: KoattyServer[]
   */
  server: KoattyServer | KoattyServer[];

  /**
   * Router instance
   * - Single protocol: KoattyRouter instance
   * - Multi-protocol: Record<string, KoattyRouter> (router dictionary with protocol as key)
   */
  router: KoattyRouter | Record<string, KoattyRouter>;

  appPath: string;
  rootPath: string;
  koattyPath: string;
  logsPath: string;

  appDebug: boolean;
  
  /**
   * Silent mode flag - when true, suppresses startup logs and console output
   * Used primarily in test environments to reduce noise
   */
  silent: boolean;

  context: KoattyContext;

  /**
   * Initialize application.
   * This method can be overridden in subclasses to perform initialization tasks.
   */
  init: () => void;

  /**
   * Get metadata by key from application instance
   * @param key The metadata key to retrieve
   * @returns An array containing the metadata value(s). Returns empty array if not found
   */
  readonly getMetaData: (key: string) => any[];
  /**
   * Set metadata value by key.
   * @param key The key of metadata. If key starts with "_", it will be defined as private property.
   * @param value The value to be set.
   */
  readonly setMetaData: (key: string, value: unknown) => void;

  /**
   * Add middleware to the application.
   * @param {Function} fn The middleware function to be added
   * @returns {any} Returns the result of adding the middleware
   * @throws {Error} When the parameter is not a function
   */
  readonly use: (fn: Function) => any;

  /**
   * Use express-style middleware function.
   * Convert express-style middleware to koa-style middleware.
   * 
   * @param {Function} fn Express-style middleware function
   * @returns {any} Returns the result of middleware execution
   * @throws {Error} When parameter is not a function
   */
  readonly useExp: (fn: Function) => any;

  /**
   * Get or set configuration value by name and type.
   * @param {string} [name] Configuration key name, support dot notation (e.g. 'app.port')
   * @param {string} [type='config'] Configuration type, defaults to 'config'
   * @param {any} [value] Configuration value to set. If provided, sets the config value
   * @returns {any} Configuration value or null if error occurs
   * 
   * @example
   * // Get single level config
   * app.config('port');
   * 
   * // Get nested config
   * app.config('database.host');
   * 
   * // Get all configs of specific type
   * app.config(undefined, 'middleware');
   * 
   * // Set single level config
   * app.config('port', 'config', 3000);
   * 
   * // Set nested config
   * app.config('database.host', 'config', 'localhost');
   */
  readonly config: (name?: string, type?: string, value?: any) => any;

  /**
   * Create a Koatty context object.
   * 
   * @param {RequestType} req Request object
   * @param {ResponseType} res Response object
   * @param {string} [protocol='http'] Protocol type, supports 'http', 'ws', 'wss', 'grpc', 'grpc'
   * @returns {any} Koatty context object
   * @public
   */
  readonly createContext: (req: any, res: any, protocol?: string) => KoattyContext;

  /**
   * Listening and start server
   * 
   * Since Koa.listen returns an http.Server type, the return value must be defined
   *  as 'any' type here. When calling, note that Koatty.listen returns a NativeServer,
   *  such as http/https Server or grpcServer or Websocket
   * @param {Function} [listenCallback] Optional callback function to be executed after server starts
   * @returns {NativeServer} The native server instance
   */
  readonly listen: (listenCallback?: any) => any;

  /**
   * Stop all servers gracefully.
   * - For single protocol: stops the single server
   * - For multi-protocol: stops all servers sequentially
   * 
   * @param {Function} [callback] Optional callback function to be executed after all servers stop
   * @returns {void}
   */
  readonly stop: (callback?: () => void) => void;

  /**
   * Create a callback function for handling requests.
   * 
   * Overloaded signature for Koa compatibility:
   * - callback(): returns standard (req, res) => Promise<any> handler (Koa-compatible)
   * - callback(protocol): returns protocol-specific handler with compose caching
   * - callback(protocol, reqHandler): returns handler with additional protocol-specific request handler
   *
   * @param protocol - The protocol type, defaults to "http"
   * @param reqHandler - Optional request handler function for processing requests
   * @returns A function that handles incoming requests with the configured middleware stack
   */
  readonly callback: {
    (): (req: RequestType, res: ResponseType) => Promise<any>;
    (protocol: string): (req: RequestType, res: ResponseType) => Promise<any>;
    (protocol: string, reqHandler: (ctx: KoattyContext) => Promise<any>): (req: RequestType, res: ResponseType) => Promise<any>;
  };

  /**
   * Whether the application has completed initialization
   * and is ready to handle requests.
   */
  readonly isReady: boolean;

  /**
   * Mark the application as ready.
   * Called after bootstrap completes (all components loaded).
   */
  readonly markReady: () => void;

  /**
   * Get a standard Node.js HTTP request handler for serverless/custom deployment.
   *
   * Returns a `(req, res) => Promise<void>` function that can be used with:
   * - Serverless platforms (AWS Lambda, Alibaba Cloud FC, etc.)
   * - Custom HTTP servers (`http.createServer(handler)`)
   * - Testing frameworks (`supertest`)
   *
   * @param {string} [protocol='http'] Protocol type
   * @returns {Function} Standard Node.js request handler
   * @throws {Error} If application has not completed bootstrap
   */
  readonly getRequestHandler: (protocol?: string) => (req: RequestType, res: ResponseType) => Promise<any>;

  /**
   * Get protocol-specific middleware stack.
   * 
   * @param {string} protocol - The protocol type (e.g., 'http', 'grpc', 'ws')
   * @returns {Function[] | undefined} Array of middleware functions for the protocol, or undefined if not found
   */
  readonly getProtocolMiddleware: (protocol: string) => Function[] | undefined;

  /**
   * Get middleware stack statistics.
   * 
   * @returns {{ global: number; protocols: Record<string, number> }} Statistics object containing:
   *   - global: Number of global middleware
   *   - protocols: Object with protocol names as keys and middleware counts as values
   */
  readonly getMiddlewareStats: () => {
    global: number;
    protocols: Record<string, number>;
  };

}

/**
 * Interface for Koatty server instance
 * - single protocol: KoattyServer instance
 * - multi protocol: KoattyServer instance (MultiProtocolServer manages multiple protocols internally)
 * @interface KoattyServer
 * @property {any} options - Server configuration options
 * @property {NativeServer} server - Native server instance
 * @property {number} status - Current server status
 * @property {Function} Start - Start the server and return native server instance
 * @property {Function} Stop - Stop the server
 * @property {Function} RegisterService - Register gRPC service implementation
 */
export interface KoattyServer {
  options: any;
  readonly Start: (listenCallback: () => void) => NativeServer;
  readonly Stop: (callback?: () => void) => void;
  readonly getStatus?: (protocolType?: string, port?: number) => number;
  readonly getNativeServer?: (protocolType?: string, port?: number) => NativeServer;
  readonly RegisterService?: (impl: any) => void;
  // multi protocol
  readonly getServer?: (protocolType?: string, port?: number) => KoattyServer | undefined;
  readonly getAllServers?: () => Map<string, KoattyServer>;
}

/**
 * Interface for gRPC method implementations.
 * @interface IRpcImplementation
 * @description Key-value pairs where keys are method names and values are untyped handle call functions.
 */
export interface IRpcImplementation {
  [methodName: string]: UntypedHandleCall;
}

// HttpImplementation
export type IHttpImplementation = (ctx: KoattyContext, next?: KoattyNext) => Promise<any>;

// IWsImplementation
export type IWsImplementation = (ctx: KoattyContext, next?: KoattyNext) => Promise<any>;

// IGraphQLImplementation
export type IGraphQLImplementation = {
  [methodName: string]: (args: any, ctx: KoattyContext, next?: KoattyNext) => Promise<any>;
};

/**
 * GraphQLSchemaDefinition
 * TODO
 */
type GraphQLSchemaDefinition = any;
/**
 * RouterImplementation
 *
 * @export
 * @interface RouterImplementation
 */
export interface RouterImplementation {
  path?: string;
  method?: string;
  service?: ServiceDefinition;
  schema?: GraphQLSchemaDefinition;
  implementation?: IHttpImplementation | IRpcImplementation | IWsImplementation | IGraphQLImplementation;
}

/**
 * Interface for Koatty router
 * 
 * @interface KoattyRouter
 * @description
 * Defines the structure and behavior of a router in Koatty framework.
 * Provides methods for setting routes, loading router configurations,
 * and managing router implementations.
 * - single protocol: KoattyRouter instance
 * - multi protocol: Record<string, KoattyRouter> (router dictionary with protocol as key)
 * 
 * @property {any} options - Router configuration options
 * @property {any} router - Instance of KoaRouter or custom router implementation
 * @property {Function} SetRouter - Method to set router implementation for a route
 * @property {Function} LoadRouter - Method to load and register router configurations
 * @property {Function} ListRouter - Optional method to get list of registered routers
 */
export interface KoattyRouter {
  /**
   * router options
   */
  options: any;
  /**
   * KoaRouter or custom router
   */
  router: any;

  /**
   * set router map
   * @param name 
   * @param impl 
   * @returns 
   */
  readonly SetRouter: (name: string, impl?: RouterImplementation) => void;

  /**
   * load router list and register handler
   * @param app 
   * @param list 
   * @returns 
   */
  readonly LoadRouter: (app: KoattyApplication, list: any[]) => Promise<void>;

  /**
   * return router list
   * @returns 
   */
  readonly ListRouter?: () => Map<string, RouterImplementation>;
}

/**
 * Application lifecycle events
 * @enum AppEvent
 */
export enum AppEvent {
  appBoot = "appBoot",
  loadConfigure = "loadConfigure",
  loadComponent = "loadComponent",
  loadPlugin = "loadPlugin",
  loadMiddleware = "loadMiddleware",
  loadService = "loadService",
  loadController = "loadController",
  loadRouter = "loadRouter",
  loadServe = "loadServe",
  appReady = "appReady",
  appStart = "appStart",
  appStop = "appStop",
}
export const AppEventArr = [
  "appBoot",
  "loadConfigure",
  "loadComponent",
  "loadPlugin",
  "loadMiddleware",
  "loadService",
  "loadController",
  "loadRouter",     // RouterComponent.initRouter() initializes router here
  "loadServe",      // ServeComponent.initServer() creates server using router
  "appReady",
  "appStart",
  // Note: "appStop" is NOT in startup sequence - it's triggered only on process termination
];

// type EventHookFunc
export type EventHookFunc = (app: KoattyApplication) => Promise<any>;
