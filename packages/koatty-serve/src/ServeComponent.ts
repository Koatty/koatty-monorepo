/*
 * @Description: Serve Component for Koatty framework
 * @Usage:
 * @Author: richen
 * @Date: 2026-01-26 12:30:00
 * @LastEditTime: 2026-01-26 12:30:00
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
import { NewServe } from './server/serve';

/**
 * Serve Component
 * Responsible for initializing and managing server
 *
 * Implements IComponent interface (base interface)
 *
 * Event bindings:
 * - loadServe: Initialize server
 * - appStop: Gracefully shutdown server
 */
@Component('ServeComponent', {
  scope: 'core',
  priority: 100,
  requires: [], // Router is optional dependency, not enforced
})
export class ServeComponent implements IComponent {

  /**
   * Initialize server
   */
  @OnEvent(AppEvent.loadServe)
  async initServer(app: KoattyApplication): Promise<void> {
    const serveOpts = app.config('server') || { protocol: "http" };
    const protocol = serveOpts.protocol ?? "http";
    const protocols = Helper.isArray(protocol) ? protocol : [protocol];

    Logger.Log('Koatty', '', `Creating servers for protocols: ${protocols.join(', ')}`);

    // Check if router is available
    const hasRouter = !!app.router;
    if (!hasRouter) {
      Logger.Warn('Koatty', '', 'Router not available. Server will run in standalone mode.');
      Logger.Warn('Koatty', '', '  → To enable routing, install and enable RouterComponent');
    }

    if (protocols.length > 1) {
      // Multi-protocol servers
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
      // Single-protocol server
      const singleProto = protocols[0];
      const singleServerOpts = { protocol: singleProto, ...serveOpts };
      const server = NewServe(app, singleServerOpts);
      Helper.define(app, "server", server);
    }

    Logger.Log('Koatty', '', '✓ Server initialized');
  }

  // @OnEvent(AppEvent.appReady)
  async run(_app: KoattyApplication): Promise<void> {
    // ...
  }

  /**
   * Gracefully shutdown server on app stop
   *
   * Note: Original appStop event handling triggered by terminus
   * is now unified to be handled by @OnEvent(AppEvent.appStop) decorator
   */
  @OnEvent(AppEvent.appStop)
  async stopServer(app: KoattyApplication): Promise<void> {
    const server = app.server as any;
    if (!server) return;

    Logger.Log('Koatty', '', 'ServeComponent: Gracefully stopping server...');

    try {
      if (Helper.isArray(server)) {
        // Multi-protocol: Stop all servers in parallel
        await Promise.all(server.map((s: any) =>
          new Promise<void>((resolve) => {
            if (s.Stop) {
              s.Stop(() => resolve());
            } else {
              resolve();
            }
          })
        ));
      } else {
        // Single-protocol: Stop single server
        await new Promise<void>((resolve) => {
          if (server.Stop) {
            server.Stop(() => resolve());
          } else {
            resolve();
          }
        });
      }
      Logger.Log('Koatty', '', '✓ Server stopped gracefully');
    } catch (error) {
      Logger.Error('ServeComponent: Error stopping server:', error);
    }
  }

}
