/**
 * Component discovery for the Koatty MCP host (roadmap Phase F, F-1).
 * Walks the IoC container's component list and turns the `@Tool` / `@Resource`
 * / `@Prompt` metadata into protocol descriptors. The DTO of a tool is taken
 * from the `@Validated({ types: [Dto] })` bridge, so HTTP validation and MCP
 * input schemas come from one declaration.
 *
 * @License BSD-3-Clause
 */
import 'reflect-metadata';
import { recursiveGetMetadata } from 'koatty_container';
import { PARAM_DTO_KEY } from 'koatty_validation';
import { MCP_COMPONENT_TYPES, MCP_PROMPT_KEY, MCP_RESOURCE_KEY, MCP_TOOL_KEY } from './constants';
import { dtoToJsonSchema, emptyInputSchema } from './schema';
import type {
  JsonSchema,
  PromptOptions,
  ProtocolArgument,
  ResourceOptions,
  ToolAnnotations,
  ToolOptions,
} from './types';

/** The bridge key is read defensively so an older koatty_validation still works. */
const DTO_TYPES_KEY = typeof PARAM_DTO_KEY === 'string' ? PARAM_DTO_KEY : 'PARAM_DTO_KEY';

const PRIMITIVE_TYPES = [String, Number, Boolean, Array, Object, Date, Function];

export interface RegisteredTool {
  name: string;
  title?: string;
  description?: string;
  annotations: ToolAnnotations;
  scopes: string[];
  requireApproval?: boolean;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  dto?: any;
  partial: boolean;
  classId: string;
  componentType: string;
  className: string;
  methodName: string;
  target: Function;
}

export interface RegisteredResource {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType: string;
  scopes: string[];
  params: ProtocolArgument[];
  paramNames: string[];
  matcher: RegExp;
  classId: string;
  componentType: string;
  className: string;
  methodName: string;
  target: Function;
}

export interface RegisteredPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments: ProtocolArgument[];
  scopes: string[];
  classId: string;
  componentType: string;
  className: string;
  methodName: string;
  target: Function;
}

/** Where a registered handler lives, used to resolve its IoC instance. */
export interface ComponentRef {
  classId: string;
  componentType: string;
  target: Function;
}

/**
 * Resolve the container instance for a registered handler.
 *
 * `getInsByClass` relies on the container's own type bookkeeping, which is not
 * guaranteed for every component type, so the explicit identifier + type lookup
 * is tried as well. Never constructs an instance on its own: a handler that
 * cannot be resolved from the container is an error, not a silent `new`.
 */
export function resolveComponentInstance(container: any, ref: ComponentRef): any {
  if (!container) return undefined;
  if (typeof container.get === 'function') {
    try {
      const byIdentifier = container.get(ref.classId, ref.componentType);
      if (byIdentifier) return byIdentifier;
    } catch {
      // fall through to the class lookup
    }
  }
  if (typeof container.getInsByClass === 'function') {
    try {
      const direct = container.getInsByClass(ref.target);
      if (direct) return direct;
    } catch {
      // fall through to the identifier lookup
    }
  }
  if (typeof container.getClass === 'function' && typeof container.getInsByClass === 'function') {
    const clazz = container.getClass(ref.classId, ref.componentType);
    if (clazz) {
      try {
        const byClass = container.getInsByClass(clazz);
        if (byClass) return byClass;
      } catch {
        // unresolvable
      }
    }
  }
  return undefined;
}

export interface ResourceMatch {
  resource: RegisteredResource;
  params: Record<string, string>;
}

export interface McpRegistry {
  tools: RegisteredTool[];
  resources: RegisteredResource[];
  prompts: RegisteredPrompt[];
  getTool(name: string): RegisteredTool | undefined;
  getPrompt(name: string): RegisteredPrompt | undefined;
  matchResource(uri: string): ResourceMatch | undefined;
}

export interface RegistryOptions {
  container: any;
  componentTypes?: string[];
}

/** Compile `order://{orderNo}` into a matcher plus the ordered parameter names. */
export function compileUriTemplate(template: string): { matcher: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  let source = '^';
  for (const part of String(template).split(/(\{[^}]+\})/g)) {
    const placeholder = /^\{([^}]+)\}$/.exec(part);
    if (placeholder) {
      paramNames.push(placeholder[1]);
      source += '([^/?#]+)';
    } else {
      source += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  source += '$';
  return { matcher: new RegExp(source, 'i'), paramNames };
}

/**
 * `listClass(type)` keys are prefixed with the component type (`SERVICE:OrderTools`),
 * while `container.get/getClass` expect the bare identifier. Normalise once here so
 * both the discovery ids and the instance lookup use the same value.
 */
