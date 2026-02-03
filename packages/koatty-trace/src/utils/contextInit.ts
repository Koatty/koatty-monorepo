/**
 * Context properties initialization utilities
 * 统一管理请求上下文的公共属性初始化，避免多协议场景下的重复定义问题
 * 
 * @Author: richen
 * @Date: 2026-01-30
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { Helper } from "koatty_lib";
import { KoattyContext } from "koatty_core";

/**
 * 安全地定义上下文属性（防止重复定义）
 * Define context property safely (prevent redefinition)
 * 
 * @param ctx - Koatty context
 * @param property - Property name
 * @param value - Property value
 * @param setter - Whether the property is writable
 * @returns true if property was defined, false if it already exists
 */
export function safeDefine(
  ctx: KoattyContext,
  property: string,
  value: any,
  setter = false
): boolean {
  // 检查属性是否已经存在
  if (Object.prototype.hasOwnProperty.call(ctx, property)) {
    return false;
  }
  
  // 使用 Helper.define 定义属性
  Helper.define(ctx, property, value, setter);
  return true;
}

/**
 * 初始化请求的公共属性（startTime, requestId 等）
 * Initialize common request properties (startTime, requestId, etc.)
 * 
 * @param ctx - Koatty context
 * @param requestId - Request ID
 * @returns Object containing initialization status
 */
export function initializeRequestProperties(
  ctx: KoattyContext,
  requestId: string
): {
  startTimeInitialized: boolean;
  requestIdInitialized: boolean;
} {
  const startTimeInitialized = safeDefine(ctx, 'startTime', Date.now());
  const requestIdInitialized = safeDefine(ctx, 'requestId', requestId);
  
  return {
    startTimeInitialized,
    requestIdInitialized,
  };
}

/**
 * 检查上下文是否已经初始化了必需的属性
 * Check if context has required properties initialized
 * 
 * @param ctx - Koatty context
 * @returns true if all required properties exist
 */
export function hasRequiredProperties(ctx: KoattyContext): boolean {
  return (
    Object.prototype.hasOwnProperty.call(ctx, 'startTime') &&
    Object.prototype.hasOwnProperty.call(ctx, 'requestId')
  );
}

/**
 * 获取或初始化请求开始时间
 * Get or initialize request start time
 * 
 * @param ctx - Koatty context
 * @returns Request start time in milliseconds
 */
export function getOrInitStartTime(ctx: KoattyContext): number {
  if (!Object.prototype.hasOwnProperty.call(ctx, 'startTime')) {
    Helper.define(ctx, 'startTime', Date.now());
  }
  return ctx.startTime;
}

/**
 * 获取或初始化请求 ID
 * Get or initialize request ID
 * 
 * @param ctx - Koatty context
 * @param idGenerator - Function to generate request ID if not exists
 * @returns Request ID
 */
export function getOrInitRequestId(
  ctx: KoattyContext,
  idGenerator: () => string
): string {
  if (!Object.prototype.hasOwnProperty.call(ctx, 'requestId')) {
    const requestId = idGenerator();
    Helper.define(ctx, 'requestId', requestId);
    return requestId;
  }
  return ctx.requestId;
}
