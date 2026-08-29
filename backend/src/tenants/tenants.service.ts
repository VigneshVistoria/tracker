import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Tenant } from './tenant.entity';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private tenantsRepository: Repository<Tenant>,
    private config: ConfigService,
  ) {}

  findById(id: number): Promise<Tenant | null> {
    return this.tenantsRepository.findOne({ where: { id } });
  }

  // For scheduled jobs (cron) that have no per-request tenant context and
  // need to run their work once per tenant instead.
  findAll(): Promise<Tenant[]> {
    return this.tenantsRepository.find({ order: { id: 'ASC' } });
  }

  // Resolves which tenant a request belongs to from its Host header's
  // subdomain (e.g. acme.tracker.vistoriasystems.com -> "acme"). Falls
  // back to the first tenant ever created whenever there's no subdomain
  // (the bare domain) or the subdomain doesn't match any tenant - which
  // is the only path that runs today, since Phase D's wildcard DNS/nginx
  // isn't live yet. Once it is, real subdomains start resolving to their
  // own tenant automatically with no further change needed here.
  async resolveFromHost(host: string | undefined): Promise<Tenant> {
    const baseDomain = this.config.get<string>('BASE_DOMAIN', 'tracker.vistoriasystems.com');
    const hostname = (host || '').split(':')[0].toLowerCase();
    const suffix = `.${baseDomain}`;

    if (hostname.endsWith(suffix)) {
      const subdomain = hostname.slice(0, -suffix.length);
      const tenant = await this.tenantsRepository.findOne({ where: { subdomain } });
      if (tenant) return tenant;
    }

    return this.fallbackTenant();
  }

  private async fallbackTenant(): Promise<Tenant> {
    const [first] = await this.tenantsRepository.find({ order: { id: 'ASC' }, take: 1 });
    if (!first) {
      throw new InternalServerErrorException('No tenant exists - the Phase A migration must run before auth can work.');
    }
    return first;
  }
}
