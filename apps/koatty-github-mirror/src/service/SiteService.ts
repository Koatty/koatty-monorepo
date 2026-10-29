import { Service, KoattyApplication } from 'koatty';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Listing } from './ReleaseService';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

@Service()
export class SiteService {
  app!: KoattyApplication;
  private files = new Map<string, Promise<Buffer>>();
  async releases(listing: Listing): Promise<string> {
    const repo = new URL(listing.source).pathname.split('/').slice(1, 3).join('/');
    const sections = listing.releases.map(release => `<section><h3>${escapeHtml(release.name)}${release.prerelease ? ' · 预发布' : ''}</h3><p class="release-tag">${escapeHtml(release.tag)}</p>${release.assets.length ? release.assets.map(asset => `<a class="release-asset" href="${escapeHtml(asset.path)}" download><span>${escapeHtml(asset.name)}</span><small>${asset.size < 1024 ? asset.size + ' B' : asset.size < 1048576 ? (asset.size / 1024).toFixed(1) + ' KiB' : (asset.size / 1048576).toFixed(1) + ' MiB'} ↓</small></a>`).join('') : '<p>此版本没有可下载的附件。</p>'}</section>`).join('');
    return this.releaseLayout(repo + ' · Release', `<h1>${escapeHtml(repo)}</h1><p>展示最近最多 ${listing.limit} 个公开版本。点击附件即可通过本站下载。</p><div class="release-panel"><h2>Release 附件</h2>${sections || '<p>这个仓库暂时没有公开发布的版本。</p>'}<a href="${escapeHtml(listing.source)}" target="_blank" rel="noopener noreferrer">在 GitHub 查看全部版本 ↗</a></div>`);
  }

  async releaseError(message: string): Promise<string> {
    return this.releaseLayout('Release 暂不可用', `<h1>暂时无法显示版本列表</h1><p role="alert">${escapeHtml(message)}</p><p>请稍后刷新重试，或返回首页使用具体附件的下载链接。</p>`);
  }

  private async releaseLayout(title: string, body: string): Promise<string> {
    const css = await this.read('site.css');
    const hash = createHash('sha256').update(css).digest('hex').slice(0, 16);
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · 渡</title><link rel="stylesheet" href="/assets/site.css?v=${hash}"></head><body><header class="topbar"><a class="brand" href="/">渡 / GITHUB</a><a href="/">返回加速首页 ↗</a></header><main><section class="workspace release-page">${body}</section></main></body></html>`;
  }

  async index(): Promise<Buffer> {
    const [html, css, js] = await Promise.all([this.read('index.html'), this.read('site.css'), this.read('site.js')]);
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    return Buffer.from(html.toString('utf8')
      .replace('/assets/site.css', '/assets/site.css?v=' + digest(css))
      .replace('/assets/site.js', '/assets/site.js?v=' + digest(js)));
  }

  read(name: 'index.html' | 'site.css' | 'site.js') {
    if (!this.files.has(name)) this.files.set(name, readFile(path.join(this.app.paths!.rootPath, 'static', name)));
    return this.files.get(name)!;
  }
}
