import type { KoattyApplication } from 'koatty_core';

let shutdownBound = false;

export function bindShutdownHook(app: KoattyApplication): void {
  if (shutdownBound) return;
  shutdownBound = true;

  const shutdown = async () => {
    try {
      await app.stop?.();
    } catch (e) {
      console.error('[koatty-serverless] Shutdown error:', e);
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export function resetShutdownState(): void {
  shutdownBound = false;
}
