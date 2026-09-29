/**
 * @ description: SecurityProfile - centralized security defaults (ADR-102)
 * @ author: richen
 * @ copyright: Copyright (c) - <richenlin(at)gmail.com>
 * @ license: BSD (3-Clause)
 */
import { Helper } from "koatty_lib";
import { DefaultLogger as Logger } from "koatty_logger";

/**
 * Security profile name.
 * - strict: production default, fail-closed everywhere
 * - standard: balanced defaults
 * - development: relaxed limits for local development
 */
export type ProfileName = 'strict' | 'standard' | 'development';

/**
 * Security profile options that can be overridden via `config/security.ts`.
 */
interface MutableSecurityProfile {
  name: ProfileName;
  payload: {
    /** request body size limit, e.g. '1mb' */
    limit: string;
    maxFiles: number;
    maxFields: number;
    maxFieldsSize: string;
    /** 'reject': parse failures throw 400/413; 'empty': legacy fallback to {} */
    onParseError: 'reject' | 'empty';
  };
  validation: {
    whitelist: boolean;
    forbidNonWhitelisted: boolean;
  };
  aop: {
    /** 'throw': aspect errors abort the request (fail-closed); 'log': legacy behavior */
    onAspectError: 'throw' | 'log';
  };
  graphql: {
    playground: boolean;
    introspection: boolean;
    /** 0 disables the depth limit */
    depthLimit: number;
    /** 0 disables the complexity limit */
    complexityLimit: number;
  };
  ws: {
    /** websocket max payload in bytes; 0 means unlimited (ws library default) */
    maxPayload: number;
    checkOrigin: boolean;
  };
  ops: {
    exposeMetrics: 'off' | 'internal' | 'public';
  };
  tls: {
    minVersion: 'TLSv1.2' | 'TLSv1.3';
  };
}

export type DeepReadonly<T> = { readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K] };
export type SecurityProfile = DeepReadonly<MutableSecurityProfile>;

/**
 * User-provided security config (from `config/security.ts`).
 * Every field is optional; unspecified fields inherit the profile value.
 */
export interface SecurityConfigOptions {
  profile?: ProfileName;
  /**
   * One-shot rollback switch for 4.3.0: restore pre-4.3 (loose) defaults.
   * Removed in 5.0.0 (ADR-103). When enabled, startup prints a WARN listing
   * every reverted item.
   */
  legacyDefaults?: boolean;
  payload?: Partial<SecurityProfile['payload']>;
  validation?: Partial<SecurityProfile['validation']>;
  aop?: Partial<SecurityProfile['aop']>;
  graphql?: Partial<SecurityProfile['graphql']>;
  ws?: Partial<SecurityProfile['ws']>;
  ops?: Partial<SecurityProfile['ops']>;
  tls?: Partial<SecurityProfile['tls']>;
}

const MB = 1024 * 1024;

const STRICT_PROFILE: SecurityProfile = {
  name: 'strict',
  payload: { limit: '1mb', maxFiles: 10, maxFields: 100, maxFieldsSize: '1mb', onParseError: 'reject' },
  validation: { whitelist: true, forbidNonWhitelisted: true },
  aop: { onAspectError: 'throw' },
  graphql: { playground: false, introspection: false, depthLimit: 10, complexityLimit: 1000 },
  ws: { maxPayload: MB, checkOrigin: true },
  ops: { exposeMetrics: 'internal' },
  tls: { minVersion: 'TLSv1.2' },
};

const STANDARD_PROFILE: SecurityProfile = {
  name: 'standard',
  payload: { limit: '5mb', maxFiles: 20, maxFields: 200, maxFieldsSize: '2mb', onParseError: 'reject' },
  validation: { whitelist: true, forbidNonWhitelisted: false },
  aop: { onAspectError: 'throw' },
  graphql: { playground: false, introspection: true, depthLimit: 15, complexityLimit: 2000 },
  ws: { maxPayload: 4 * MB, checkOrigin: true },
  ops: { exposeMetrics: 'internal' },
  tls: { minVersion: 'TLSv1.2' },
};

