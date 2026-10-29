import { settingsFromEnv } from '../utils/settings';
export default {
  list: ['MirrorMiddleware'],
  config: { trace: { timeout: settingsFromEnv(process.env).transferTimeoutMs + 10000 } },
};
