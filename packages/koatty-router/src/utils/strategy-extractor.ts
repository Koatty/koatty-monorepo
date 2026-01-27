/*
 * @Description: Strategy-based parameter extraction system
 * @Usage: Unified parameter extraction with optimized strategies
 * @Author: richen
 * @Date: 2025-01-27
 * @LastEditTime: 2025-01-27
 * @License: BSD (3-Clause)
 * @Copyright (c): <richenlin(at)gmail.com>
 */

import { Koatty, KoattyContext } from "koatty_core";
import { ParamMetadata, ParamSourceType } from "./inject";
import {
  ClassValidator,
  plainToClass,
  ValidOtpions,
  ValidRules,
  convertParamsType
} from "koatty_validation";
import { DefaultLogger as Logger } from "koatty_logger";
import { bodyParser } from "../payload/payload";
import { IOC } from "koatty_container";

/**
 * Parameter extraction strategy enum
 * Each strategy represents an optimized execution path
 */
export enum ExtractionStrategy {
  // Fastest: Direct property access, no validation
  SYNC_SINGLE_NO_VALIDATION = 'SYNC_SINGLE_NO_VALIDATION',

  // Fast: Loop over synchronous params, no validation
  SYNC_MULTI_NO_VALIDATION = 'SYNC_MULTI_NO_VALIDATION',

  // Fast: Single param with simple validation
  SYNC_SINGLE_SIMPLE_VALIDATION = 'SYNC_SINGLE_SIMPLE_VALIDATION',

  // Fast: Multiple params with simple validation
  SYNC_MULTI_SIMPLE_VALIDATION = 'SYNC_MULTI_SIMPLE_VALIDATION',

  // Fast: DTO transformation without validation
  SYNC_DTO_NO_VALIDATION = 'SYNC_DTO_NO_VALIDATION',

  // Fast: DTO transformation with validation
  SYNC_DTO_WITH_VALIDATION = 'SYNC_DTO_WITH_VALIDATION',

  // Moderate: Mixed async params (body/file)
  ASYNC_MIXED_PARAMS = 'ASYNC_MIXED_PARAMS',

  // Moderate: Async DTO validation
  ASYNC_DTO_VALIDATION = 'ASYNC_DTO_VALIDATION',

  // Fallback: Generic async path
  ASYNC_GENERIC = 'ASYNC_GENERIC'
}

/**
 * Pre-compiled strategy handler type
 */
export type StrategyHandler = (ctx: KoattyContext, params: ParamMetadata[]) => Promise<unknown[]> | unknown[];

/**
 * Parameter source structure for unified extraction
 */
interface ParamSource {
  query: Record<string, unknown>;
  body: Record<string, unknown> & { file?: Record<string, unknown> };
  params: Record<string, unknown>;
  headers: Record<string, unknown>;
}

/**
 * Extract value synchronously for QUERY/HEADER/PATH
 * Reused from inject.ts to avoid duplication
 */
function extractValueSync(ctx: KoattyContext, param: ParamMetadata): unknown {
  const paramName = param.paramName !== undefined ? param.paramName : param.name;

  switch(param.sourceType) {
    case ParamSourceType.QUERY:
      return paramName ? ctx.query?.[paramName] : ctx.query;

    case ParamSourceType.HEADER:
      return paramName ? ctx.get(paramName) : ctx.headers;

    case ParamSourceType.PATH:
      return paramName ? ctx.params?.[paramName] : ctx.params;

    default:
      return param.fn ? param.fn(ctx, param.options) : null;
  }
}

/**
 * Extract value from pre-fetched sources
 * Reused from inject.ts to avoid duplication
 */
