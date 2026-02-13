import type { KoattyApplication } from 'koatty_core';
import type { ServerlessAdapter } from './adapter';

export class AwsLambdaAdapter implements ServerlessAdapter {
  readonly name = 'aws-lambda';
  private handler: any;

  createHandler(app: KoattyApplication) {
    let serverlessExpress: any;
    try {
      serverlessExpress = require('@codegenie/serverless-express');
    } catch {
      throw new Error(
        '[koatty-serverless] AWS Lambda adapter requires "@codegenie/serverless-express". ' +
        'Install it: npm install @codegenie/serverless-express'
      );
    }

    this.handler = serverlessExpress({ app: app as any });

    return async (event: any, context: any) => {
      context.callbackWaitsForEmptyEventLoop = false;
      return this.handler(event, context);
    };
  }
}
