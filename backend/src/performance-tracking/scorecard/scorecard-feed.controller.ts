import { Controller, Get, Headers, Logger, NotFoundException, Query, UnauthorizedException, UseGuards, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { RealIpThrottlerGuard } from '../../auth/real-ip-throttler.guard';
import { ScorecardService } from './scorecard.service';

// A key shorter than this is treated as not set (feed stays off).
export const FEED_KEY_MIN = 32;

export function feedConfig(env: NodeJS.ProcessEnv = process.env): { key: string; tenantId: number } | null {
  const key = env.PERFORMANCE_FEED_KEY || '';
  const tenantId = Number(env.PERFORMANCE_FEED_TENANT_ID);
  if (key.length < FEED_KEY_MIN || !Number.isInteger(tenantId) || tenantId <= 0) return null;
  return { key, tenantId };
}

export function keyMatches(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(given || '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Performance Tracking B3 - read-only feed for Power Automate -> SharePoint
// -> Power BI. Personal performance data, so there is NO open link: the
// feed is OFF (404) unless PERFORMANCE_FEED_KEY (32+ characters) and
// PERFORMANCE_FEED_TENANT_ID are set in backend/.env, and every request
// must send the key in the X-Performance-Feed-Key header (never in the
// URL, so it doesn't end up in logs). Rate limited. Waiting for the IT
// owner of the flow (see /home/ec2-user/perf-tracking-defaults.md).
@Controller('performance-tracking/feed')
export class ScorecardFeedController {
  private readonly logger = new Logger(ScorecardFeedController.name);

  constructor(private scorecard: ScorecardService) {}

  @UseGuards(RealIpThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get()
  async feed(@Headers('x-performance-feed-key') key: string | undefined, @Query('date') date: string | undefined) {
    const config = feedConfig();
    if (!config) throw new NotFoundException();
    if (!keyMatches(key, config.key)) {
      this.logger.warn('Performance feed: wrong or missing key');
      throw new UnauthorizedException();
    }
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD.');
    const { snapshotDate, rows } = await this.scorecard.flatRows(config.tenantId, date);
    this.logger.log(`Performance feed read: ${snapshotDate ?? 'no data'}, ${rows.length} rows`);
    return { snapshotDate, rows };
  }
}
