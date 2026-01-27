/*
 * @Description: Router Plugin for Koatty framework
 * @Usage:
 * @Author: richen
 * @Date: 2026-01-26 12:00:00
 * @LastEditTime: 2026-01-26 12:00:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import {
  Plugin,
  IPlugin,
  AppEvent,
  KoattyApplication,
  IPluginCapability
} from 'koatty_core';
import { Helper } from 'koatty_lib';
import { DefaultLogger as Logger } from 'koatty_logger';
import { NewRouter } from './router/router';

@Plugin('RouterPlugin', {
  type: 'core',
  priority: 100,
  dependencies: [],
  provides: [
    {
      name: 'router',
      version: '2.0.0',
      description: 'HTTP/WebSocket/gRPC routing capability',
      validate: (app) => {
        return !!app.router && typeof (app.router as any).LoadRouter === 'function';
      }
    }
  ]
})
export class RouterPlugin implements IPlugin {
  readonly provides: IPluginCapability[] = [
    {
      name: 'router',
      version: '2.0.0',
      description: 'Routing capability',
      validate: (app) => !!app.router
    }
  ];

  readonly events = {
    [AppEvent.beforeRouterLoad]: async (app: KoattyApplication) => {
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

          routers[proto] = NewRouter(app, protoRouterOpts);
        }

        Helper.define(app, "router", routers);
      } else {
        const singleProto = protocols[0];
        const router = NewRouter(app, { protocol: singleProto, ...routerOpts });
        Helper.define(app, "router", router);
      }

      Logger.Log('Koatty', '', '✓ Router initialized');
    },
  };

  async uninstall(_app: KoattyApplication): Promise<void> {
    Logger.Debug('RouterPlugin uninstalled');
  }
}