function extractValueFromSource(source: ParamSource, param: ParamMetadata): unknown {
  const paramName = param.paramName !== undefined ? param.paramName : param.name;

  switch(param.sourceType) {
    case ParamSourceType.QUERY:
      return paramName ? source.query?.[paramName] : source.query;

    case ParamSourceType.BODY:
      return paramName ? source.body?.[paramName] : source.body;

    case ParamSourceType.HEADER:
      return paramName ? source.headers?.[paramName] : source.headers;

    case ParamSourceType.PATH:
      return paramName ? source.params?.[paramName] : source.params;

    case ParamSourceType.FILE:
      return paramName ? source.body?.file?.[paramName] : source.body?.file;

    case ParamSourceType.CUSTOM:
      return null;

    default:
      return null;
  }
}

/**
 * Extract all parameter sources once
 * Reused from inject.ts to avoid duplication
 */
async function extractParamSources(ctx: KoattyContext, params: ParamMetadata[]): Promise<ParamSource> {
  const needsBody = params.some((param) => {
    return param.sourceType === ParamSourceType.BODY ||
           param.sourceType === ParamSourceType.FILE;
  });

  const bodyData: Record<string, unknown> = {};
  if (needsBody) {
    try {
      const parsedBody = await bodyParser(ctx, params[0]?.options);
      bodyData.body = parsedBody;
      if (typeof parsedBody === 'object' && 'file' in parsedBody) {
        bodyData.file = (parsedBody as Record<string, unknown>).file;
      }
    } catch (err) {
      Logger.Error(`extractParamSources: Failed to parse body: ${(err as Error).message}`);
    }
  }

  return {
    query: ctx.query || {},
    body: bodyData,
    params: ctx.params || {},
    headers: ctx.headers || {}
  };
}

/**
 * Parameter validation options
 */
interface ParamOptions {
  index: number;
  isDto: boolean;
  type: string;
  validRule: Function | ValidRules | ValidRules[];
  validOpt: ValidOtpions;
  dtoCheck: boolean;
  dtoRule: unknown;
  clazz: unknown;
}

function createParamOptions(param: ParamMetadata, index: number): ParamOptions {
  return {
    index,
    isDto: param.isDto,
    type: param.type,
    validRule: param.validRule,
    validOpt: param.validOpt,
    dtoCheck: param.dtoCheck,
    dtoRule: param.dtoRule,
    clazz: param.clazz,
  };
}

/**
 * Validate parameter
 * Reused from inject.ts to avoid duplication
 */
  async function validateParam(
    app: Koatty,
    ctx: KoattyContext,
    value: unknown,
    opt: ParamOptions,
    compiledValidator?: (value: unknown) => void,
    compiledTypeConverter?: ((value: unknown) => unknown) | null
  ): Promise<unknown> {
  try {
    if (opt.isDto) {
      let validatedValue;
      if (opt.dtoCheck) {
        validatedValue = await ClassValidator.valid(opt.clazz as new (...args: unknown[]) => unknown, value, true);
      } else {
        validatedValue = plainToClass(opt.clazz as new (...args: unknown[]) => unknown, value, true);
      }
      return validatedValue;
    } else {
      const needsConversion = compiledTypeConverter !== null;
      const needsValidation = !!(compiledValidator || opt.validRule);

      if (!needsConversion && !needsValidation) {
        return value;
      }

      let convertedValue = value;
      if (compiledTypeConverter) {
        convertedValue = compiledTypeConverter(value);
      } else if (opt.type && opt.type !== 'string') {
        convertedValue = convertParamsType(value, opt.type);
      }

      if (compiledValidator) {
        compiledValidator(convertedValue);
      } else if (opt.validRule) {
        throw new Error(
          `Validator for parameter ${opt.index} was not pre-compiled. ` +
          `This indicates a compilation failure during startup. ` +
          `Check application logs for compilation errors.`
        );
      }
    }
    return convertedValue;
  } catch (err) {
    const errorMessage = (err as Error).message || '';
    throw new Error(errorMessage.trim() ? errorMessage : `ValidatorError: invalid arguments.`);
  }
}

/**
 * Detect extraction strategy from parameter metadata
 * This is called once at startup time
 */
