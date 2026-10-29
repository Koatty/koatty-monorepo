import { KoattyContext, Controller, GetMapping, Autowired } from 'koatty';
import { SiteService } from '../service/SiteService';

@Controller('/')
export class IndexController {
  @Autowired() private siteService!: SiteService;
  ctx: KoattyContext;

  constructor(ctx: KoattyContext) {
    this.ctx = ctx;
  }

  @GetMapping('/')
  async index() {
    this.ctx.type = 'html';
    this.ctx.set('Cache-Control', 'no-store');
    return this.siteService.index();
  }

  @GetMapping('/assets/site.css')
  async css() { this.ctx.type = 'css'; this.ctx.set('Cache-Control', 'no-store'); return this.siteService.read('site.css'); }

  @GetMapping('/assets/site.js')
  async javascript() { this.ctx.type = 'js'; this.ctx.set('Cache-Control', 'no-store'); return this.siteService.read('site.js'); }

  @GetMapping('/healthz')
  async health() { return { status: 'ok', service: 'koatty-github-mirror' }; }
}
