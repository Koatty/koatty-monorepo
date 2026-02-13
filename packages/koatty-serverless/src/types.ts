import type { KoattyApplication } from 'koatty_core';
import type { ServerlessAdapter } from './adapters/adapter';

export type Platform = 'aws' | 'alicloud' | 'tencent';

export interface CreateHandlerOptions {
  platform?: Platform;
  adapter?: ServerlessAdapter;
  bootFunc?: (...args: any[]) => any;
  eventHandlers?: Record<string, EventHandler>;
  healthCheck?: (app: KoattyApplication) => Promise<void>;
}

export type EventHandler = (
  event: any,
  context: any,
  app: KoattyApplication,
) => Promise<any>;