export function detectExtractionStrategy(params: ParamMetadata[]): ExtractionStrategy {
  if (!params || params.length === 0) {
    return ExtractionStrategy.ASYNC_GENERIC;
  }

  const paramCount = params.length;

  const hasAsyncParams = params.some(p =>
    p.sourceType === ParamSourceType.BODY ||
    p.sourceType === ParamSourceType.FILE ||
    (p.sourceType === ParamSourceType.CUSTOM && p.fn) ||
    p.isDto
  );

  const hasDtoParams = params.some(p => p.isDto);

  const hasValidation = params.some(p => p.validRule);

  const isSimpleDto = paramCount === 1 && hasDtoParams && !hasValidation;

  if (hasAsyncParams) {
    if (isSimpleDto) {
      return ExtractionStrategy.SYNC_DTO_NO_VALIDATION;
    }
    if (hasDtoParams) {
      return ExtractionStrategy.ASYNC_DTO_VALIDATION;
    }
    return ExtractionStrategy.ASYNC_MIXED_PARAMS;
  } else {
    if (paramCount === 1) {
      const param = params[0];

      if (!param.validRule && !param.isDto) {
        return ExtractionStrategy.SYNC_SINGLE_NO_VALIDATION;
      }

      if (param.validRule && !param.isDto) {
        return ExtractionStrategy.SYNC_SINGLE_SIMPLE_VALIDATION;
      }

      if (param.isDto) {
        return param.dtoCheck
          ? ExtractionStrategy.SYNC_DTO_WITH_VALIDATION
          : ExtractionStrategy.SYNC_DTO_NO_VALIDATION;
      }
    } else if (paramCount > 1) {
      if (!hasValidation && !hasDtoParams) {
        return ExtractionStrategy.SYNC_MULTI_NO_VALIDATION;
      }

      if (hasValidation && !hasDtoParams) {
        return ExtractionStrategy.SYNC_MULTI_SIMPLE_VALIDATION;
      }
    }
  }

  return ExtractionStrategy.ASYNC_GENERIC;
}


/**
 * Strategy cache for storing pre-compiled handlers
 * Uses WeakMap for automatic garbage collection
 */
class StrategyCacheManager {
  private cache = new WeakMap<ParamMetadata[], StrategyHandler>();
  private strategyMap = new WeakMap<ParamMetadata[], ExtractionStrategy>();

  getOrCreate(params: ParamMetadata[], app: Koatty): StrategyHandler {
    const cached = this.cache.get(params);
    if (cached) {
      return cached;
    }

    const strategy = detectExtractionStrategy(params);
    this.strategyMap.set(params, strategy);

    const handler = StrategyHandlerFactory.createHandler(strategy, params, app);
    this.cache.set(params, handler);

    return handler;
  }

  getStrategy(params: ParamMetadata[]): ExtractionStrategy | undefined {
    return this.strategyMap.get(params);
  }

  clear(): void {
    this.cache = new WeakMap();
    this.strategyMap = new WeakMap();
  }
}

const strategyCache = new StrategyCacheManager();

/**
 * Unified parameter extraction using strategy pattern
 * Replaces getParameter(), FastPath, and Sync Path
 *
 * @performance
 * - Startup: Strategy detection (one-time cost)
 * - Runtime: Direct handler call (optimal performance)
 * - Memory: WeakMap auto-GC (no memory leaks)
 */
export async function extractParameters(
  app: Koatty,
  ctx: KoattyContext,
  params: ParamMetadata[]
): Promise<unknown[]> {

  if (!params || params.length === 0) {
    return [];
  }

  const handler = strategyCache.getOrCreate(params, app);
  const result = await handler(ctx, params);

  return result as unknown[];
}

/**
 * Export cache manager for testing and debugging
 */
export { strategyCache };

/**
 * Strategy handler factory
 * Creates optimized handlers for each strategy
 */
