/**
 * koatty_mcp — MCP Server host for Koatty (roadmap Phase F, item F-1).
 *
 * Exposes Service methods as MCP tools, resources and prompts while reusing
 * Koatty's IoC container, DTO validation, request scope and observability.
 *
 * @License BSD-3-Clause
 */
export * from './types';
export * from './constants';
export { Tool, Resource, Prompt } from './decorators';
export { dtoToJsonSchema, emptyInputSchema } from './schema';
export {
  createRegistry,
  compileUriTemplate,
  resolveDtoClass,
} from './registry';
export type {
  McpRegistry,
  RegisteredTool,
  RegisteredResource,
  RegisteredPrompt,
  ResourceMatch,
  RegistryOptions,
} from './registry';
export {
  createApiKeyAuth,
  createBearerAuth,
  assertScopes,
  checkOrigin,
  hasRequiredScopes,
  readHeader,
  McpAuthError,
  McpScopeError,
} from './security';
export {
  evaluateApproval,
  emitAudit,
  summarizeArguments,
  McpApprovalError,
  McpApprovalTimeoutError,
} from './approval';
export type { ApprovalEvaluationInput } from './approval';
export { createCallContext, runWithContext, runInRequestScope } from './context';
export type { CallContextExtras } from './context';
export { createMcpHost } from './server';
export type { McpHost, CallToolHooks } from './server';
export { createMcpHttpAdapter, DEFAULT_MCP_HOST } from './transport/http';
export type { McpHttpAdapter, McpHttpOptions } from './transport/http';
export { startStdioServer, createInMemoryPair } from './transport/stdio';
export type { StdioOptions } from './transport/stdio';
