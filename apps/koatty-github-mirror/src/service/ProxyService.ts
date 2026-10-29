import { Service, Autowired, KoattyContext, KoattyApplication } from 'koatty';
import type { IncomingMessage } from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AdmissionService } from './AdmissionService';
import { parseTarget, Target, validateRedirect } from '../utils/policy';
import { MirrorError } from '../utils/MirrorError';
import { defaults, MirrorSettings } from '../utils/settings';
import { safeTransport, Transport } from '../utils/transport';

@Service()
export class ProxyService {
  app!: KoattyApplication;
  @Autowired() private admissionService!: AdmissionService;
  // Test seam is an in-process field. No environment/config option can bypass outbound checks.
  transport: Transport = safeTransport;

  async relay(ctx: KoattyContext): Promise<void> {
    const target = parseTarget(ctx.originalUrl.slice(1));
    this.validateMethod(ctx, target);
    const settings: MirrorSettings = { ...defaults, ...this.app.config(undefined, 'mirror') };
    const release = this.admissionService.acquire(ctx.ip || 'unknown', settings);
    const abort = new AbortController();
    const cancel = () => abort.abort(new MirrorError(499, 'CLIENT_CLOSED', '客户端已断开。'));
    ctx.res.once('close', cancel);
    ctx.req.once('aborted', cancel);
    const timer = setTimeout(() => abort.abort(new MirrorError(504, 'TRANSFER_TIMEOUT', '传输超过时限。')), settings.transferTimeoutMs);
    timer.unref();
    let response: IncomingMessage | undefined;
    let pushBody: Transform | undefined;
    let stopPush = () => {};
    try {
      if (target.operation === 'receive') {
        const size = ctx.get('content-length');
        if (size && (!/^\d+$/.test(size) || Number(size) > settings.maxGitPushBodyBytes)) throw new MirrorError(413, 'BODY_TOO_LARGE', 'Git push 请求体超过本站限制。');
        let total = 0;
        let idleTimer: NodeJS.Timeout;
        const resetIdle = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => pushBody?.destroy(new MirrorError(408, 'UPLOAD_TIMEOUT', 'Git push 上传超时。')), settings.idleTimeoutMs);
          idleTimer.unref();
        };
        pushBody = new Transform({ transform(chunk, _encoding, callback) {
          resetIdle(); total += chunk.length;
          if (total > settings.maxGitPushBodyBytes) callback(new MirrorError(413, 'BODY_TOO_LARGE', 'Git push 请求体超过本站限制。'));
          else callback(null, chunk);
        } });
        pushBody.once('error', error => abort.abort(error));
        pushBody.once('finish', () => clearTimeout(idleTimer));
        stopPush = () => { clearTimeout(idleTimer); ctx.req.unpipe(pushBody!); pushBody!.destroy(); };
        resetIdle();
        ctx.req.pipe(pushBody);
      }
      const body = pushBody || (target.operation === 'upload' ? await this.readBody(ctx, settings, abort.signal) : undefined);
      const headers: Record<string, string> = { 'user-agent': 'koatty-github-mirror/1.0', 'accept-encoding': 'identity' };
      for (const name of ['range', 'if-range', 'if-none-match', 'if-modified-since']) {
        const value = ctx.get(name);
        if (value && target.kind === 'file') headers[name] = value;
      }
      if (headers.range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(headers.range)) {
        throw new MirrorError(400, 'INVALID_RANGE', '仅支持单段 bytes Range。');
      }
      if (target.kind === 'git') {
        const authorization = ctx.get('authorization');
        if (authorization) {
          if (!/^(?:Basic|Bearer) [A-Za-z0-9+/=_~.-]+$/i.test(authorization) || authorization.length > 8192) throw new MirrorError(400, 'INVALID_AUTHORIZATION', '不支持此 Git 认证格式。');
          headers.authorization = authorization;
        }
        const protocol = ctx.get('git-protocol');
        if (protocol && !/^version=[012]$/.test(protocol)) throw new MirrorError(400, 'INVALID_GIT_PROTOCOL', '不支持此 Git 协议版本。');
        if (protocol) headers['git-protocol'] = protocol;
        if (body) {
          headers['content-type'] = `application/x-${target.service}-request`;
          if (Buffer.isBuffer(body)) headers['content-length'] = String(body.length);
          else if (ctx.get('content-length')) headers['content-length'] = ctx.get('content-length');
          if (ctx.get('content-encoding')) headers['content-encoding'] = ctx.get('content-encoding');
        }
      }
      let url = target.url;
      for (let hop = 0; ; hop++) {
        abort.signal.throwIfAborted();
        response = await this.transport(url, {
          method: ctx.method, headers, body, signal: abort.signal,
          headerTimeoutMs: settings.headerTimeoutMs, idleTimeoutMs: settings.idleTimeoutMs,
        });
        const status = response.statusCode || 502;
        if (![301, 302, 303, 307, 308].includes(status)) break;
        const location = response.headers.location;
        response.destroy();
        if (hop >= 5 || !location) throw new MirrorError(502, 'REDIRECT_LIMIT', '上游重定向异常。');
        if (target.kind === 'git' && (headers.authorization || body)) throw new MirrorError(502, 'GIT_REDIRECT', '认证或写入请求不跟随重定向，请使用 GitHub 当前规范仓库地址。');
        if (body && ![307, 308].includes(status)) throw new MirrorError(502, 'GIT_REDIRECT', 'Git 上游不能安全地重放请求。');
        try { url = new URL(location, url); } catch { throw new MirrorError(502, 'INVALID_REDIRECT', '上游重定向异常。'); }
        validateRedirect(url, target.kind);
        if (target.kind === 'git' && (parseTarget(url.href).operation !== target.operation || parseTarget(url.href).service !== target.service)) throw new MirrorError(502, 'GIT_REDIRECT', 'Git 重定向不能改变服务类型。');
      }
      const status = response.statusCode || 502;
      if (![200, 206, 304, 416].includes(status)) {
        if (target.kind === 'git' && status === 401) {
          // Clients that display the HTTP realm can explain GitHub's token requirement.
          // Password field labels remain controlled by Git / the credential helper.
          ctx.set('WWW-Authenticate', 'Basic realm="GitHub - enter a Personal Access Token (PAT) as password, not your account password"');
        }
        response.destroy();
        const mapped = [401, 403, 404, 410, 429].includes(status) ? status : 502;
        if (target.kind === 'git' && status === 401) throw new MirrorError(401, 'GITHUB_AUTH_REQUIRED', '需要有效的 GitHub 认证：用户名填写 GitHub 用户名，密码框填写 Personal Access Token（PAT，个人访问令牌），不是 GitHub 账号密码。若已使用 PAT，请检查令牌有效期和仓库访问权限。');
        throw new MirrorError(mapped, 'UPSTREAM_REJECTED', target.kind === 'git' ? 'GitHub 拒绝了仓库请求，请检查认证信息、仓库权限和地址。' : 'GitHub 未能提供此公开资源，请检查地址或稍后重试。');
      }
      if (target.kind === 'git') {
        const expected = `application/x-${target.service}-${target.operation === 'discover' ? 'advertisement' : 'result'}`;
        if (status !== 200 || response.headers['content-type']?.split(';')[0] !== expected) {
          throw new MirrorError(502, 'INVALID_GIT_RESPONSE', '上游未返回有效的 Git Smart HTTP 响应。');
        }
        ctx.set('Content-Type', expected);
      } else {
        ctx.set('Content-Type', 'application/octet-stream');
        const basename = target.url.pathname.split('/').pop() || 'download';
        const filename = basename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0,180) || 'download';
        ctx.set('Content-Disposition', `attachment; filename="${filename}"`);
      }
      ctx.set('Cache-Control', 'no-store');
      for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'content-encoding']) {
        const value = response.headers[name];
        if (typeof value === 'string') ctx.set(name, value);
      }
      ctx.status = status;
      if (ctx.method === 'HEAD' || status === 304 || status === 416) {
        if (status === 416 && ctx.method !== 'HEAD') { ctx.remove('Content-Encoding'); ctx.set('Content-Length', '0'); }
        response.destroy();
        ctx.respond = false;
        ctx.res.end();
        return;
      }
      // Keep the middleware alive for the full transfer; pipeline supplies backpressure,
      // cancellation and teardown. Never buffer release files or Git pack responses.
      ctx.respond = false;
      await pipeline(response, ctx.res, { signal: abort.signal });
    } catch (error) {
      response?.destroy();
      if (ctx.res.headersSent || ctx.res.destroyed) { ctx.res.destroy(); return; }
      ctx.respond = true;
      if (pushBody && !ctx.req.complete) { ctx.set('Connection', 'close'); ctx.req.unpipe(pushBody); ctx.req.resume(); }
      for (const name of ['Content-Length','Content-Range','Content-Encoding','Content-Disposition','ETag','Last-Modified']) ctx.remove(name);
      if (abort.signal.aborted) throw abort.signal.reason;
      if (error instanceof MirrorError) throw error;
      throw new MirrorError(502, 'UPSTREAM_UNAVAILABLE', '暂时无法连接 GitHub，请稍后重试。');
    } finally {
      clearTimeout(timer);
      stopPush();
      ctx.res.removeListener('close', cancel);
      ctx.req.removeListener('aborted', cancel);
      release();
    }
  }

  private validateMethod(ctx: KoattyContext, target: Target): void {
    if (target.kind === 'file' && ['GET','HEAD'].includes(ctx.method)) return;
    if (target.operation === 'discover' && ctx.method === 'GET') return;
    if (['upload', 'receive'].includes(target.operation || '') && ctx.method === 'POST') {
      if (ctx.get('content-type').split(';')[0] !== `application/x-${target.service}-request` || !['', 'gzip'].includes(ctx.get('content-encoding'))) {
        throw new MirrorError(415, 'INVALID_GIT_BODY', '需要匹配的 Git 请求体，仅支持 identity 或 gzip 编码。');
      }
      return;
    }
    throw new MirrorError(405, 'METHOD_NOT_ALLOWED', '仅支持文件 GET / HEAD，以及 Git Smart HTTP 读写请求。');
  }

  private async readBody(ctx: KoattyContext, settings: MirrorSettings, signal: AbortSignal): Promise<Buffer> {
    const size = ctx.get('content-length');
    if (size && (!/^\d+$/.test(size) || Number(size) > settings.maxGitBodyBytes)) {
      throw new MirrorError(413, 'BODY_TOO_LARGE', 'Git 请求体过大。');
    }
    const timeout = setTimeout(() => ctx.req.destroy(new Error('Git request body timed out')), settings.idleTimeoutMs);
    timeout.unref();
    const cancel = () => ctx.req.destroy();
    signal.addEventListener('abort', cancel, { once: true });
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for await (const chunk of ctx.req) {
        total += chunk.length;
        if (total > settings.maxGitBodyBytes) throw new MirrorError(413, 'BODY_TOO_LARGE', 'Git 请求体过大。');
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
  }
}
