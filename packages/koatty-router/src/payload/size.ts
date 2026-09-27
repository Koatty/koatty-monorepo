/*
 * @Description: Shared size helpers for payload parsers (SEC-05 / B-5)
 * @License: BSD (3-Clause)
 */

/**
 * Parse a human-readable size string ('1mb', '512kb', '20mb') or a plain
 * number into bytes. Replaces the old `parseInt('20mb')` pattern which
 * silently yielded 20. Returns the fallback when the value cannot be parsed.
 *
 * Supported units (case-insensitive): b, kb, mb, gb, tb.
 */
export function parseSize(value: string | number | undefined, fallbackBytes: number): number {
  if (typeof value === 'number' && isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return fallbackBytes;
  }
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?\s*$/i.exec(value);
  if (!match) {
    return fallbackBytes;
  }
  const amount = parseFloat(match[1]);
  const unit = (match[2] || 'b').toLowerCase();
  const multiplier: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024,
  };
  return Math.floor(amount * multiplier[unit]);
}

/**
 * Sanitize an attacker-controlled filename (SEC-05): strip directory
 * components and path separators so the value can never traverse outside
 * the intended upload directory. `originalFilename` from multipart requests
 * must always pass through this helper before being used for storage.
 */
export function safeFilename(name: unknown): string {
  const base = String(name ?? '')
    // treat both separators as directory delimiters
    .split(/[\\/]+/)
    .pop() ?? '';
  const cleaned = base.replace(/[\0\r\n]/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'upload';
}
