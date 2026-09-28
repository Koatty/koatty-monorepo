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

export type ConfigSchema = ValidationSchema | Record<string, unknown> | boolean;
export function isJsonSchema(schema: ConfigSchema): boolean {
  return typeof schema === 'boolean' || !!schema && (
    typeof schema.type === 'string' || Array.isArray(schema.required) || '$schema' in schema
    || 'properties' in schema || 'allOf' in schema || 'anyOf' in schema || '$ref' in schema);
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
  schema: ConfigSchema
): ValidationResult {
  if (isJsonSchema(schema)) {
    let Ajv: any;
    try {
      Ajv = require('ajv');
      if (!require('ajv/package.json').version.startsWith('8.')) throw new Error('AJV 8 required');
    } catch {
      throw new Error('JSON Schema validation requires the optional peer dependency ajv (version 8)');
    }
    const validator = new (Ajv.default || Ajv)({ allErrors: true, useDefaults: true, strict: true }).compile(schema);
    const valid = validator(config);
    return { valid: !!valid, errors: (validator.errors || []).map((error: any) => ({
      path: error.instancePath || error.dataPath || error.params?.missingProperty || '/',
      message: error.message, value: undefined as unknown
    })) };
  }
  const errors: ValidationResult['errors'] = [];

  for (const [key, rule] of Object.entries(schema)) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) ||
      Object.keys(rule).some(key => !['type', 'required', 'default', 'validator', 'min', 'max', 'enum'].includes(key))) {
      throw new Error(`Invalid configuration schema rule: ${key}`);
    }
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
