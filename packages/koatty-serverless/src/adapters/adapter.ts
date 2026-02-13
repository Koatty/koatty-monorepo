import type { KoattyApplication } from 'koatty_core';

export interface ServerlessAdapter {
  readonly name: string;
  createHandler(app: KoattyApplication): (...args: any[]) => Promise<any>;
}
