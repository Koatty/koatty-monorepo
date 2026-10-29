export interface MirrorSettings {
  maxConcurrent: number;
  maxPerClient: number;
  requestsPerMinute: number;
  maxGitBodyBytes: number;
  maxGitPushBodyBytes: number;
  headerTimeoutMs: number;
  idleTimeoutMs: number;
  transferTimeoutMs: number;
}
export const defaults: MirrorSettings = {
  maxConcurrent: 32, maxPerClient: 4, requestsPerMinute: 120,
  maxGitBodyBytes: 8 * 1024 * 1024, maxGitPushBodyBytes: 512 * 1024 * 1024, headerTimeoutMs: 15000,
  idleTimeoutMs: 60000, transferTimeoutMs: 30 * 60 * 1000,
};
export function settingsFromEnv(env: NodeJS.ProcessEnv): MirrorSettings {
  const names: Record<keyof MirrorSettings, string> = {
    maxConcurrent: 'MIRROR_MAX_CONCURRENT', maxPerClient: 'MIRROR_MAX_PER_CLIENT',
    requestsPerMinute: 'MIRROR_REQUESTS_PER_MINUTE', maxGitBodyBytes: 'MIRROR_MAX_GIT_BODY_BYTES',
    maxGitPushBodyBytes: 'MIRROR_MAX_GIT_PUSH_BODY_BYTES',
    headerTimeoutMs: 'MIRROR_HEADER_TIMEOUT_MS', idleTimeoutMs: 'MIRROR_IDLE_TIMEOUT_MS',
    transferTimeoutMs: 'MIRROR_TRANSFER_TIMEOUT_MS',
  };
  const result = { ...defaults };
  for (const key of Object.keys(names) as (keyof MirrorSettings)[]) {
    const value = env[names[key]];
    if (value === undefined) continue;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) {
      throw new Error('Invalid positive integer configuration: ' + names[key]);
    }
    result[key] = Number(value);
  }
  return result;
}