const DEVELOPMENT_PROFILE: SecurityProfile = {
  name: 'development',
  payload: { limit: '20mb', maxFiles: 100, maxFields: 1000, maxFieldsSize: '20mb', onParseError: 'reject' },
  validation: { whitelist: true, forbidNonWhitelisted: false },
  aop: { onAspectError: 'throw' },
  graphql: { playground: true, introspection: true, depthLimit: 20, complexityLimit: 5000 },
  ws: { maxPayload: 16 * MB, checkOrigin: false },
  ops: { exposeMetrics: 'public' },
  tls: { minVersion: 'TLSv1.2' },
};

/**
 * Pre-4.3.0 defaults, applied when `security.legacyDefaults: true` (ADR-103).
 * Each entry records the reverted item for the startup WARN summary.
 */
export const LEGACY_DEFAULTS: Array<{
  path: string;
  value: unknown;
  reason: string;
}> = [
  { path: 'payload.limit', value: '20mb', reason: 'original request body limit' },
  { path: 'payload.maxFiles', value: Infinity, reason: 'original unlimited upload files' },
  { path: 'payload.maxFields', value: Infinity, reason: 'original unlimited form fields' },
  { path: 'payload.maxFieldsSize', value: '20mb', reason: 'original form fields size limit' },
  { path: 'payload.onParseError', value: 'empty', reason: 'parse failures silently return {}' },
  { path: 'validation.whitelist', value: false, reason: 'no DTO whitelist' },
  { path: 'validation.forbidNonWhitelisted', value: false, reason: 'non-whitelisted fields allowed' },
  { path: 'aop.onAspectError', value: 'log', reason: 'aspect failures only logged' },
  { path: 'graphql.playground', value: true, reason: 'GraphiQL enabled' },
  { path: 'graphql.introspection', value: true, reason: 'GraphQL introspection enabled' },
  { path: 'graphql.depthLimit', value: 0, reason: 'no GraphQL depth limit' },
  { path: 'graphql.complexityLimit', value: 0, reason: 'no GraphQL complexity limit' },
  { path: 'ws.maxPayload', value: 0, reason: 'unlimited websocket payload' },
  { path: 'ws.checkOrigin', value: false, reason: 'websocket Origin not checked' },
  { path: 'ops.exposeMetrics', value: 'public', reason: 'metrics publicly exposed' },
];

const PROFILES: Record<ProfileName, SecurityProfile> = {
  strict: STRICT_PROFILE,
  standard: STANDARD_PROFILE,
  development: DEVELOPMENT_PROFILE,
};

/**
 * Resolve the profile name from environment.
 * Selection rules (ADR-102):
 * - NODE_ENV/KOATTY_ENV = production  -> strict
 * - NODE_ENV/KOATTY_ENV = development|test -> development
 * - unset or anything else -> standard (NOT development, to avoid
 *   "forgot to set the env var = everything open")
 */
export function resolveProfileName(env = process.env.KOATTY_ENV || process.env.NODE_ENV): ProfileName {
  const value = (env || '').toLowerCase();
  if (['production', 'prod'].includes(value)) return 'strict';
  if (['development', 'dev', 'test'].includes(value)) return 'development';
  return 'standard';
}

function cloneProfile(name: ProfileName): MutableSecurityProfile {
  if (!Object.prototype.hasOwnProperty.call(PROFILES, name)) throw new Error('Invalid security profile name');
  const base = PROFILES[name];
  return {
    name: base.name,
    payload: { ...base.payload },
    validation: { ...base.validation },
    aop: { ...base.aop },
    graphql: { ...base.graphql },
    ws: { ...base.ws },
    ops: { ...base.ops },
    tls: { ...base.tls },
  };
}

function applyLegacyDefaults(profile: MutableSecurityProfile): string[] {
  const reverted: string[] = [];
  for (const item of LEGACY_DEFAULTS) {
    const parts = item.path.split('.');
    let target = profile as any;
    for (let i = 0; i < parts.length - 1; i++) {
      target = target[parts[i]];
    }
    const leaf = parts[parts.length - 1];
    if (!Helper.isEqual(target[leaf], item.value)) {
      reverted.push(`${item.path}=${item.value} (${item.reason})`);
    }
    target[leaf] = item.value;
  }
  return reverted;
}

