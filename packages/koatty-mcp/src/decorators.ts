/**
 * Protocol metadata decorators for the Koatty MCP host (roadmap Phase F, F-1).
 *
 * `@Tool` / `@Resource` / `@Prompt` are the ONLY new vocabulary Phase F adds.
 * They are method decorators that keep working in both the legacy
 * (`experimentalDecorators`) and the TC39 decorator modes, exactly like the
 * `@Validated` decorator of `koatty_validation`.
 *
 * @License BSD-3-Clause
 */
import { IOCContainer } from 'koatty_container';
import { MCP_PROMPT_KEY, MCP_RESOURCE_KEY, MCP_TOOL_KEY } from './constants';
import type { PromptOptions, ResourceOptions, ToolOptions } from './types';

type MetadataSaver = (prototype: object) => void;

function saveMetadata(
  key: string,
  meta: Record<string, any>,
  target: any,
  methodName: string | symbol,
  context?: any,
): void {
  const save: MetadataSaver = (prototype: object) => {
    IOCContainer.savePropertyData(key, meta, prototype, methodName);
  };
  if (context) {
    context.addInitializer(function (this: any) {
      save(Object.getPrototypeOf(this));
    });
    return;
  }
  save(target);
}

function normalizeTool(options: ToolOptions): Record<string, any> {
  if (!options || typeof options.name !== 'string' || !options.name.trim()) {
    throw new Error('@Tool requires a non-empty `name`.');
  }
  return {
    ...options,
    name: options.name.trim(),
    scopes: Array.isArray(options.scopes) ? [...options.scopes] : [],
    annotations: { ...(options.annotations ?? {}) },
  };
}

/**
 * Expose a Service method as an MCP tool.
 *
 * ```ts
 * @Tool({ name: 'order_query', annotations: { readOnlyHint: true } })
 * @Validated({ async: false, types: [QueryOrderDto] })
 * async query(input: QueryOrderDto) {}
 * ```
 */
export function Tool(options: ToolOptions): any {
  const meta = normalizeTool(options);
  return IOCContainer.createDecorator(
    ({ target, methodName, descriptor, context }: any) => {
      saveMetadata(MCP_TOOL_KEY, meta, target, methodName, context);
      return descriptor;
    },
    'method',
  );
}

/** Expose a Service method as an MCP resource (URI template with `{param}` placeholders). */
export function Resource(options: ResourceOptions): any {
  if (!options || typeof options.uri !== 'string' || !options.uri.trim()) {
    throw new Error('@Resource requires a non-empty `uri` template.');
  }
  const meta = {
    ...options,
    uri: options.uri.trim(),
    scopes: Array.isArray(options.scopes) ? [...options.scopes] : [],
  };
  return IOCContainer.createDecorator(
    ({ target, methodName, descriptor, context }: any) => {
      saveMetadata(MCP_RESOURCE_KEY, meta, target, methodName, context);
      return descriptor;
    },
    'method',
  );
}

/** Expose a Service method as an MCP prompt. */
export function Prompt(options: PromptOptions): any {
  if (!options || typeof options.name !== 'string' || !options.name.trim()) {
    throw new Error('@Prompt requires a non-empty `name`.');
  }
  const meta = {
    ...options,
    name: options.name.trim(),
    arguments: Array.isArray(options.arguments) ? [...options.arguments] : [],
    scopes: Array.isArray(options.scopes) ? [...options.scopes] : [],
  };
  return IOCContainer.createDecorator(
    ({ target, methodName, descriptor, context }: any) => {
      saveMetadata(MCP_PROMPT_KEY, meta, target, methodName, context);
      return descriptor;
    },
    'method',
  );
}