function normalizeClassId(id: string, type: string): string {
  const value = String(id ?? '');
  const prefix = `${type}:`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function listComponents(container: any, type: string): Array<{ id: string; target: Function }> {
  try {
    const list = container?.listClass?.(type);
    if (Array.isArray(list)) return list.filter((item) => item && typeof item.target === 'function');
  } catch {
    // a container without that component type simply contributes nothing
  }
  return [];
}

/** Resolve the DTO class of a tool method: explicit option > @Validated bridge > design:paramtypes. */
export function resolveDtoClass(
  prototype: any,
  methodName: string,
  dtoMetadatas: Record<string, any>,
  explicit?: any[],
): any | undefined {
  if (Array.isArray(explicit) && explicit.length && typeof explicit[0] === 'function') return explicit[0];
  const bridged = dtoMetadatas?.[methodName]?.dtoTypes;
  if (Array.isArray(bridged) && bridged.length && typeof bridged[0] === 'function') return bridged[0];
  try {
    const paramTypes = Reflect.getMetadata('design:paramtypes', prototype, methodName);
    if (Array.isArray(paramTypes) && paramTypes.length) {
      const candidate = paramTypes[0];
      if (typeof candidate === 'function' && !PRIMITIVE_TYPES.includes(candidate)) return candidate;
    }
  } catch {
    // design:paramtypes is absent in TC39 mode; the bridge above is authoritative
  }
  return undefined;
}

export function createRegistry(options: RegistryOptions): McpRegistry {
  const container = options.container;
  if (!container) throw new Error('koatty_mcp: createRegistry requires an IoC container.');

  const tools: RegisteredTool[] = [];
  const resources: RegisteredResource[] = [];
  const prompts: RegisteredPrompt[] = [];
  const seenClasses = new Set<string>();
  const seenToolNames = new Set<string>();
  const seenResourceTemplates = new Set<string>();
  const seenPromptNames = new Set<string>();

  for (const componentType of options.componentTypes ?? MCP_COMPONENT_TYPES) {
    for (const component of listComponents(container, componentType)) {
      const target: any = component.target;
      const className = target?.name ?? component.id;
      if (seenClasses.has(className)) continue;
      seenClasses.add(className);
      const prototype = target.prototype;
      if (!prototype) continue;

      const toolMetadatas: Record<string, ToolOptions> = recursiveGetMetadata(container, MCP_TOOL_KEY, prototype) ?? {};
      const resourceMetadatas: Record<string, ResourceOptions> = recursiveGetMetadata(container, MCP_RESOURCE_KEY, prototype) ?? {};
      const promptMetadatas: Record<string, PromptOptions> = recursiveGetMetadata(container, MCP_PROMPT_KEY, prototype) ?? {};
      const dtoMetadatas: Record<string, any> = recursiveGetMetadata(container, DTO_TYPES_KEY, prototype) ?? {};

      for (const methodName of Object.keys(toolMetadatas)) {
        const meta = toolMetadatas[methodName];
        if (!meta) continue;
        if (seenToolNames.has(meta.name)) {
          throw new Error(`koatty_mcp: duplicate tool name "${meta.name}" (component ${className}).`);
        }
        seenToolNames.add(meta.name);
        const dto = resolveDtoClass(prototype, methodName, dtoMetadatas, meta.types);
        const partial = dtoMetadatas?.[methodName]?.partial === true;
        tools.push({
          name: meta.name,
          title: meta.title,
          description: meta.description,
          annotations: { ...(meta.annotations ?? {}) },
          scopes: Array.isArray(meta.scopes) ? [...meta.scopes] : [],
          requireApproval: meta.requireApproval,
          inputSchema: dto ? dtoToJsonSchema(dto) : emptyInputSchema(),
          outputSchema: meta.outputSchema,
          dto,
          partial,
          classId: normalizeClassId(component.id, componentType),
          componentType,
          className,
          methodName,
          target,
        });
      }

      for (const methodName of Object.keys(resourceMetadatas)) {
        const meta = resourceMetadatas[methodName];
        if (!meta) continue;
        if (seenResourceTemplates.has(meta.uri)) {
          throw new Error(`koatty_mcp: duplicate resource uri template "${meta.uri}" (component ${className}).`);
        }
        seenResourceTemplates.add(meta.uri);
        const { matcher, paramNames } = compileUriTemplate(meta.uri);
        resources.push({
          uriTemplate: meta.uri,
          name: meta.name ?? meta.uri,
          description: meta.description,
          mimeType: meta.mimeType ?? 'application/json',
          scopes: Array.isArray(meta.scopes) ? [...meta.scopes] : [],
          params: paramNames.map((name) => ({ name, required: true })),
          paramNames,
          matcher,
          classId: normalizeClassId(component.id, componentType),
          componentType,
          className,
          methodName,
          target,
        });
      }

      for (const methodName of Object.keys(promptMetadatas)) {
        const meta = promptMetadatas[methodName];
        if (!meta) continue;
        if (seenPromptNames.has(meta.name)) {
          throw new Error(`koatty_mcp: duplicate prompt name "${meta.name}" (component ${className}).`);
        }
        seenPromptNames.add(meta.name);
        prompts.push({
          name: meta.name,
          title: meta.title,
          description: meta.description,
          arguments: Array.isArray(meta.arguments) ? meta.arguments.map((item) => ({ ...item })) : [],
          scopes: Array.isArray(meta.scopes) ? [...meta.scopes] : [],
          classId: normalizeClassId(component.id, componentType),
          componentType,
          className,
          methodName,
          target,
        });
      }
    }
  }

  return {
    tools,
    resources,
    prompts,
    getTool: (name: string) => tools.find((tool) => tool.name === name),
    getPrompt: (name: string) => prompts.find((prompt) => prompt.name === name),
    matchResource: (uri: string) => {
      for (const resource of resources) {
        const match = resource.matcher.exec(uri);
        if (!match) continue;
        const params: Record<string, string> = {};
        resource.paramNames.forEach((name, index) => {
          params[name] = decodeURIComponent(match[index + 1] ?? '');
        });
        return { resource, params };
      }
      return undefined;
    },
  };
}