function applyUserOverrides(profile: MutableSecurityProfile, options: SecurityConfigOptions): void {
  const sections: Array<keyof Omit<SecurityConfigOptions, 'profile' | 'legacyDefaults'>> =
    ['payload', 'validation', 'aop', 'graphql', 'ws', 'ops', 'tls'];
  for (const section of sections) {
    const overrides = options[section] as Record<string, unknown> | undefined;
    if (overrides === undefined) continue;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error(`Invalid security section: ${section}`);
    const target = profile[section] as Record<string, unknown>;
    for (const [key, value] of Object.entries(overrides)) {
      if (!Object.prototype.hasOwnProperty.call(target, key)) throw new Error(`Unknown security field: ${section}.${key}`);
      if (value === undefined) continue;
      if (typeof value !== typeof target[key] || (typeof value === 'number' && (!Number.isFinite(value) || value < 0))) throw new Error(`Invalid security field: ${section}.${key}`);
      const choices: Record<string, readonly string[]> = { 'payload.onParseError': ['reject', 'empty'], 'aop.onAspectError': ['throw', 'log'], 'ops.exposeMetrics': ['off', 'internal', 'public'], 'tls.minVersion': ['TLSv1.2', 'TLSv1.3'] };
      if (choices[`${section}.${key}`] && !choices[`${section}.${key}`].includes(value as string)) throw new Error(`Invalid security field: ${section}.${key}`);
      target[key] = value;
    }
  }
}

/**
 * Resolve the final effective security profile.
 *
 * @param options Optional user config from `config/security.ts`
 * @param env Environment value used for profile selection
 * @returns The frozen final security profile, plus the list of items
 *          reverted by `legacyDefaults` (for the startup WARN).
 */
export function resolveProfile(
  options?: SecurityConfigOptions | null,
  env = process.env.KOATTY_ENV || process.env.NODE_ENV
): SecurityProfile {
  if (options != null && (typeof options !== 'object' || Array.isArray(options))) throw new Error('Invalid security options');
  for (const key of Object.keys(options ?? {})) if (!['profile', 'legacyDefaults', 'payload', 'validation', 'aop', 'graphql', 'ws', 'ops', 'tls'].includes(key)) throw new Error('Unknown security option');
  const profileName = options?.profile ?? resolveProfileName(env);
  const profile = cloneProfile(profileName);
  let reverted: string[] = [];
  if (options?.legacyDefaults === true) {
    reverted = applyLegacyDefaults(profile);
  }
  applyUserOverrides(profile, options ?? {});
  if (reverted.length > 0) {
    Logger.Warn('Security: legacyDefaults is enabled, the following items are reverted to pre-4.3 behavior:');
    for (const item of reverted) Logger.Warn(`  - ${item}`);
    Logger.Warn('Security: legacyDefaults will be removed in koatty 5.0.0, please migrate your config.');
  }
  for (const section of Object.values(profile)) {
    if (section && typeof section === 'object') Object.freeze(section);
  }
  return Object.freeze(profile);
}

/**
 * Build a one-line startup summary of the effective profile, e.g.:
 * `[Security] profile=strict payload.limit=1mb payload.onParseError=reject graphql.playground=off ...`
 */
export function profileSummary(profile: SecurityProfile): string {
  const flag = (v: boolean) => (v ? 'on' : 'off');
  return [
    `profile=${profile.name}`,
    `payload.limit=${profile.payload.limit}`,
    `payload.maxFiles=${profile.payload.maxFiles}`,
    `payload.onParseError=${profile.payload.onParseError}`,
    `validation.whitelist=${flag(profile.validation.whitelist)}`,
    `validation.forbidNonWhitelisted=${flag(profile.validation.forbidNonWhitelisted)}`,
    `aop.onAspectError=${profile.aop.onAspectError}`,
    `graphql.playground=${flag(profile.graphql.playground)}`,
    `graphql.introspection=${flag(profile.graphql.introspection)}`,
    `graphql.depthLimit=${profile.graphql.depthLimit || 'off'}`,
    `graphql.complexityLimit=${profile.graphql.complexityLimit || 'off'}`,
    `ws.maxPayload=${profile.ws.maxPayload || 'off'}`,
    `ws.checkOrigin=${flag(profile.ws.checkOrigin)}`,
    `ops.exposeMetrics=${profile.ops.exposeMetrics}`,
    `tls.minVersion=${profile.tls.minVersion}`,
  ].join(' ');
}
