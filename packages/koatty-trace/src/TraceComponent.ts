/*
 * @Description: Trace Component for Koatty framework
 * @Usage:
 * @Author: richen
 * @Date: 2026-01-26 13:00:00
 * @LastEditTime: 2026-01-26 13:00:00
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import {
  Component,
  IComponent,
  AppEvent,
  OnEvent,
  KoattyApplication,
  Koatty,
} from 'koatty_core';
import { DefaultLogger as Logger } from 'koatty_logger';
import { Trace } from './trace/trace';

// Extend KoattyApplication interface to include tracer property
interface KoattyApplicationWithTracer extends KoattyApplication {
  tracer?: any;
}

/**
 * Trace Component
 * Responsible for initializing OpenTelemetry tracing
 *
 * Implements IComponent interface (base interface)
 *
 * Event bindings:
 * - loadMiddleware: Initialize trace middleware (higher priority to load before other middleware)
 * - appStop: Shutdown tracer, flush data
 */
@Component('TraceComponent', {
  scope: 'core',
  priority: 1000, // High priority to ensure trace middleware loads first
})
export class TraceComponent implements IComponent {
  private tracer: any = null;

  /**
   * Initialize trace middleware
   *
   * Execute in loadMiddleware event to ensure trace middleware
   * loads before all other middleware for complete request chain tracing
   */
  @OnEvent(AppEvent.loadMiddleware)
  async initTrace(app: KoattyApplication): Promise<void> {
    const traceOptions = app.config('trace') || {};

    Logger.Log('Koatty', '', 'Initializing trace middleware...');

    this.tracer = Trace(traceOptions, app as Koatty);

    // Mount tracer to app for other components to use
    const appWithTracer = app as KoattyApplicationWithTracer;
    appWithTracer.tracer = this.tracer;
    app.use(this.tracer);

    Logger.Log('Koatty', '', '✓ Trace middleware initialized');
  }

  // @OnEvent(AppEvent.appReady)
  async run(app: KoattyApplication): Promise<void> {
    // ...
  }

  /**
   * Shutdown tracer on app stop
   *
   * Ensure all trace data is flushed to backend
   */
  @OnEvent(AppEvent.appStop)
  async stopTrace(app: KoattyApplication): Promise<void> {
    if (!this.tracer) return;

    Logger.Log('Koatty', '', 'TraceComponent: Shutting down tracer...');

    try {
      if (typeof this.tracer.shutdown === 'function') {
        await this.tracer.shutdown();
      }
      Logger.Log('Koatty', '', '✓ Tracer shutdown completed');
    } catch (error) {
      Logger.Error('TraceComponent: Error shutting down tracer:', error);
    }
  }

}
