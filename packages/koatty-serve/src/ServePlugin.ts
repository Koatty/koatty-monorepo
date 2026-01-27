/*
 * @Description: Serve Plugin for Koatty framework
 * @Usage:
 * @Author: richen
 * @Date: 2026-01-26 12:30:00
 * @LastEditTime: 2026-01-26 12:30:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import {
  Plugin,
  IPlugin,
  AppEvent,
  KoattyApplication,
  IPluginDependency,
  IPluginCapability,
  PluginDependencyType
} from 'koatty_core';
import { Helper } from 'koatty_lib';
import { DefaultLogger as Logger } from 'koatty_logger';
import { NewServe } from './server/serve';

@Plugin('ServePlugin', {
  type: 'core',
  priority: 100,
  dependencies: [
    {
      name: 'router',
      type: PluginDependencyType.OPTIONAL,
      errorMessage: 'Router capability not available. Server will run without routing support.',
      validate: (app) => {
        return !!app.router;
      }
    }
  ],
  provides: [
    {
      name: 'server',
      version: '3.0.0',
      description: 'HTTP/HTTP2/HTTP3/WebSocket/gRPC server capability',
      validate: (app) => !!app.server
    }
  ]
})
export class ServePlugin implements IPlugin {
  readonly dependencies: IPluginDependency[] = [
    {
      name: 'router',
      type: PluginDependencyType.OPTIONAL,
      validate: (app) => !!app.router
    }
  ];

  readonly provides: IPluginCapability[] = [
    {
      name: 'server',
      version: '3.0.0',
      validate: (app) => !!app.server
    }
  ];

  readonly events = {
    [AppEvent.beforeServerStart]: async (app: KoattyApplication) => {
      const serveOpts = app.config('server') || { protocol: "http" };
      const protocol = serveOpts.protocol ?? "http";
      const protocols = Helper.isArray(protocol) ? protocol : [protocol];

      Logger.Log('Koatty', '', `Creating servers for protocols: ${protocols.join(', ')}`);

      const hasRouter = !!app.router;
      if (!hasRouter) {
        Logger.Warn('Koatty', '', 'Router not available. Server will run in standalone mode.');
        Logger.Warn('Koatty', '', '  → To enable routing, install and enable RouterPlugin');
      }

      if (protocols.length > 1) {
        const servers: any[] = [];
        const basePort = Helper.isArray(serveOpts.port) ? serveOpts.port : [serveOpts.port];
        const ports: number[] = [];

        for (let i = 0; i < protocols.length; i++) {
          if (i < basePort.length) {
            ports.push(Helper.toNumber(basePort[i]));
          } else {
            ports.push(Helper.toNumber(basePort[0]) + i);
          }
        }

        for (let i = 0; i < protocols.length; i++) {
          const proto = protocols[i];
          const protoServerOpts = { ...serveOpts, protocol: proto, port: ports[i] };
          servers.push(NewServe(app, protoServerOpts));
        }

        Helper.define(app, "server", servers);
      } else {
        const singleProto = protocols[0];
        const singleServerOpts = { protocol: singleProto, ...serveOpts };
        const server = NewServe(app, singleServerOpts);
        Helper.define(app, "server", server);
      }

      Logger.Log('Koatty', '', '✓ Server initialized');
    },
  };

  async uninstall(app: KoattyApplication): Promise<void> {
    const server = app.server;
    if (server) {
      Logger.Log('Koatty', '', 'Closing server connections...');
      if (Helper.isArray(server)) {
        for (const s of server) {
          await s.close?.();
        }
      } else {
        await server.close?.();
      }
    }
  }
}
