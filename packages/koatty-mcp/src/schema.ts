/**
 * DTO -> JSON Schema bridge for MCP tool input schemas (roadmap Phase F, F-1).
 *
 * Reads the class-validator metadata that `koatty_validation` / `class-validator`
 * decorators already register at class-definition time, so the MCP layer reuses
 * the exact same declaration as HTTP request validation instead of introducing a
 * second parameter-decorator vocabulary.
 *
 * Anything that cannot be mapped statically is listed under
 * `x-koatty-unresolved` instead of being silently dropped.
 *
 * @License BSD-3-Clause
 */
import 'reflect-metadata';
import { getMetadataStorage } from 'class-validator';
import { MCP_UNRESOLVED_MARKER } from './constants';
import type { JsonSchema } from './types';

const PRIMITIVE_TYPES = [String, Number, Boolean, Array, Object, Date, Function];

type ConstraintApplier = (schema: JsonSchema, constraints: any[]) => boolean;

/** class-validator validator name -> JSON Schema constraint. */
const CONSTRAINT_MAP: Record<string, ConstraintApplier> = {
  isstring: (s) => ((s.type = 'string'), true),
  isboolean: (s) => ((s.type = 'boolean'), true),
  isnumber: (s) => ((s.type = 'number'), true),
  isint: (s) => ((s.type = 'integer'), true),
  ispositive: (s) => ((s.type = s.type ?? 'number'), (s.exclusiveMinimum = 0), true),
  isnegative: (s) => ((s.type = s.type ?? 'number'), (s.exclusiveMaximum = 0), true),
  isport: (s) => ((s.type = 'integer'), (s.minimum = 0), (s.maximum = 65535), true),
  isdecimal: (s) => ((s.type = 'number'), true),
  isdate: (s) => ((s.type = 'string'), (s.format = 'date-time'), true),
  isarray: (s) => ((s.type = 'array'), true),
  arrayunique: (s) => ((s.type = 'array'), (s.uniqueItems = true), true),
  arraycontains: () => true,
  isnumberstring: (s) => ((s.type = 'string'), true),
  isemail: (s) => ((s.type = 'string'), (s.format = 'email'), true),
  isurl: (s) => ((s.type = 'string'), (s.format = 'uri'), true),
  isuuid: (s) => ((s.type = 'string'), (s.format = 'uuid'), true),
  isip: (s) => ((s.type = 'string'), true),
  isphonenumber: (s) => ((s.type = 'string'), true),
  isjson: (s) => ((s.type = 'object'), true),
  isobject: (s) => ((s.type = 'object'), true),
  isnotempty: () => true,
  isdefined: () => true,
  minlength: (s, c) => {
    if (typeof c[0] !== 'number') return false;
    s.minLength = c[0];
    return true;
  },
  maxlength: (s, c) => {
    if (typeof c[0] !== 'number') return false;
    s.maxLength = c[0];
    return true;
  },
  length: (s, c) => {
    if (typeof c[0] !== 'number' || typeof c[1] !== 'number') return false;
    s.minLength = c[0];
    s.maxLength = c[1];
    return true;
  },
  min: (s, c) => {
    if (typeof c[0] !== 'number') return false;
    if (s.type === 'array' || s.type === 'string') s.minLength = c[0];
    else s.minimum = c[0];
    return true;
  },
  max: (s, c) => {
    if (typeof c[0] !== 'number') return false;
    if (s.type === 'array' || s.type === 'string') s.maxLength = c[0];
    else s.maximum = c[0];
    return true;
  },
  matches: (s, c) => {
    const pattern = c[0] instanceof RegExp ? c[0].source : typeof c[0] === 'string' ? c[0] : undefined;
    if (!pattern) return false;
    s.pattern = pattern;
    return true;
  },
  isin: (s, c) => {
    if (!Array.isArray(c[0])) return false;
    s.enum = [...c[0]];
    return true;
  },
  isnotin: () => true,
  isenum: (s, c) => {
    const enumObject = c[0];
    if (!enumObject || typeof enumObject !== 'object') return false;
    const values = Object.values(enumObject).filter((v) => typeof v === 'string' || typeof v === 'number');
    if (!values.length) return false;
    s.enum = values as any[];
    return true;
  },
  isbooleanstring: (s) => ((s.type = 'string'), true),
  iscurrency: (s) => ((s.type = 'number'), true),
};

