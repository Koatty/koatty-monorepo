export type { CreateHandlerOptions, Platform, EventHandler } from './types';
export type { ServerlessAdapter } from './adapters/adapter';
export { detectEventSource } from './event-detector';
export { AliCloudFcAdapter } from './adapters/alicloud-fc';
export { AwsLambdaAdapter } from './adapters/aws-lambda';
export { TencentScfAdapter } from './adapters/tencent-scf';
export { createHandler } from './handler';
