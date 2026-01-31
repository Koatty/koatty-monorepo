/**
 * @ author: richen
 * @ copyright: Copyright (c) - <richenlin(at)gmail.com>
 * @ license: BSD (3-Clause)
 * @ version: 2025-01-31
 */

import { Exception } from "./exception";
import { CommonErrorCode } from "./code";
import { isException, toSafeError } from "./utils";

/**
 * Exception constructor type
 */
export type ExceptionConstructor<T extends Exception = Exception> = new (
  message: string,
  code?: number,
  status?: number
) => T;

/**
 * Catch decorator options interface
 */
export interface CatchOptions<T extends Exception = Exception> {
  /**
   * Business error code
   * @default 1 (CommonErrorCode.GENERAL_ERROR)
   */
  code?: number;

  /**
   * HTTP status code
   * @default 500
   */
  status?: number;

  /**
   * Error message template
   * - string: Fixed message
   * - function: Dynamic message generator (err) => string
   * @default Uses original error's message
   */
  message?: string | ((err: Error) => string);

  /**
   * Custom Exception class
   * Caught errors will be converted to instances of this class
   * @default Exception
   */
  exception?: ExceptionConstructor<T>;

  /**
   * Error types to catch
   * - If specified, only catch these types of errors
   * - Other error types will be re-thrown
   * @default Catches all errors
   */
  catchTypes?: (new (...args: any[]) => Error)[];

  /**
   * Whether to suppress the error (for special scenarios)
   * @default false - Converted exception will be thrown
   */
  suppress?: boolean;

  /**
   * Error transformation callback
   * Process the exception before throwing
   */
  transform?: (exception: T, originalError: Error) => T;

  /**
   * Whether to preserve the original stack trace
   * @default true
   */
  preserveStack?: boolean;
}

/**
 * Check if value is an Exception constructor
 */
function isExceptionConstructor(
  value: unknown
): value is ExceptionConstructor {
  return (
    typeof value === 'function' &&
    (value === Exception || value.prototype instanceof Exception)
  );
}

/**
 * Check if error should be caught based on catchTypes
 */
function shouldCatch(
  error: Error,
  catchTypes?: (new (...args: any[]) => Error)[]
): boolean {
  if (!catchTypes || catchTypes.length === 0) {
    return true; // Catch all errors
  }
  return catchTypes.some(ErrorType => error instanceof ErrorType);
}

/**
 * Parse decorator arguments into CatchOptions
 */
function parseOptions<T extends Exception>(
  args: unknown[]
): CatchOptions<T> {
  if (args.length === 0) {
    return {};
  }

  const first = args[0];

  // @Catch(ExceptionClass)
  if (isExceptionConstructor(first)) {
    return { exception: first as ExceptionConstructor<T> };
  }

  // @Catch(code, message?)
  if (typeof first === 'number') {
    return {
      code: first,
      message: typeof args[1] === 'string' ? args[1] : undefined,
    };
  }

  // @Catch([ErrorType1, ErrorType2], options?)
  if (Array.isArray(first)) {
    const errorTypes = first as (new (...args: any[]) => Error)[];
    const options = (args[1] as Omit<CatchOptions<T>, 'catchTypes'>) ?? {};
    return {
      ...options,
      catchTypes: errorTypes,
    };
  }

  // @Catch({ ... })
  if (typeof first === 'object' && first !== null) {
    return first as CatchOptions<T>;
  }

  return {};
}

/**
 * Method decorator: Actively catch errors during method execution and convert to Exception
 * 
 * @description
 * This decorator wraps the method in a try-catch block and converts caught errors
 * to Exception instances. It supports multiple calling conventions for flexibility.
 * 
 * @overload No parameters, use default configuration
 * @example
 * ```typescript
 * @Catch()
 * async findUser(id: string) { ... }
 * ```
 * 
 * @overload Pass configuration object
 * @example
 * ```typescript
 * @Catch({ code: 1001, status: 400, message: 'User query failed' })
 * async findUser(id: string) { ... }
 * ```
 * 
 * @overload Pass Exception class (shorthand)
 * @example
 * ```typescript
 * @Catch(ValidationException)
 * async createUser(data: UserDTO) { ... }
 * ```
 * 
 * @overload Pass error code and message (shorthand)
 * @example
 * ```typescript
 * @Catch(1001, 'Operation failed')
 * async deleteUser(id: string) { ... }
 * ```
 * 
 * @overload Catch specific error types only
 * @example
 * ```typescript
 * @Catch([TypeError, RangeError], { code: 3001, message: 'Type error' })
 * async processData(data: unknown) { ... }
 * ```
 */
