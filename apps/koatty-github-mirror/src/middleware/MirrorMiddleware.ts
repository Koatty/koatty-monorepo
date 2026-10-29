import { Middleware, Autowired, KoattyContext, KoattyNext } from 'koatty';
import { ProxyService } from '../service/ProxyService';
import { MirrorError } from '../utils/MirrorError';
import { ReleaseService } from '../service/ReleaseService';
import { SiteService } from '../service/SiteService';

@Middleware()
export class MirrorMiddleware {
  @Autowired() private proxyService!: ProxyService;
  @Autowired() private releaseService!: ReleaseService;
  @Autowired() private siteService!: SiteService;
  run() {
    return async (ctx: KoattyContext, next: KoattyNext) => {
      ctx.set('X-Content-Type-Options', 'nosniff');
      ctx.set('Referrer-Policy', 'no-referrer');
      ctx.set('X-Frame-Options', 'DENY');
      ctx.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      const releasePage = /^\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/releases\/?$/.test(ctx.path);
      try {
        if (releasePage) {
          if (!['GET', 'HEAD'].includes(ctx.method)) throw new MirrorError(405, 'METHOD_NOT_ALLOWED', '版本列表页面仅支持 GET / HEAD。');
          const listing = await this.releaseService.resolve('https:/' + ctx.path);
          if (!listing) throw new MirrorError(400, 'INVALID_RELEASE_PAGE', '无效的版本列表地址。');
          ctx.type = 'html';
          ctx.set('Cache-Control', 'no-store');
          ctx.body = await this.siteService.releases(listing);
        } else if (/^\/(?:api(?:\/|$)|healthz$|assets\/|favicon\.ico$)/.test(ctx.path) || ctx.path === '/') {
          await next();
        } else {
          await this.proxyService.relay(ctx);
        }
      } catch (error) {
        if (!(error instanceof MirrorError)) throw error;
        if (ctx.res.headersSent || ctx.res.destroyed) return;
        ctx.status = error.status;
        ctx.set('Cache-Control', 'no-store');
        if (error.status === 429 || error.status === 503) ctx.set('Retry-After', '60');
        if (releasePage) {
          ctx.type = 'html';
          ctx.body = await this.siteService.releaseError(error.message);
        } else ctx.body = { error: { code: error.code, message: error.message } };
      }
    };
  }
}
