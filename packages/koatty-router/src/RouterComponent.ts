/*
 * @Description: Router Component for Koatty framework
 * @Usage:
 * @Author: richen
 * @Date: 2026-01-26 12:00:00
 * @LastEditTime: 2026-01-26 12:00:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import {
  Component,
  IComponent,
  AppEvent,
  OnEvent,
  KoattyApplication,
} from 'koatty_core';
import { Helper } from 'koatty_lib';
import { DefaultLogger as Logger } from 'koatty_logger';
import { NewRouter } from './router/router';
import { payload } from './payload/payload';
import { RouterFactory } from './router/factory';

/**
 * Router Component
 * Responsible for initializing and managing routing
 * 
 * Implements IComponent interface (base interface)
 * 
 * Event bindings:
 * - loadRouter: Initialize router
 * - appStop: Cleanup router resources
 */
@Component('RouterComponent', {
  scope: 'core',
  priority: 100,
  version: '1.0.0',
  description: 'HTTP/gRPC/WebSocket routing for Koatty',
})
export class RouterComponent implements IComponent {
  events: Record<string, any> = {};
  private factory: RouterFactory | null = null;

  /**
   * Initialize router and load routes
   * 
   * This method handles the complete router initialization:
   * 1. Create router instance(s) for configured protocol(s)
   * 2. Bind router to app.router
   * 3. Load controller routes into router
   */
  @OnEvent(AppEvent.loadRouter)
  async initRouter(app: KoattyApplication): Promise<void> {
    const routerOpts = app.config(undefined, 'router') || {};
    const serveOpts = app.config(undefined, 'server') ?? { protocol: "http" };
    const protocol = serveOpts.protocol ?? "http";
    const protocols = Helper.isArray(protocol) ? protocol : [protocol];

    Logger.Log('Koatty', '', `Creating routers for protocols: ${protocols.join(', ')}`);

    // Step 1: Create and bind router instance(s)
    if (protocols.length > 1) {
      const routers: Record<string, any> = {};
      const successfulProtocols: string[] = [];
      
      for (const proto of protocols) {
        try {
          const protoRouterOpts = { protocol: proto, ...routerOpts };
          // Get protocol-specific ext configuration
          if (routerOpts.ext && routerOpts.ext[proto]) {
            protoRouterOpts.ext = routerOpts.ext[proto];
          } else if (serveOpts.ext && serveOpts.ext[proto]) {
            // Fallback: check ServeComponent ext config
            protoRouterOpts.ext = serveOpts.ext[proto];
          }
          
          const { router, factory } = NewRouter(app, protoRouterOpts);
          routers[proto] = router;
          this.factory = factory;
          successfulProtocols.push(proto);
        } catch (error: any) {
          // Log warning and skip this protocol instead of crashing
          Logger.Warn(
            `Router for protocol '${proto}' skipped: ${error.message}\n` +
            `  → To enable ${proto}, configure 'ext.${proto}' in config/router.ts`
          );
        }
      }
      
      if (successfulProtocols.length === 0) {
        throw new Error(
          `No routers could be initialized. Configured protocols: [${protocols.join(', ')}]\n` +
          `  → Check protocol-specific configuration in config/router.ts`
        );
      }
      
      Helper.define(app, "router", routers);
      Logger.Log('Koatty', '', `✓ Routers initialized: ${successfulProtocols.join(', ')}`);
    } else {
      const singleProto = protocols[0];
      const { router, factory } = NewRouter(app, { protocol: singleProto, ...routerOpts });
      Helper.define(app, "router", router);
      this.factory = factory;
      Logger.Log('Koatty', '', '✓ Router initialized');
    }

    // Step 2: Register payload middleware BEFORE loading routes
    // This ensures body parsing runs before route matching in the middleware chain,
    // so controller handlers can access parsed request body directly.
    app.use(payload(app.config('payload', 'router')));
    Logger.Log('Koatty', '', '✓ Payload middleware registered');

    // Step 3: Load controller routes
    await this.loadRoutes(app);
  }

  /**
   * Load controller routes into router
   * 
   * @param app - Koatty application instance
   */
  private async loadRoutes(app: KoattyApplication): Promise<void> {
    const router = app.router;
    // getMetaData returns wrapped array for private keys (keys starting with "_")
    // so we need to unwrap with [0]
    const controllers = app.getMetaData('_controllers')[0] || [];
  
    if (controllers.length === 0) {
      Logger.Warn('No controllers found!');
      return;
    }

    Logger.Log('Koatty', '', `Loading routes for ${controllers.length} controllers`);

    if (Helper.isObject(router) && !Helper.isFunction((router as any).LoadRouter)) {
      // Multi-protocol routers (router is an object with protocol keys)
      const routers = router as Record<string, any>;
      Logger.Log('Koatty', '', `Multi-protocol routing: ${Object.keys(routers).length} protocols (${Object.keys(routers).join(', ')})`);
      
      for (const proto in routers) {
        if (routers[proto] && Helper.isFunction(routers[proto].LoadRouter)) {
          Logger.Log('Koatty', '', `Loading routes for protocol: ${proto}`);
          await routers[proto].LoadRouter(app, controllers);
        }
      }
    } else if (Helper.isFunction((router as any).LoadRouter)) {
      // Single protocol router
      Logger.Log('Koatty', '', 'Loading routes for single protocol');
      await (router as any).LoadRouter(app, controllers);
    } else {
      Logger.Warn('No valid router found!');
    }

    Logger.Log('Koatty', '', '✓ Routes loaded');
  }

  /**
   * Cleanup router resources on app stop
   *
   * NOTE: Original app.once("appStop", ...) listener in router.ts
   * is now unified to be handled by @OnEvent(AppEvent.appStop) decorator
   */
  @OnEvent(AppEvent.appStop)
  async cleanup(_app: KoattyApplication): Promise<void> {
    Logger.Log('Koatty', '', 'RouterComponent: Cleaning up router resources...');

    if (this.factory) {
      await this.factory.shutdownAll();
    }

    Logger.Log('Koatty', '', '✓ Router resources cleaned up');
  }

}
