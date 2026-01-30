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
})
export class RouterComponent implements IComponent {
  private factory: RouterFactory | null = null;

  /**
   * Initialize router
   */
  @OnEvent(AppEvent.loadRouter)
  async initRouter(app: KoattyApplication): Promise<void> {
    const routerOpts = app.config(undefined, 'router') || {};
    const serveOpts = app.config('server') ?? { protocol: "http" };
    const protocol = serveOpts.protocol ?? "http";
    const protocols = Helper.isArray(protocol) ? protocol : [protocol];

    Logger.Log('Koatty', '', `Creating routers for protocols: ${protocols.join(', ')}`);

    if (protocols.length > 1) {
      const routers: Record<string, any> = {};
      for (const proto of protocols) {
        const protoRouterOpts = { protocol: proto, ...routerOpts };
        if (routerOpts.ext && routerOpts.ext[proto]) {
          protoRouterOpts.ext = routerOpts.ext[proto];
        }
        const { router, factory } = NewRouter(app, protoRouterOpts);
        routers[proto] = router;
        this.factory = factory;
      }
      Helper.define(app, "router", routers);
    } else {
      const singleProto = protocols[0];
      const { router, factory } = NewRouter(app, { protocol: singleProto, ...routerOpts });
      Helper.define(app, "router", router);
      this.factory = factory;
    }

    Logger.Log('Koatty', '', '✓ Router initialized');
  }

  @OnEvent(AppEvent.appReady)
  async run(app: KoattyApplication): Promise<void> {
    app.use(payload(app.config('router.payload')));
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