export function Catch(): MethodDecorator;
export function Catch<T extends Exception>(
  exception: ExceptionConstructor<T>
): MethodDecorator;
export function Catch(code: number, message?: string): MethodDecorator;
export function Catch<T extends Exception>(
  options: CatchOptions<T>
): MethodDecorator;
export function Catch<T extends Exception>(
  errorTypes: (new (...args: any[]) => Error)[],
  options?: Omit<CatchOptions<T>, 'catchTypes'>
): MethodDecorator;
export function Catch<T extends Exception = Exception>(
  ...args: unknown[]
): MethodDecorator {
  const options = parseOptions<T>(args);

  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<any>
  ): TypedPropertyDescriptor<any> {
    const originalMethod = descriptor.value;

    if (typeof originalMethod !== 'function') {
      throw new Error(
        `@Catch() can only be applied to methods, but "${String(propertyKey)}" is not a function`
      );
    }

    descriptor.value = async function (
      this: unknown,
      ...methodArgs: unknown[]
    ): Promise<unknown> {
      try {
        const result = originalMethod.apply(this, methodArgs);
        // Handle both Promise and regular return values
        if (result instanceof Promise) {
          return await result;
        }
        return result;
      } catch (err) {
        const safeError = toSafeError(err);

        // Check if this type of error should be caught
        if (!shouldCatch(safeError, options.catchTypes)) {
          throw err; // Don't catch, re-throw
        }

        // If already an Exception and no new options specified, preserve it
        if (
          isException(err) &&
          !options.exception &&
          options.code === undefined &&
          options.message === undefined &&
          options.status === undefined
        ) {
          throw err;
        }

        // Construct new Exception
        const ExceptionClass = options.exception ?? Exception;

        // Parse error message
        let errorMessage: string;
        if (typeof options.message === 'function') {
          errorMessage = options.message(safeError);
        } else if (typeof options.message === 'string') {
          errorMessage = options.message;
        } else {
          errorMessage = safeError.message;
        }

        // Determine if we should use custom Exception's defaults
        // When only exception class is specified without code/status,
        // let the custom Exception class use its own default values
        const useCustomDefaults =
          options.exception !== undefined &&
          options.code === undefined &&
          options.status === undefined;

        // Parse error code (prefer config, fallback to original error's code or undefined for custom defaults)
        const errorCode = useCustomDefaults
          ? undefined
          : options.code ??
            (isException(err) ? err.code : CommonErrorCode.GENERAL_ERROR);

        // Parse status code
        const errorStatus = useCustomDefaults
          ? undefined
          : options.status ?? (isException(err) ? err.status : 500);

        // Create new Exception instance
        const exception = new ExceptionClass(
          errorMessage,
          errorCode,
          errorStatus
        );

        // Preserve original stack trace (if configured)
        if (options.preserveStack !== false && safeError.stack) {
          exception.setStack(safeError.stack);
        }

        // Apply transform function
        const finalException = options.transform
          ? options.transform(exception as T, safeError)
          : exception;

        // If suppress is true, don't throw (for special scenarios)
        if (options.suppress) {
          return undefined;
        }

        throw finalException;
      }
    };

    // Preserve original method metadata
    Object.defineProperty(descriptor.value, 'name', {
      value: originalMethod.name,
      configurable: true,
    });

    // Copy any existing metadata from the original method
    if (originalMethod.length !== undefined) {
      Object.defineProperty(descriptor.value, 'length', {
        value: originalMethod.length,
        configurable: true,
      });
    }

    return descriptor;
  };
}

