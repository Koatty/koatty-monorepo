import { Service } from 'koatty';
import { MirrorError } from '../utils/MirrorError';
import { MirrorSettings } from '../utils/settings';

@Service()
export class AdmissionService {
  private active = 0;
  private clients = new Map<string, { active: number; count: number; reset: number }>();
  acquire(ip: string, settings: MirrorSettings): () => void {
    const now = Date.now();
    for (const [key, value] of this.clients) if (!value.active && value.reset <= now) this.clients.delete(key);
    if (!this.clients.has(ip) && this.clients.size >= 10000) throw new MirrorError(503, 'BUSY', '服务繁忙，请稍后重试。');
    const client = this.clients.get(ip) || { active: 0, count: 0, reset: now + 60000 };
    if (client.reset <= now) { client.count = 0; client.reset = now + 60000; }
    this.clients.set(ip, client);
    if (this.active >= settings.maxConcurrent || client.active >= settings.maxPerClient || client.count >= settings.requestsPerMinute) {
      throw new MirrorError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试。');
    }
    this.active++; client.active++; client.count++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; client.active--; } };
  }
}
