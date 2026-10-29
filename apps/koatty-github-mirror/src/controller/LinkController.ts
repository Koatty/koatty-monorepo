import { Controller, PostMapping, RequestBody, Autowired, KoattyContext } from 'koatty';
import { Validated } from 'koatty_validation';
import { CreateLinkDto } from '../dto/CreateLinkDto';
import { LinkService } from '../service/LinkService';

@Controller('/api/links')
export class LinkController {
  @Autowired()
  private linkService!: LinkService;

  ctx: KoattyContext;

  constructor(ctx: KoattyContext) {
    this.ctx = ctx;
  }

  /**
   * POST /api/links → LinkService.create
   * Controller 仅转发已校验的 DTO，地址策略由 Service 负责。
   */
  @PostMapping('/')
  @Validated({ types: [CreateLinkDto] })
  async create(@RequestBody() dto: CreateLinkDto) {
    return this.linkService.create(dto);
  }
}
