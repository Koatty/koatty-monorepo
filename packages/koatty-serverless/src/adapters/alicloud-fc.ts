import type { KoattyApplication } from 'koatty_core';
import type { ServerlessAdapter } from './adapter';

export class AliCloudFcAdapter implements ServerlessAdapter {
  readonly name = 'alicloud-fc';

  createHandler(app: KoattyApplication) {
    const httpHandler = app.getRequestHandler();

    return async (req: any, resp: any, context?: any) => {
      if (context) {
        req.fcContext = context;
      }
      return httpHandler(req, resp);
    };
  }
}