export class StrategyHandlerFactory {
  /**
   * Create optimized handler for a given strategy
   */
  static createHandler(
    strategy: ExtractionStrategy,
    params: ParamMetadata[],
    app: Koatty
  ): StrategyHandler {

    switch (strategy) {
      // Fastest: Direct property access
      case ExtractionStrategy.SYNC_SINGLE_NO_VALIDATION:
        return this.createSyncSingleNoValidationHandler(params);

      // Fast: Loop over params
      case ExtractionStrategy.SYNC_MULTI_NO_VALIDATION:
        return this.createSyncMultiNoValidationHandler(params);

      // Fast: Single param with validation
      case ExtractionStrategy.SYNC_SINGLE_SIMPLE_VALIDATION:
        return this.createSyncSingleSimpleValidationHandler(params, app);

      // Fast: Multiple params with validation
      case ExtractionStrategy.SYNC_MULTI_SIMPLE_VALIDATION:
        return this.createSyncMultiSimpleValidationHandler(params, app);

      // Fast: DTO transformation
      case ExtractionStrategy.SYNC_DTO_NO_VALIDATION:
      case ExtractionStrategy.SYNC_DTO_WITH_VALIDATION:
        return this.createSyncDtoHandler(params, app);

      // Moderate: Async mixed params
      case ExtractionStrategy.ASYNC_MIXED_PARAMS:
        return this.createAsyncMixedHandler(params, app);

      // Moderate: Async DTO validation
      case ExtractionStrategy.ASYNC_DTO_VALIDATION:
        return this.createAsyncDtoHandler(params, app);

      // Fallback: Generic async path
      case ExtractionStrategy.ASYNC_GENERIC:
        return this.createGenericAsyncHandler(params, app);

      default:
        throw new Error(`Unknown strategy: ${strategy}`);
    }
  }

  /**
   * Fastest: Single param, direct access, no validation
   */
  private static createSyncSingleNoValidationHandler(
    params: ParamMetadata[]
  ): StrategyHandler {
    const param = params[0];
    const precompiledExtractor = param.precompiledExtractor;
    const compiledTypeConverter = param.compiledTypeConverter;
    const defaultValue = param.defaultValue;

    if (!precompiledExtractor) {
      return (ctx: KoattyContext) => {
        const rawValue = extractValueSync(ctx, param);
        const value = rawValue === undefined && defaultValue !== undefined ? defaultValue : rawValue;
        const converted = compiledTypeConverter
          ? compiledTypeConverter(value)
          : value;
        return [converted];
      };
    }

    return (ctx: KoattyContext) => {
      const rawValue = precompiledExtractor(ctx);
      const value = rawValue === undefined && defaultValue !== undefined ? defaultValue : rawValue;
      const converted = compiledTypeConverter
        ? compiledTypeConverter(value)
        : value;
      return [converted];
    };
  }

  /**
   * Fast: Multiple params, loop, no validation
   */
  private static createSyncMultiNoValidationHandler(
    params: ParamMetadata[]
  ): StrategyHandler {
    const handlers = params.map(p => {
      const extractor = p.precompiledExtractor;
      const converter = p.compiledTypeConverter;
      const defaultValue = p.defaultValue;

      if (extractor) {
        if (converter) {
          return (ctx: KoattyContext) => {
            const rawValue = extractor(ctx);
            const value = rawValue === undefined && defaultValue !== undefined ? defaultValue : rawValue;
            return converter(value);
          };
        }
        return (ctx: KoattyContext) => {
          const rawValue = extractor(ctx);
          return rawValue === undefined && defaultValue !== undefined ? defaultValue : rawValue;
        };
      }

      if (converter) {
        return (ctx: KoattyContext) => {
          const rawValue = extractValueSync(ctx, p);
          const value = rawValue === undefined && defaultValue !== undefined ? defaultValue : rawValue;
          return converter(value);
        };
      }
      return (ctx: KoattyContext) => {
        const rawValue = extractValueSync(ctx, p);
        return rawValue === undefined && defaultValue !== undefined ? defaultValue : rawValue;
      };
    });

    return (ctx: KoattyContext) => {
      const results = new Array<unknown>(handlers.length);
      for (let i = 0; i < handlers.length; i++) {
        results[i] = handlers[i](ctx);
      }
      return results as unknown[];
    };
  }

