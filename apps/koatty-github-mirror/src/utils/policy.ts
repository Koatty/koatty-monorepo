import { MirrorError } from './MirrorError';

export interface Target { url: URL; kind: 'git' | 'file'; operation?: 'root' | 'discover' | 'upload' | 'receive'; service?: 'git-upload-pack' | 'git-receive-pack'; }
const segment = '[A-Za-z0-9_.-]+';
const repo = new RegExp(`^/${segment}/${segment}\\.git(?<suffix>/info/refs|/git-upload-pack|/git-receive-pack)?$`);
const fileHosts = new Set(['raw.githubusercontent.com', 'codeload.github.com']);
const redirectHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

export function parseTarget(value: string): Target {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\s\\]/.test(value) || Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
    throw new MirrorError(400, 'INVALID_URL', '请输入有效的 GitHub HTTPS 地址。');
  }
  let url: URL;
  try { url = new URL(value.startsWith('https://') ? value : 'https://' + value); }
  catch { throw new MirrorError(400, 'INVALID_URL', '链接格式不正确。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new MirrorError(400, 'INVALID_URL', '仅支持无认证信息、无端口和无锚点的 HTTPS 地址。');
  }
  // Reject encoded path separators and ambiguous traversal before upstream parsing.
  if (/%(?:2f|5c|00|0a|0d|2e)/i.test(url.pathname) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value.split('?')[0])) {
    throw new MirrorError(400, 'INVALID_PATH', '不支持含转义分隔符或路径跳转的链接。');
  }
  if (url.hostname === 'github.com') {
    const match = repo.exec(url.pathname);
    if (match) {
      const suffix = match.groups?.suffix;
      if (suffix === '/info/refs') {
        if (!['?service=git-upload-pack', '?service=git-receive-pack'].includes(url.search)) throw new MirrorError(403, 'INVALID_GIT_SERVICE', '不支持此 Git 服务。');
        return { url, kind: 'git', operation: 'discover', service: url.search.slice(9) as Target['service'] };
      }
      if (url.search) throw new MirrorError(400, 'INVALID_QUERY', 'Git 地址不支持此查询参数。');
      return { url, kind: 'git', operation: suffix === '/git-receive-pack' ? 'receive' : suffix ? 'upload' : 'root', service: suffix === '/git-receive-pack' ? 'git-receive-pack' : 'git-upload-pack' };
    }
    const parts = url.pathname.split('/');
    if (parts.length >= 6 && ['blob', 'raw'].includes(parts[3])) {
      url.hostname = 'raw.githubusercontent.com';
      parts.splice(3, 1);
      url.pathname = parts.join('/');
      return { url, kind: 'file' };
    }
    if (new RegExp(`^/${segment}/${segment}/(?:releases/(?:download/[^/]+/|latest/download/).+|archive/.+\\.(?:zip|tar\\.gz))$`).test(url.pathname)) {
      return { url, kind: 'file' };
    }
  } else if (fileHosts.has(url.hostname) && url.pathname.split('/').filter(Boolean).length >= 4) {
    return { url, kind: 'file' };
  }
  throw new MirrorError(403, 'UNSUPPORTED_TARGET', '仅支持 GitHub Git 仓库、公开 Release、源码归档和 Raw 文件。');
}

export function validateRedirect(url: URL, kind: Target['kind']): void {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new MirrorError(502, 'UNSAFE_REDIRECT', '上游返回了不受支持的重定向。');
  }
  if (kind === 'file' && redirectHosts.has(url.hostname)) return;
  try {
    const target = parseTarget(url.href);
    if (target.kind === kind) return;
  } catch { /* Do not expose upstream URL or signed query strings. */ }
  throw new MirrorError(502, 'UNSAFE_REDIRECT', '上游重定向超出了允许的 GitHub 资源范围。');
}

export function proxyPath(url: URL): string { return '/' + url.host + url.pathname + url.search; }
