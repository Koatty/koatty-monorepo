import * as Helper from "koatty_lib";

export interface ValidationSchema {
  [key: string]: {
    type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required?: boolean;
    default?: unknown;
    validator?: (value: unknown) => boolean | string;
    min?: number;
    max?: number;
    enum?: unknown[];
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    path: string;
    message: string;
    value: unknown;
  }>;
}

export function validateConfig<T extends Record<string, unknown>>(
  config: T,
  schema: ValidationSchema
): ValidationResult {
  const errors: ValidationResult['errors'] = [];

  for (const [key, rule] of Object.entries(schema)) {
    const value = config[key];
    const path = key;

    if (rule.required && (value === undefined || value === null)) {
      errors.push({
        path,
        message: `Property '${key}' is required`,
        value
      });
      continue;
    }

    if (value !== undefined && value !== null) {
      if (rule.type) {
        const typeValid = validateType(value, rule.type);
        if (!typeValid) {
          errors.push({
            path,
            message: `Property '${key}' must be of type '${rule.type}'`,
            value
          });
          continue;
        }
      }

      if (rule.min !== undefined && typeof value === 'number' && value < rule.min) {
        errors.push({
          path,
          message: `Property '${key}' must be at least ${rule.min}`,
          value
        });
      }

      if (rule.max !== undefined && typeof value === 'number' && value > rule.max) {
        errors.push({
          path,
          message: `Property '${key}' must be at most ${rule.max}`,
          value
        });
      }

      if (rule.enum && !rule.enum.includes(value)) {
        errors.push({
          path,
          message: `Property '${key}' must be one of: ${rule.enum.join(', ')}`,
          value
        });
      }

      if (rule.validator) {
        const result = rule.validator(value);
        if (result !== true) {
          errors.push({
            path,
            message: typeof result === 'string' ? result : `Property '${key}' is invalid`,
            value
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function validateType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return Helper.isObject(value);
    case 'array':
      return Array.isArray(value);
    default:
      return true;
  }
}

export function applyDefaults<T extends Record<string, unknown>>(
  config: Partial<T>,
  schema: ValidationSchema
): T {
  const result = { ...config } as T;

  for (const [key, rule] of Object.entries(schema)) {
    if (rule.default !== undefined && result[key] === undefined) {
      (result as Record<string, unknown>)[key] = rule.default;
    }
  }

  return result;
}