function camelValidatorName(name: string): string {
  return String(name || '').toLowerCase();
}

function safeDesignType(Dto: any, property: string): any {
  try {
    return Reflect.getMetadata('design:type', Dto.prototype, property);
  } catch {
    return undefined;
  }
}

function applyDesignType(Dto: any, property: string, schema: JsonSchema, unresolved: string[], depth: number): void {
  const designType = safeDesignType(Dto, property);
  if (designType === String) {
    schema.type = 'string';
    return;
  }
  if (designType === Number) {
    schema.type = 'number';
    return;
  }
  if (designType === Boolean) {
    schema.type = 'boolean';
    return;
  }
  if (designType === Array) {
    schema.type = 'array';
    return;
  }
  if (designType === Date) {
    schema.type = 'string';
    schema.format = 'date-time';
    return;
  }
  if (designType === Object || !designType) {
    schema.type = 'object';
    return;
  }
  if (PRIMITIVE_TYPES.includes(designType)) {
    schema.type = 'object';
    return;
  }
  if (depth < 3 && typeof designType === 'function') {
    schema.type = 'object';
    schema.properties = dtoToJsonSchema(designType, depth + 1);
    return;
  }
  unresolved.push(`${property}:<nested:${designType?.name ?? 'unknown'}>`);
}

/**
 * Convert a DTO class into a JSON Schema object.
 *
 * @param Dto DTO class decorated with class-validator / koatty_validation rules.
 * @param depth Internal recursion guard for nested DTOs.
 */
export function dtoToJsonSchema(Dto: any, depth = 0): JsonSchema {
  const schema: JsonSchema = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
  const unresolved: string[] = [];

  if (typeof Dto !== 'function') {
    schema[MCP_UNRESOLVED_MARKER] = ['<not-a-dto-class>'];
    return schema;
  }

  let metadatas: any[] = [];
  try {
    metadatas = getMetadataStorage().getTargetValidationMetadatas(Dto, Dto.name, false, false) ?? [];
  } catch (error) {
    unresolved.push(`metadata:${(error as Error).message}`);
  }

  const byProperty = new Map<string, any[]>();
  for (const metadata of metadatas) {
    if (!metadata?.propertyName) continue;
    const list = byProperty.get(metadata.propertyName) ?? [];
    list.push(metadata);
    byProperty.set(metadata.propertyName, list);
  }

  const required: string[] = [];
  for (const [property, list] of byProperty) {
    const propertySchema: JsonSchema = {};
    const each = list.some((item) => item.each === true);
    let optional = false;

    for (const metadata of list) {
      const rawType = camelValidatorName(metadata.type);
      const rawName = camelValidatorName(metadata.name);
      // Standard class-validator rules are stored as `customValidation` with the
      // validator name in `metadata.name`; only the conditional/type kinds are
      // carried by `metadata.type` itself.
      const key = rawType === 'customvalidation' ? rawName : rawType;
      // `@IsOptional()` skips every other rule; class-validator records it as a
      // conditional validation, so both the type and the name are inspected.
      if (rawType === 'isoptional' || rawName === 'isoptional') {
        optional = true;
        continue;
      }
      // `@ValidateIf` / other conditional checks are runtime-only.
      if (rawType === 'conditionalvalidation') continue;
      if (key === 'isdefined' || key === 'allow') continue;
      const applier = CONSTRAINT_MAP[key];
      if (!applier) {
        unresolved.push(`${property}:${metadata.name ?? metadata.type}`);
        continue;
      }
      const applied = applier(propertySchema, Array.isArray(metadata.constraints) ? metadata.constraints : []);
      if (!applied) unresolved.push(`${property}:${metadata.name ?? metadata.type}`);
    }

    if (!Object.keys(propertySchema).length) {
      applyDesignType(Dto, property, propertySchema, unresolved, depth);
    }

    schema.properties[property] = each
      ? { type: 'array', items: Object.keys(propertySchema).length ? propertySchema : {} }
      : propertySchema;

    if (!optional) required.push(property);
  }

  if (required.length) schema.required = required;
  if (unresolved.length) schema[MCP_UNRESOLVED_MARKER] = unresolved;
  return schema;
}

/** Empty object schema used when a tool declares no DTO. */
export function emptyInputSchema(): JsonSchema {
  return { type: 'object', properties: {}, additionalProperties: false };
}
