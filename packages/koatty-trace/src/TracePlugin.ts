/*
 * @Description: Trace Plugin for Koatty framework
 * @Usage:
 * @Author: richen
 * @Date: 2026-01-26 13:00:00
 * @LastEditTime: 2026-01-26 13:00:00
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
import { DefaultLogger as Logger } from 'koatty_logger';
import { Trace } from './trace/trace';

@Plugin('TracePlugin', {
  type: 'core',
  priority: 1000,
  dependencies: [],
  provides: [
    {
      name: 'trace',
      version: '2.0.0',
      description: 'OpenTelemetry tracing capability',
      validate: (app) => !!app.tracer
    }
  ]
})
export class TracePlugin implements IPlugin {
  readonly provides: IPluginCapability[] = [
    {
      name: 'trace',
      version: '2.0.0',
      validate: (app) => !!app.tracer
    }
  ];

  readonly events = {
    [AppEvent.beforeMiddlewareLoad]: async (app: KoattyApplication) => {
      const traceOptions = app.config('trace') || {};

      Logger.Log('Koatty', '', 'Initializing trace middleware...');

      const tracer = Trace(traceOptions, app) as any;

      app.tracer = tracer;
      app.use(tracer);

      Logger.Log('Koatty', '', '✓ Trace middleware initialized');
    },
  };

  async uninstall(app: KoattyApplication): Promise<void> {
    const tracer = app.tracer;
    if (tracer && typeof tracer.shutdown === 'function') {
      Logger.Log('Koatty', '', 'Shutting down tracer...');
      await tracer.shutdown();
    }
  }
}
