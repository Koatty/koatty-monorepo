import { Autowired, Service, KoattyApplication } from 'koatty';
import { ReleaseService } from './ReleaseService';
import { CreateLinkDto } from '../dto/CreateLinkDto';
import { parseTarget, proxyPath } from '../utils/policy';
import { MirrorError } from '../utils/MirrorError';

@Service()
export class LinkService {
  app!: KoattyApplication;
  @Autowired()
  private releaseService!: ReleaseService;

  async create(dto: CreateLinkDto) {
    const listing = await this.releaseService.resolve(dto.url.trim());
    if (listing) return listing;
    const target = parseTarget(dto.url.trim());
    if (target.kind === 'git' && target.operation !== 'root') throw new MirrorError(400, 'INVALID_REPOSITORY', '请输入以 .git 结尾的仓库地址。');
    const baseUrl = target.kind === 'git' ? this.app.config('gitOrigin', 'link') : '';
    return { kind: target.kind, source: target.url.href, path: proxyPath(target.url), ...(baseUrl ? { baseUrl } : {}) };
  }
}
