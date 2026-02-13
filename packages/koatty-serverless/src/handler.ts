import type { KoattyApplication } from 'koatty_core';
import type { CreateHandlerOptions, Platform } from './types';
import type { ServerlessAdapter } from './adapters/adapter';
import { AliCloudFcAdapter } from './adapters/alicloud-fc';
import { AwsLambdaAdapter } from './adapters/aws-lambda';
import { TencentScfAdapter } from './adapters/tencent-scf';
import { detectEventSource } from './event-detector';
import { bindShutdownHook } from './lifecycle';

const adapterMap: Record<Platform, new () => ServerlessAdapter> = {
  alicloud: AliCloudFcAdapter,
  aws: AwsLambdaAdapter,
  tencent: TencentScfAdapter,
};

/**
 * 加载 createApplication 函数（延迟导入 koatty）
 */
async function loadCreateApplication(): Promise<(appClass: any, bootFunc?: any) => Promise<KoattyApplication>> {
  const koatty = await import('koatty');
  return (koatty as any).createApplication;
}

/**
 * 创建 Serverless Handler。
 *
 * 内部自动管理 app 实例缓存（单例），确保仅在冷启动时执行一次 bootstrap。
 * 后续 Invoke 复用同一个 app 实例和 handler 函数。
 */
export function createHandler(
  AppClass: any,
  options: CreateHandlerOptions = {},
) {
  const {
    platform = 'aws',
    adapter,
    bootFunc,
    eventHandlers,
    healthCheck,
  } = options;

  let cachedApp: KoattyApplication | null = null;
  let cachedHandler: ((...args: any[]) => Promise<any>) | null = null;

  return async (...args: any[]) => {
    if (!cachedApp) {
      const createApplication = await loadCreateApplication();
      cachedApp = await createApplication(AppClass, bootFunc);
      bindShutdownHook(cachedApp);
    }

    if (healthCheck) {
      await healthCheck(cachedApp);
    }

    if (eventHandlers && args.length >= 2) {
      const [event] = args;
      const eventSource = detectEventSource(event);
      if (eventSource && eventHandlers[eventSource]) {
        return eventHandlers[eventSource](event, args[1], cachedApp);
      }
    }

    if (!cachedHandler) {
      const selectedAdapter = adapter || new adapterMap[platform]();
      cachedHandler = selectedAdapter.createHandler(cachedApp);
    }
    return cachedHandler(...args);
  };
}
