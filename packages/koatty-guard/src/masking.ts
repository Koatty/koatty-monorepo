/**
 * Masking service (roadmap Phase F, item F-3).
 *
 * Rule based redaction for phone numbers, national ids, e-mail addresses and
 * bank cards. The service is pure: input values are never mutated, a masked
 * deep copy is returned instead.
 */

export interface MaskingRule {
  /** Stable identifier reported through {@link MaskingService.inspect}. */
  name: string;
  pattern: RegExp;
  /** Replacement; defaults to `***`. */
  replace?: string;
}

export interface MaskingService {
  /** Mask a value (string or structurally cloned object/array). */
  mask<T>(value: T): T;
  /** Mask a single text. */
  maskText(text: string): string;
  /** Mask and report which rules matched. */
  inspect(value: unknown): { masked: unknown; hits: string[] };
}

const MASKED = '***';
export function isSensitiveKey(key: string): boolean {
  return /^(password|passwd|pwd|secret|clientsecret|token|accesstoken|refreshtoken|authorization|apikey|accesskey|privatekey|credential|credentials|session|sessionid|cookie|setcookie)$/i.test(key.replace(/[_-]/g, ''));
}

/**
 * Default rules. Deliberately conservative and documented: they catch common
 * PII shapes only, they are not a compliance guarantee.
 */
export const DEFAULT_MASKING_RULES: MaskingRule[] = [
  { name: 'bearer', pattern: /\bBearer\s+[^\s,;"']+/gi, replace: 'Bearer ***' },
  { name: 'credential-url', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@[^\s"']+/gi },
  { name: 'private-key', pattern: /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g },
  { name: 'email', pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g },
  { name: 'phone-cn', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { name: 'id-card-cn', pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g },
  { name: 'bank-card', pattern: /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/g },
];

function maskTextWith(text: string, rules: MaskingRule[], hits: string[]): string {
  let output = text;
  for (const rule of rules) {
    // Reset lastIndex: the same rule object may be reused across calls.
    rule.pattern.lastIndex = 0;
    if (!rule.pattern.test(output)) {
      continue;
    }
    rule.pattern.lastIndex = 0;
    if (!hits.includes(rule.name)) {
      hits.push(rule.name);
    }
    output = output.replace(rule.pattern, rule.replace ?? MASKED);
  }
  return output;
}

function cloneAndMask(value: unknown, rules: MaskingRule[], hits: string[]): unknown {
  if (typeof value === 'string') {
    return maskTextWith(value, rules, hits);
  }
  if (Buffer.isBuffer(value)) return Buffer.from(maskTextWith(value.toString('utf8'), rules, hits));
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [cloneAndMask(key, rules, hits), isSensitiveKey(String(key)) ? MASKED : cloneAndMask(item, rules, hits)]));
  if (value instanceof Set) return new Set([...value].map(item => cloneAndMask(item, rules, hits)));
  if (Array.isArray(value)) {
    return value.map((item) => cloneAndMask(item, rules, hits));
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      Object.defineProperty(output, key, { value: isSensitiveKey(key) ? MASKED : cloneAndMask(source[key], rules, hits), enumerable: true, writable: true, configurable: true });
    }
    return output;
  }
  return value;
}

/**
 * Create a masking service.
 *
 * @param options.rules extra/overriding rules appended to the defaults
 * @param options.mask optional primitive masker overriding `maskText`
 */
export function createMaskingService(options: {
  rules?: MaskingRule[];
  mask?: (value: string) => string;
} = {}): MaskingService {
  const rules = [...DEFAULT_MASKING_RULES, ...(options.rules ?? [])];
  const customMask = options.mask;

  const maskText = (text: string): string => {
    if (typeof text !== 'string') {
      return text;
    }
    const hits: string[] = [];
    const masked = maskTextWith(text, rules, hits);
    return customMask ? customMask(masked) : masked;
  };

  return {
    maskText,
    mask<T>(value: T): T {
      return cloneAndMask(value, rules, []) as T;
    },
    inspect(value: unknown) {
      const hits: string[] = [];
      const masked = cloneAndMask(value, rules, hits);
      return { masked, hits };
    },
  };
}
