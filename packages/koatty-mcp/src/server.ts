/**
 * The MCP host: protocol wiring, dispatch pipeline and security gates
 * (roadmap Phase F, item F-1).
 *
 * Pipeline for every tool call — identical for HTTP and stdio:
 *   1. tool lookup           -> JSON-RPC invalid params when unknown
 *   2. authentication        -> principal (API key / OAuth bearer / stdio)
 *   3. scope check           -> denied before any business code runs
 *   4. DTO validation        -> whitelist stripping + JSON-RPC error on failure
 *   5. approval gate         -> high-risk tools need an explicit decision
 *   6. request scope + ALS   -> container scope + Core context per call
 *   7. audit                 -> redacted structured record
 *
 * Protocol details are delegated to the official `@modelcontextprotocol/sdk`.
 *
 * @License BSD-3-Clause
 */
import { AsyncLocalStorage } from 'async_hooks';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { checkValidated } from 'koatty_validation';
import { MCP_APPROVAL_TIMEOUT_MS, MCP_SERVER_NAME, MCP_SERVER_VERSION } from './constants';
import { McpApprovalError, emitAudit, evaluateApproval, summarizeArguments } from './approval';
import { createCallContext, runInRequestScope, runWithContext } from './context';
import { createRegistry, resolveComponentInstance } from './registry';
import type { McpRegistry, RegisteredTool, ResourceMatch } from './registry';
import { McpAuthError, McpScopeError, assertScopes } from './security';
import type {
  AuditStatus,
  AuthInput,
  McpHostOptions,
  McpPrincipal,
  ToolCallIdentity,
} from './types';

export interface CallToolHooks {
  signal?: AbortSignal;
  progress?: (current: number, total?: number, message?: string) => Promise<void> | void;
}

export interface McpHost {
  readonly server: Server;
  readonly registry: McpRegistry;
  readonly allowedOrigins?: string[];
  createServer(connectionIdentity?: AuthInput): Server;
  /** Resolve the caller identity for a transport request. */
  resolveIdentity(input: AuthInput): Promise<McpPrincipal | null>;
  /** Bind the transport request (headers) to the protocol handlers. */
  runWithIdentity<T>(input: AuthInput, fn: () => Promise<T>): Promise<T>;
  /** Execute one tool call through the full security pipeline. */
  callTool(
    name: string,
    args: Record<string, unknown>,
    identity: ToolCallIdentity,
    hooks?: CallToolHooks,
  ): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toToolResult(result: unknown, tool: RegisteredTool | undefined): CallToolResult {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? null);
  const payload: CallToolResult = { content: [{ type: 'text', text: text ?? 'null' }] };
  if (tool?.outputSchema && isRecord(result)) payload.structuredContent = result;
  return payload;
}

function toResourceContents(result: unknown, uri: string, mimeType: string) {
  if (isRecord(result) && Array.isArray((result as any).contents)) return (result as any).contents;
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? null);
  return [{ uri, mimeType, text: text ?? 'null' }];
}

function toPromptResult(result: unknown, description?: string) {
  if (isRecord(result) && Array.isArray((result as any).messages)) return result as any;
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? null);
  return {
    description,
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: text ?? '' } }],
  };
}

