/**
 * Public types of the Koatty MCP host (roadmap Phase F, item F-1).
 * @License BSD-3-Clause
 */

export type JsonSchema = Record<string, any>;

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolOptions {
  /** Protocol tool name (`order_query`). Must be unique per application. */
  name: string;
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
  /** Required caller scopes; enforced on every transport before the body runs. */
  scopes?: string[];
  /** High-risk tool: needs an explicit approval decision before execution. */
  requireApproval?: boolean;
  /** Explicit DTO class for the input schema; otherwise bridged from `@Validated({ types })`. */
  types?: any[];
  outputSchema?: JsonSchema;
}

export interface ResourceOptions {
  /** RFC 6570 style template, e.g. `order://{orderNo}`. */
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  scopes?: string[];
}

export interface ProtocolArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptOptions {
  name: string;
  title?: string;
  description?: string;
  arguments?: ProtocolArgument[];
  scopes?: string[];
}

/** Caller identity resolved by the transport layer. */
export interface McpPrincipal {
  id: string;
  scopes: string[];
  kind?: 'api-key' | 'oauth' | 'stdio' | 'anonymous';
  claims?: Record<string, unknown>;
}

export interface AuthInput {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  sessionId?: string;
  transport?: 'http' | 'stdio';
  /** Trusted adapter identity, never copied from a request body. */
  principal?: McpPrincipal | null;
  signal?: AbortSignal;
}

/** Pluggable authentication: API key (internal services) or OAuth 2.1 bearer token. */
export interface AuthProvider {
  authenticate(input: AuthInput): Promise<McpPrincipal | null> | McpPrincipal | null;
}

export interface ToolCallIdentity {
  principal: McpPrincipal | null;
  sessionId: string;
  requestId: string;
  headers: Record<string, string | string[] | undefined>;
}

export type AuditStatus =
  | 'success'
  | 'invalid'
  | 'denied'
  | 'pending-approval'
  | 'error'
  | 'cancelled';

export interface AuditRecord {
  tool: string;
  caller: string;
  sessionId: string;
  requestId: string;
  status: AuditStatus;
  durationMs: number;
  /** Redacted argument summary — never the raw payload. */
  argumentSummary: Record<string, unknown>;
  error?: string;
}

export interface AuditSink {
  record(record: AuditRecord): void | Promise<void>;
}

export interface ApprovalTicket {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  argumentSummary: Record<string, unknown>;
  caller: string;
  sessionId: string;
  requestId: string;
  createdAt: number;
  expiresAt: number;
}

export type ApprovalDecision =
  | { approved: true; approver?: string }
  | { approved: false; reason: string };

/** Human-in-the-loop approval backend (roadmap F-3 implements one). */
export interface ApprovalService {
  request(ticket: ApprovalTicket, options?: { signal?: AbortSignal }): Promise<ApprovalDecision>;
}

export interface McpSecurityOptions {
  auth?: AuthProvider;
  /** Origin allowlist for DNS-rebinding protection; defaults to loopback origins. */
  allowedOrigins?: string[];
  /** Strict profile: destructive tools without explicit `requireApproval: false` need approval. */
  strict?: boolean;
  approvalTimeoutMs?: number;
}

/** Minimal application contract; a real `Koatty` instance satisfies it. */
export interface KoattyLike {
  container?: any;
  security?: any;
  config?: any;
  getCurrentContext?(): any;
  ctxStorage?: { run<T>(store: unknown, fn: () => T): T };
}

export interface McpHostOptions {
  app: KoattyLike;
  /** Container used for discovery/invocation; defaults to `app.container`. */
  container?: any;
  security?: McpSecurityOptions;
  approval?: ApprovalService;
  audit?: AuditSink;
  /** Optional redaction hook (koatty_guard sanitize service) for audit summaries. */
  redact?: (value: any) => any;
  serverName?: string;
  serverVersion?: string;
  instructions?: string;
  /** Component types scanned for protocol metadata. */
  componentTypes?: string[];
  /** Identity used for stdio calls, where no HTTP headers exist. */
  stdioIdentity?: McpPrincipal;
  /** Wrap the actual tool execution, e.g. with a live GenAI span/guard aspect. */
  aroundTool?: (info: { name: string; identity: ToolCallIdentity; args: Record<string, unknown> }, proceed: () => Promise<unknown>) => Promise<unknown>;
  onApproval?: (info: { tool: string; decision: 'approved' | 'rejected' | 'timeout'; durationMs: number }) => void;
}
