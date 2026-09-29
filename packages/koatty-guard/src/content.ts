/**
 * Content inspection service (roadmap Phase F, item F-3).
 *
 * Heuristic prompt-injection detection for EXTERNAL content entering the LLM
 * (user input, retrieved documents, tool results).
 *
 * IMPORTANT: rule based detection can only stop patterns that are already
 * known. It MUST NOT be the only defence — the primary controls stay the
 * permission scopes and human approval of `koatty_mcp` (F-1).
 */

export type ContentRisk = 'none' | 'low' | 'high';

export type ContentDecision = 'allow' | 'reject' | 'flag' | 'downgrade';

export interface ContentFinding {
  /** Rule identifier, e.g. `ignore-previous-instructions`. */
  rule: string;
  /** Matched fragment, truncated for logs. */
  excerpt: string;
  severity: Exclude<ContentRisk, 'none'>;
}

export interface ContentGuard {
  inspect(text: string): { risk: ContentRisk; findings: ContentFinding[]; decision: ContentDecision };
}

interface DetectionRule {
  rule: string;
  severity: Exclude<ContentRisk, 'none'>;
  pattern: RegExp;
}

export const DEFAULT_INJECTION_RULES: DetectionRule[] = [
  {
    rule: 'ignore-previous-instructions',
    severity: 'high',
    pattern: /(ignore|disregard|forget)\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  },
  {
    rule: 'role-override',
    severity: 'high',
    pattern: /(you\s+are\s+now|new\s+(system\s+)?(prompt|instructions?)|act\s+as\s+(the\s+)?(system|developer))/i,
  },
  {
    rule: 'system-prompt-exfiltration',
    severity: 'high',
    pattern: /(reveal|print|show|repeat|dump)\s+(your\s+)?(system\s+prompt|hidden\s+instructions?|initial\s+prompt)/i,
  },
  {
    rule: 'secret-exfiltration',
    severity: 'high',
    pattern: /(send|post|exfiltrate|upload)\s+(the\s+)?(api[_\s-]?key|token|secret|credentials?|env(ironment)?\s+variables?)/i,
  },
  {
    rule: 'tool-misuse',
    severity: 'low',
    pattern: /(call|invoke|run)\s+(the\s+)?(delete|drop|refund|transfer)\w*\s+(tool|function|command)/i,
  },
  {
    rule: 'encoded-payload',
    severity: 'low',
    pattern: /(base64|rot13|hex)\s*[:\-]?\s*[A-Za-z0-9+/=]{24,}/i,
  },
];

function excerptOf(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 12);
  const fragment = text.slice(start, start + Math.min(length + 24, 80));
  return fragment.replace(/\s+/g, ' ').trim();
}

function defaultDetector(text: string): ContentFinding[] {
  const findings: ContentFinding[] = [];
  for (const rule of DEFAULT_INJECTION_RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      findings.push({
        rule: rule.rule,
        severity: rule.severity,
        excerpt: excerptOf(text, match.index, match[0].length),
      });
    }
  }
  return findings;
}

/**
 * Create a content guard.
 *
 * @param options.policy what the caller should do on a hit:
 *   - `reject` (default) — refuse the request
 *   - `flag` — continue but mark the content as suspicious
 *   - `downgrade` — continue with reduced trust (e.g. read-only tools)
 * @param options.detector replace the default heuristic detector
 * @param options.threshold minimum severity that triggers the policy (`low` by default)
 */
export function createContentGuard(options: {
  policy?: 'reject' | 'flag' | 'downgrade';
  detector?: (text: string) => ContentFinding[];
  threshold?: Exclude<ContentRisk, 'none'>;
} = {}): ContentGuard {
  const policy = options.policy ?? 'reject';
  const detector = options.detector ?? defaultDetector;
  const threshold = options.threshold ?? 'high';

  return {
    inspect(text: string) {
      if (typeof text !== 'string' || text.length === 0) {
        return { risk: 'none' as ContentRisk, findings: [], decision: 'allow' as ContentDecision };
      }
      const confusables: Record<string, string> = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'і': 'i', 'у': 'y', 'Α': 'A', 'Ε': 'E', 'Ο': 'O' };
      const normalized = text.normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').replace(/[аеорсхіуΑΕΟ]/g, char => confusables[char]);
      const findings = detector(normalized);
      if (findings.length === 0) {
        return { risk: 'none' as ContentRisk, findings, decision: 'allow' as ContentDecision };
      }
      const risk: ContentRisk = findings.some((finding) => finding.severity === 'high') ? 'high' : 'low';
      const triggered = threshold === 'low' || risk === 'high';
      const decision: ContentDecision = triggered ? policy : 'allow';
      return { risk, findings, decision };
    },
  };
}