export function createMcpHost(options: McpHostOptions): McpHost {
  const container = options.container ?? options.app?.container;
  if (!container) {
    throw new Error('koatty_mcp: an IoC container is required (pass `container` or `app.container`).');
  }

  const registry = createRegistry({ container, componentTypes: options.componentTypes });
  const security = options.security ?? {};
  const auth = security.auth;
  const strict = security.strict ?? options.app?.security?.name === 'strict';
  const approvalTimeoutMs = security.approvalTimeoutMs ?? MCP_APPROVAL_TIMEOUT_MS;
  const audit = options.audit;
  const identityStorage = new AsyncLocalStorage<AuthInput>();

  const resolveIdentity = async (input: AuthInput): Promise<McpPrincipal | null> => {
    if (input.principal) return input.principal;
    const authenticated = auth ? await auth.authenticate(input) : null;
    if (authenticated) return authenticated;
    const hasHeaders = !!input?.headers && Object.keys(input.headers).length > 0;
    // stdio has no HTTP headers: the adapter decides who the local caller is.
    const principal = input.transport !== 'http' && !hasHeaders ? options.stdioIdentity ?? null : null;
    if (auth && !principal) throw new McpAuthError('Authentication credentials are required.');
    return principal;
  };

  const executeTool = async (
    name: string,
    args: Record<string, unknown>,
    identity: ToolCallIdentity,
    hooks: CallToolHooks & { auditState?: { recorded: boolean } } = {},
  ): Promise<unknown> => {
    hooks.signal?.throwIfAborted();
    if (auth && !identity.principal) throw new McpAuthError('Authentication credentials are required.');
    const started = Date.now();
    const tool = registry.getTool(name);
    if (!tool) throw new McpError(ErrorCode.InvalidParams, `Unknown tool "${name}".`);

    const caller = identity.principal?.id ?? 'anonymous';
    const argumentSummary = summarizeArguments(args, options.redact);
    const record = (
      status: AuditStatus,
      summary: Record<string, unknown>,
      error?: string,
    ) => {
      if (hooks.auditState) hooks.auditState.recorded = true;
      return emitAudit(audit, {
        tool: name,
        caller,
        sessionId: identity.sessionId,
        requestId: identity.requestId,
        status,
        durationMs: Date.now() - started,
        argumentSummary: summary,
        error,
      });
    };

    // 3. scope check — before validation, approval and business code.
    try {
      assertScopes(identity.principal, tool.scopes, `tool "${tool.name}"`);
    } catch (error) {
      await record('denied', argumentSummary, (error as Error).message);
      throw error;
    }

    // 4. argument validation: same whitelist policy as the HTTP request body.
    if (!tool.dto && Object.keys(args).length) {
      await record('invalid', argumentSummary, 'Tool without a DTO accepts only empty arguments.');
      throw new McpError(ErrorCode.InvalidParams, 'Tool without a DTO accepts only empty arguments.');
    }
    let validatedArgs: Record<string, unknown> = args;
    if (tool.dto) {
      try {
        const { validatedArgs: checked } = await checkValidated([args], [tool.dto], tool.partial);
        if (isRecord(checked?.[0])) validatedArgs = checked[0];
      } catch (error) {
        const message = (error as Error).message || 'Invalid tool arguments.';
        await record('invalid', argumentSummary, message);
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid arguments for tool "${tool.name}": ${message}`,
        );
      }
    }
    const summary = summarizeArguments(validatedArgs, options.redact);
    hooks.signal?.throwIfAborted();

    // 5. human approval for high-risk tools (fails closed without a backend).
    let approval:
      | { approved: boolean; ticketId?: string; reason?: string }
      | undefined;
    const approvalStarted = Date.now();
    const observeApproval = (event: Parameters<NonNullable<typeof options.onApproval>>[0]) => {
      try { options.onApproval?.(event); } catch { /* observer must not change approval/audit semantics */ }
    };
    try {
      approval = await evaluateApproval({
        tool: tool.name,
        annotations: tool.annotations,
        requireApproval: tool.requireApproval,
        args: validatedArgs,
        principal: identity.principal,
        sessionId: identity.sessionId,
        requestId: identity.requestId,
        service: options.approval,
        strict,
        timeoutMs: approvalTimeoutMs,
        redact: options.redact,
        signal: hooks.signal,
      });
    } catch (error) {
      if (tool.requireApproval === true || (strict && tool.annotations.destructiveHint && tool.requireApproval !== false)) {
        observeApproval({ tool: name, decision: (error as Error).name === 'McpApprovalTimeoutError' ? 'timeout' : 'rejected', durationMs: Date.now() - approvalStarted });
      }
      await record(hooks.signal?.aborted ? 'cancelled' : 'denied', summary, (error as Error).message);
      throw error;
    }
    hooks.signal?.throwIfAborted();
    if (tool.requireApproval === true || (strict && tool.annotations.destructiveHint && tool.requireApproval !== false)) {
      observeApproval({ tool: name, decision: approval.approved ? 'approved' : 'rejected', durationMs: Date.now() - approvalStarted });
    }
    if (!approval.approved) {
      const message = `Tool "${tool.name}" was not approved (${approval.reason ?? 'rejected'}).`;
      await record('denied', summary, message);
      throw new McpError(ErrorCode.InvalidRequest, message);
    }

    // 6. per-call request scope + Core ALS, then invoke through the IoC container.
    const ctx = createCallContext(options.app, identity, {
      toolName: tool.name,
      signal: hooks.signal,
      progress: hooks.progress,
    });
    try {
      const result = await runWithContext(options.app, ctx, () =>
        runInRequestScope(container, ctx, async () => {
          const instance = resolveComponentInstance(container, tool);
          const handler = instance?.[tool.methodName];
          if (typeof handler !== 'function') {
            throw new Error(`Tool handler ${tool.className}.${tool.methodName} is not callable.`);
          }
          const proceed = async () => { hooks.signal?.throwIfAborted(); return await handler.call(instance, validatedArgs, ctx); };
          return await proceed();
        }),
      );
      await record(hooks.signal?.aborted ? 'cancelled' : 'success', summary);
      return result;
    } catch (error) {
      const message = (error as Error).message || 'Tool execution failed.';
      await record(hooks.signal?.aborted ? 'cancelled' : 'error', summary, message);
      throw error;
    }
  };

  const callTool: McpHost['callTool'] = async (name, args, identity, hooks = {}) => {
    const ctx = createCallContext(options.app, identity, { toolName: name, signal: hooks.signal, progress: hooks.progress });
    return runWithContext(options.app, ctx, async () => {
      const auditState = { recorded: false };
      const started = Date.now();
      const proceed = () => executeTool(name, args, identity, { ...hooks, auditState });
      try { return await (options.aroundTool ? options.aroundTool({ name, args, identity }, proceed) : proceed()); }
      catch (error) {
        if (!auditState.recorded) await emitAudit(audit, { tool: name, caller: identity.principal?.id ?? 'anonymous', sessionId: identity.sessionId, requestId: identity.requestId,
          status: hooks.signal?.aborted ? 'cancelled' : 'denied', durationMs: Date.now() - started, argumentSummary: summarizeArguments(args, options.redact), error: 'tool-preflight-rejected' });
        throw error;
      }
    });
  };

  const createServer = (connectionIdentity?: AuthInput): Server => {
  const server = new Server(
    {
      name: options.serverName ?? MCP_SERVER_NAME,
      version: options.serverVersion ?? MCP_SERVER_VERSION,
    },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: options.instructions,
    },
  );

  const prepare = async (extra: any, request: any) => {
    const authInput = identityStorage.getStore() ?? connectionIdentity ?? { headers: {} };
    let principal;
    try { principal = await resolveIdentity(authInput); }
    catch (error) { throw new McpError(ErrorCode.InvalidRequest, `[McpAuthError] ${(error as Error).message}`); }
    const identity: ToolCallIdentity = {
      principal,
      sessionId: extra?.sessionId ?? 'local',
      requestId: extra?.requestId !== undefined ? String(extra.requestId) : '0',
      headers: authInput.headers ?? {},
    };
    const progressToken = request?.params?._meta?.progressToken;
    const progress =
      progressToken === undefined
        ? undefined
        : async (current: number, total?: number, message?: string) => {
            await extra.sendNotification({
              method: 'notifications/progress',
              params: { progressToken, progress: current, total, message },
            });
          };
    const signal = authInput.signal && extra?.signal
      ? AbortSignal.any([authInput.signal, extra.signal]) : authInput.signal ?? extra?.signal;
    return { identity, progress, signal };
  };

  const invokeMember = async (
    identity: ToolCallIdentity,
    classId: string,
    componentType: string,
    target: Function,
    className: string,
    methodName: string,
    argument: unknown,
    hooks: CallToolHooks,
    toolName: string,
  ): Promise<unknown> => {
    const ctx = createCallContext(options.app, identity, {
      toolName,
      signal: hooks.signal,
      progress: hooks.progress,
    });
    return await runWithContext(options.app, ctx, () =>
      runInRequestScope(container, ctx, async () => {
        const instance = resolveComponentInstance(container, { classId, componentType, target });
        const handler = instance?.[methodName];
        if (typeof handler !== 'function') {
          throw new Error(`Handler ${className}.${methodName} is not callable.`);
        }
        return await handler.call(instance, argument, ctx);
      }),
    );
  };

  // --- tools ---------------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => { await prepare(extra, _request); return ({
    tools: registry.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
    })),
  }); });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const { identity, progress, signal } = await prepare(extra, request);
      const result = await callTool(name, args, identity, { signal, progress });
      return toToolResult(result, registry.getTool(name));
    } catch (error) {
      if (error instanceof McpError) throw error;
      if (
        error instanceof McpAuthError ||
        error instanceof McpScopeError ||
        error instanceof McpApprovalError
      ) {
        throw new McpError(ErrorCode.InvalidRequest, `[${error.name}] ${error.message}`);
      }
      return {
        content: [{ type: 'text', text: `Tool "${name}" failed: ${(error as Error).message}` }],
        isError: true,
      };
    }
  });

  // --- resources -----------------------------------------------------------
  server.setRequestHandler(ListResourcesRequestSchema, async (request, extra) => { await prepare(extra, request); return ({
    resources: registry.resources.filter(resource => !resource.paramNames.length).map((resource) => ({
      uri: resource.uriTemplate,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    })),
  }); });
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request, extra) => {
    await prepare(extra, request);
    return { resourceTemplates: registry.resources.filter(r => r.paramNames.length).map(r => ({ uriTemplate: r.uriTemplate, name: r.name, description: r.description, mimeType: r.mimeType })) };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
    const uri = request.params.uri;
    try {
      const { identity, progress, signal } = await prepare(extra, request);
      const match: ResourceMatch | undefined = registry.matchResource(uri);
      if (!match) throw new McpError(ErrorCode.InvalidParams, `Unknown resource "${uri}".`);
      assertScopes(identity.principal, match.resource.scopes, `resource "${match.resource.uriTemplate}"`);
      const result = await invokeMember(
        identity,
        match.resource.classId,
        match.resource.componentType,
        match.resource.target,
        match.resource.className,
        match.resource.methodName,
        match.params,
        { signal, progress },
        match.resource.uriTemplate,
      );
      return { contents: toResourceContents(result, uri, match.resource.mimeType) };
    } catch (error) {
      if (error instanceof McpError) throw error;
      if (error instanceof McpAuthError || error instanceof McpScopeError) {
        throw new McpError(ErrorCode.InvalidRequest, `[${error.name}] ${error.message}`);
      }
      throw new McpError(ErrorCode.InternalError, `Resource "${uri}" failed: ${(error as Error).message}`);
    }
  });

  // --- prompts -------------------------------------------------------------
  server.setRequestHandler(ListPromptsRequestSchema, async (request, extra) => { await prepare(extra, request); return ({
    prompts: registry.prompts.map((prompt) => ({
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
  }); });

  server.setRequestHandler(GetPromptRequestSchema, async (request, extra) => {
    const name = request.params.name;
    const { identity, progress, signal } = await prepare(extra, request);
    const prompt = registry.getPrompt(name);
    if (!prompt) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt "${name}".`);
    assertScopes(identity.principal, prompt.scopes, `prompt "${prompt.name}"`);
    const result = await invokeMember(
      identity,
      prompt.classId,
      prompt.componentType,
      prompt.target,
      prompt.className,
      prompt.methodName,
      request.params.arguments ?? {},
      { signal, progress },
      prompt.name,
    );
    return toPromptResult(result, prompt.description);
  });
  return server;
  };

  return {
    server: createServer(),
    createServer,
    allowedOrigins: security.allowedOrigins,
    registry,
    resolveIdentity,
    runWithIdentity: <T>(input: AuthInput, fn: () => Promise<T>) => identityStorage.run(input, fn),
    callTool,
  };
}