  /**
   * Fast: Single param with simple validation
   */
  private static createSyncSingleSimpleValidationHandler(
    params: ParamMetadata[],
    _app: Koatty
  ): StrategyHandler {
    const param = params[0];
    const extractor = param.precompiledExtractor;
    const converter = param.compiledTypeConverter;
    const validator = param.compiledValidator;
    const defaultValue = param.defaultValue;

    return (ctx: KoattyContext) => {
      const rawValue = extractor
        ? extractor(ctx)
        : extractValueSync(ctx, param);

      const value = rawValue === undefined && defaultValue !== undefined ? defaultValue : rawValue;

      const converted = converter
        ? converter(value)
        : value;

      if (validator) {
        validator(converted);
      }

      return [converted];
    };
  }

  /**
   * Fast: Multiple params with validation
   */
  private static createSyncMultiSimpleValidationHandler(
    params: ParamMetadata[],
    _app: Koatty
  ): StrategyHandler {
    const handlers = params.map(p => {
      const extractor = p.precompiledExtractor;
      const converter = p.compiledTypeConverter;
      const validator = p.compiledValidator;
      const defaultValue = p.defaultValue;

      return (ctx: KoattyContext) => {
        const rawValue = extractor
          ? extractor(ctx)
          : extractValueSync(ctx, p);

        const value = rawValue === undefined && defaultValue !== undefined ? defaultValue : rawValue;

        const converted = converter
          ? converter(value)
          : value;

        if (validator) {
          validator(converted);
        }

        return converted;
      };
    });

    return (ctx: KoattyContext) => {
      const results = new Array<unknown>(handlers.length);
      for (let i = 0; i < handlers.length; i++) {
        results[i] = handlers[i](ctx);
      }
      return results as unknown[];
    };
  }

  /**
   * Fast: DTO transformation
   */
  private static createSyncDtoHandler(
    params: ParamMetadata[],
    _app: Koatty
  ): StrategyHandler {
    const param = params[0];
    const clazz = param.clazz;
    const dtoCheck = param.dtoCheck;
    const type = param.type;
    const extractor = param.precompiledExtractor;
    const fn = param.fn;

    return async (ctx: KoattyContext) => {
      // Handle clazz undefined by getting it from IOC container
      let actualClazz = clazz;
      if (!actualClazz) {
        actualClazz = IOC.getClass(type, "COMPONENT");
        if (!actualClazz) {
          throw Error(`Failed to obtain class ${type}, because class is not registered in container.`);
        }
      }

      // Use precompiled extractor if available, otherwise use custom fn, then bodyParser
      let body: unknown;
      if (extractor) {
        body = await extractor(ctx);
      } else if (fn && typeof fn === 'function') {
        body = await fn(ctx, param.options);
      } else {
        body = await bodyParser(ctx, param.options);
      }

      const transformed = dtoCheck
        ? await ClassValidator.valid(actualClazz, body, true)
        : plainToClass(actualClazz as new (...args: unknown[]) => unknown, body, true);

      return [transformed];
    };
  }

