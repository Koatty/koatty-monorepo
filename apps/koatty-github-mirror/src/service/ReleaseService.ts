import { Service } from 'koatty';
import { safeTransport, Transport } from '../utils/transport';
import { parseTarget, proxyPath } from '../utils/policy';
import { MirrorError } from '../utils/MirrorError';

interface Asset { name: string; size: number; source: string; path: string; }
interface Release { name: string; tag: string; prerelease: boolean; latest: boolean; assets: Asset[]; }
export interface Listing { kind: 'releases'; source: string; releases: Release[]; limit: number; }

@Service()
export class ReleaseService {
  transport: Transport = safeTransport;
  private cache = new Map<string, { expires: number; value: Listing }>();
  private pending = new Map<string, Promise<Listing>>();

  /** Recognize only release listing pages; file forwarding keeps its own strict policy. */
  async resolve(value: string): Promise<Listing | undefined> {
    const match = /^(?:https:\/\/)?github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)\/releases\/?$/.exec(value);
    if (!match || ['.', '..'].includes(match[2])) return undefined;
    const source = `https://github.com/${match[1]}/${match[2]}/releases`;
    const cached = this.cache.get(source);
    if (cached && cached.expires > Date.now()) return cached.value;
    const pending = this.pending.get(source);
    if (pending) return pending;
    if (this.pending.size >= 4) throw new MirrorError(429, 'RELEASE_BUSY', '版本查询繁忙，请稍后重试。');
    const task = this.fetchListing(match[1], match[2], source);
    this.pending.set(source, task);
    try {
      const result = await task;
      if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(source, { expires: Date.now() + 60000, value: result });
      return result;
    } finally { this.pending.delete(source); }
  }

  private async fetchListing(owner: string, repo: string, source: string): Promise<Listing> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    timer.unref();
    try {
      const response = await this.transport(new URL(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=20`), {
        method: 'GET', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Koatty-GitHub-Mirror', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: controller.signal, headerTimeoutMs: 5000, idleTimeoutMs: 5000,
      });
      try {
        if (response.statusCode === 404) throw new MirrorError(404, 'RELEASE_NOT_FOUND', '未找到公开仓库的 Release，请检查仓库地址。');
        if (response.statusCode === 403 || response.statusCode === 429) throw new MirrorError(429, 'GITHUB_API_LIMIT', 'GitHub 暂时限制版本查询，请稍后重试，或粘贴具体附件的下载链接。');
        if (response.statusCode !== 200) throw new MirrorError(502, 'RELEASE_UPSTREAM', 'GitHub 版本查询失败，请稍后重试，或使用附件直链。');
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of response) {
          const bytes = Buffer.from(chunk); size += bytes.length;
          if (size > 4 * 1024 * 1024) throw new MirrorError(502, 'RELEASE_TOO_LARGE', '版本信息过大，请使用具体附件的下载链接。');
          chunks.push(bytes);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Array.isArray(data)) throw new Error('Invalid release response');
        // GitHub's designated latest release is not necessarily the first or highest tag.
        const latest = data.length ? await this.fetchLatest(owner, repo, controller.signal) : undefined;
        if (latest && !data.some(item => item?.id === latest.id)) data.unshift(latest);
        const releases: Release[] = data.slice(0, 20).filter(item => item && !item.draft).map(item => {
          if (typeof item.tag_name !== 'string' || !Array.isArray(item.assets)) throw new Error('Invalid release');
          const assets: Asset[] = item.assets.filter((asset: { state?: string }) => asset?.state === 'uploaded').map((asset: { name: string; size: number; browser_download_url: string }) => {
            const target = parseTarget(asset.browser_download_url);
            if (target.kind !== 'file' || target.url.hostname !== 'github.com' ||
              !target.url.pathname.startsWith(`/${owner}/${repo}/releases/download/`) ||
              typeof asset.name !== 'string' || !Number.isSafeInteger(asset.size) || asset.size < 0) throw new Error('Invalid release asset');
            return { name: asset.name, size: asset.size, source: target.url.href, path: proxyPath(target.url) };
          });
          return { name: typeof item.name === 'string' && item.name ? item.name : item.tag_name, tag: item.tag_name, prerelease: !!item.prerelease, latest: !!latest && item.id === latest.id && !item.prerelease, assets };
        });
        return { kind: 'releases', source, releases, limit: 20 };
      } finally { response.destroy(); }
    } catch (error) {
      if (error instanceof MirrorError) throw error;
      throw new MirrorError(502, 'RELEASE_UNAVAILABLE', '暂时无法读取 GitHub 版本信息，请稍后重试，或粘贴具体附件的下载链接。');
    } finally { clearTimeout(timer); }
  }

  private async fetchLatest(owner: string, repo: string, signal: AbortSignal) {
    try {
      const response = await this.transport(new URL(`https://api.github.com/repos/${owner}/${repo}/releases/latest`), {
        method: 'GET', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Koatty-GitHub-Mirror', 'X-GitHub-Api-Version': '2022-11-28' },
        signal, headerTimeoutMs: 2000, idleTimeoutMs: 2000,
      });
      try {
        if (response.statusCode !== 200) return undefined;
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of response) {
          const bytes = Buffer.from(chunk); size += bytes.length;
          if (size > 4 * 1024 * 1024) return undefined;
          chunks.push(bytes);
        }
        const latest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!latest || !Number.isSafeInteger(latest.id) || latest.id <= 0 || typeof latest.tag_name !== 'string' || !Array.isArray(latest.assets) || latest.draft || latest.prerelease) return undefined;
        for (const asset of latest.assets.filter((item: { state?: string }) => item?.state === 'uploaded')) {
          const target = parseTarget(asset.browser_download_url);
          if (target.kind !== 'file' || target.url.hostname !== 'github.com' || !target.url.pathname.startsWith(`/${owner}/${repo}/releases/download/`) || typeof asset.name !== 'string' || !Number.isSafeInteger(asset.size) || asset.size < 0) return undefined;
        }
        return latest;
      } finally { response.destroy(); }
    } catch {
      // Keep downloads available if the optional marker lookup is unavailable; never guess.
      return undefined;
    }
  }
}
