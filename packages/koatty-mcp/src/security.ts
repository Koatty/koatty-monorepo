/**
 * Authentication, scope checks and protocol safety helpers (roadmap Phase F, F-1).
 *
 * Two modes are supported:
 * - API key: internal services / local stdio debugging.
 * - OAuth 2.1 bearer token: Koatty acts as an OAuth resource server and verifies
 *   the token audience plus the scopes the tool requires.
 *
 * Verification itself is pluggable (`verify`), so no token library is forced on
 * the application; only audience/scope enforcement lives here.
 *
 * @License BSD-3-Clause
 */
import type { AuthInput, AuthProvider, McpPrincipal } from './types';

export class McpAuthError extends Error {
  constructor(message: string, public readonly status = 401) {
    super(message);
    this.name = 'McpAuthError';
  }
}

export class McpScopeError extends Error {
  constructor(message: string, public readonly required: string[] = []) {
    super(message);
    this.name = 'McpScopeError';
  }
}

export function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

/** Constant-time-ish comparison that never leaks length through early exit. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * API key authentication for internal services.
 *
 * Keys map to scopes so the same scope check applies to HTTP and stdio.
 */
export function createApiKeyAuth(options: {
  keys: string[] | Record<string, string[]>;
  header?: string;
  identityHeader?: string;
}): AuthProvider {
  const header = options.header ?? 'x-api-key';
  const table: Record<string, string[]> = Array.isArray(options.keys)
    ? Object.fromEntries(options.keys.map((key): [string, string[]] => [key, []]))
    : { ...options.keys };

  return {
    authenticate(input: AuthInput): McpPrincipal | null {
      const presented = readHeader(input.headers, header);
      if (!presented) return null;
      for (const known of Object.keys(table)) {
        if (safeEqual(known, presented)) {
          const override = options.identityHeader ? readHeader(input.headers, options.identityHeader) : undefined;
          return {
            id: override || `api-key:${known.slice(0, 4)}`,
            scopes: [...(table[known] ?? [])],
            kind: 'api-key',
          };
        }
      }
      throw new McpAuthError('Invalid API key.');
    },
  };
}

/**
 * OAuth 2.1 resource-server authentication: verifies the bearer token, then the
 * audience and (optionally) the scopes carried by the token.
 */
export function createBearerAuth(options: {
  verify: (token: string) => Promise<Record<string, any>> | Record<string, any>;
  audience?: string | string[];
  scopesClaim?: string;
  /** Token scopes that are mandatory for every call, regardless of the tool. */
  requiredScopes?: string[];
}): AuthProvider {
  const scopesClaim = options.scopesClaim ?? 'scope';
  return {
    async authenticate(input: AuthInput): Promise<McpPrincipal | null> {
      const authorization = readHeader(input.headers, 'authorization');
      if (!authorization) return null;
      const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
      if (!match) throw new McpAuthError('Malformed Authorization header.');
      const token = match[1].trim();

      let claims: Record<string, any>;
      try {
        claims = (await options.verify(token)) ?? {};
      } catch (error) {
        throw new McpAuthError(`Token verification failed: ${(error as Error).message}`);
      }

      if (options.audience) {
        const expected = Array.isArray(options.audience) ? options.audience : [options.audience];
        const aud = claims.aud;
        const actual = Array.isArray(aud) ? aud : aud === undefined ? [] : [aud];
        if (!actual.some((value: string) => expected.includes(value))) {
          throw new McpAuthError('Token audience does not match this MCP resource server.');
        }
      }

      const rawScopes = claims[scopesClaim];
      const scopes: string[] = Array.isArray(rawScopes)
        ? rawScopes.map(String)
        : typeof rawScopes === 'string'
          ? rawScopes.split(/\s+/).filter(Boolean)
          : [];

      for (const required of options.requiredScopes ?? []) {
        if (!scopes.includes(required)) {
          throw new McpScopeError(`Token is missing required scope "${required}".`, [required]);
        }
      }

      return {
        id: String(claims.sub ?? claims.client_id ?? 'oauth-client'),
        scopes,
        kind: 'oauth',
        claims,
      };
    },
  };
}

/** Fail-closed scope check reused by every transport (HTTP and stdio). */
export function hasRequiredScopes(principal: McpPrincipal | null, required: string[]): boolean {
  if (!required.length) return true;
  if (!principal) return false;
  return required.every((scope) => principal.scopes.includes(scope));
}

export function assertScopes(principal: McpPrincipal | null, required: string[], target: string): void {
  if (hasRequiredScopes(principal, required)) return;
  const who = principal ? principal.id : 'anonymous';
  throw new McpScopeError(
    `Caller "${who}" is not allowed to invoke ${target}: missing scope(s) ${required.join(', ')}.`,
    required,
  );
}

/**
 * Origin validation (DNS-rebinding protection).
 *
 * Non-browser clients send no `Origin` header and are allowed. Browser origins
 * must match the allowlist; the default allowlist is loopback only.
 */
export function checkOrigin(origin: string | undefined, allowedOrigins?: string[]): boolean {
  if (!origin) return true;
  if (Array.isArray(allowedOrigins) && allowedOrigins.includes('*')) return true;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  const allowed = (allowedOrigins ?? ['http://127.0.0.1', 'http://localhost', 'http://[::1]'])
    .map((entry) => {
      try {
        return new URL(entry).hostname.toLowerCase();
      } catch {
        return entry.toLowerCase();
      }
    });
  return allowed.includes(host);
}