  /**
   * Moderate: Async mixed params (body/file/custom + sync params)
   */
  private static createAsyncMixedHandler(
    params: ParamMetadata[],
    app: Koatty
  ): StrategyHandler {
    const asyncParams: ParamMetadata[] = [];
    const syncParams: ParamMetadata[] = [];

    for (const p of params) {
      if (p.sourceType === ParamSourceType.BODY ||
          p.sourceType === ParamSourceType.FILE ||
          (p.sourceType === ParamSourceType.CUSTOM && p.fn)) {
        asyncParams.push(p);
      } else {
        syncParams.push(p);
      }
    }

    const syncHandlers = syncParams.map(p => {
      const extractor = p.precompiledExtractor;
      const converter = p.compiledTypeConverter;
      const validator = p.compiledValidator;
      const defaultValue = p.defaultValue;

      return (ctx: KoattyContext) => {
        const rawValue = extractor
          ? extractor(ctx)
          : extractValueSync(ctx, p);

        const value = rawValue === undefined && defaultValue !== undefined ? defaultValue : rawValue;

        const converted = converter
          ? converter(value)
          : value;

        if (validator) {
          validator(converted);
        }

        return converted;
      };
    });

    return async (ctx: KoattyContext) => {
      const bodyData = await extractParamSources(ctx, params);

      const asyncResults = asyncParams.map(p => {
        const rawValue = extractValueFromSource(bodyData, p);

        if (rawValue === null && p.fn) {
          return p.fn(ctx, p.options);
        }

        if (rawValue === undefined && p.defaultValue !== undefined) {
          return p.defaultValue;
        }

        const paramOptions = p.precompiledOptions || createParamOptions(p, 0);
        return validateParam(app, ctx, rawValue, paramOptions, p.compiledValidator, p.compiledTypeConverter);
      });

      const syncResults = syncHandlers.map(h => h(ctx));

      const results: unknown[] = [];
      let asyncIndex = 0;
      let syncIndex = 0;

      for (const p of params) {
        if (p.sourceType === ParamSourceType.BODY ||
            p.sourceType === ParamSourceType.FILE ||
            (p.sourceType === ParamSourceType.CUSTOM && p.fn)) {
          results.push(await asyncResults[asyncIndex++]);
        } else {
          results.push(syncResults[syncIndex++]);
        }
      }

      return results;
    };
  }

  /**
   * Moderate: Async DTO validation
   */
  private static createAsyncDtoHandler(
    params: ParamMetadata[],
    _app: Koatty
  ): StrategyHandler {
    const param = params[0];
    const clazz = param.clazz;
    const dtoCheck = param.dtoCheck;
    const type = param.type;
    const extractor = param.precompiledExtractor;
    const fn = param.fn;

    return async (ctx: KoattyContext) => {
      // Handle clazz undefined by getting it from IOC container
      let actualClazz = clazz;
      if (!actualClazz) {
        actualClazz = IOC.getClass(type, "COMPONENT");
        if (!actualClazz) {
          throw Error(`Failed to obtain class ${type}, because class is not registered in container.`);
        }
      }

      // Use precompiled extractor if available, otherwise use custom fn, then bodyParser
      let body: unknown;
      if (extractor) {
        body = await extractor(ctx);
      } else if (fn && typeof fn === 'function') {
        body = await fn(ctx, param.options);
      } else {
        body = await bodyParser(ctx, param.options);
      }

      const transformed = dtoCheck
        ? await ClassValidator.valid(actualClazz, body, true)
        : plainToClass(actualClazz as new (...args: unknown[]) => unknown, body, true);

      return [transformed];
    };
  }

  /**
   * Fallback: Generic async path
   */
  private static createGenericAsyncHandler(
    params: ParamMetadata[],
    app: Koatty
  ): StrategyHandler {
    return async (ctx: KoattyContext) => {
      const sources = await extractParamSources(ctx, params);

      const paramPromises = params.map((v, k) => {
        let rawValue = extractValueFromSource(sources, v);

        if (rawValue === null && v.fn) {
          rawValue = v.fn(ctx, v.options);
        }

        if (rawValue === undefined && v.defaultValue !== undefined) {
          rawValue = v.defaultValue;
        }

        const paramOptions = v.precompiledOptions || createParamOptions(v, k);
        return validateParam(app, ctx, rawValue, paramOptions, v.compiledValidator, v.compiledTypeConverter);
      });

      return Promise.all(paramPromises);
    };
  }
}
