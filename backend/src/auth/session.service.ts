import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { Repository, LessThan } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { RefreshSession } from './refresh-session.entity';

// A previous refresh token still works this long after it was swapped -
// two tabs (or a retried request) refreshing at the same moment.
const ROTATION_GRACE_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const REFRESH_COOKIE = 'tracker_refresh';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export type RotateResult =
  // A fresh refresh token to set as the new cookie.
  | { session: RefreshSession; refreshToken: string }
  // The just-replaced token inside the grace window: the browser already
  // has the newer cookie (set for the other tab), so no new cookie.
  | { session: RefreshSession; refreshToken: null };

// Web sign-in sessions (2026-10-18): a short access token in the page plus
// a long-lived refresh token in an httpOnly cookie, swapped on every use.
// Mobile and API callers never touch this - they keep the plain Bearer
// token from /auth/login.
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @InjectRepository(RefreshSession)
    private sessions: Repository<RefreshSession>,
    private config: ConfigService,
  ) {}

  get accessTokenTtl(): string {
    return `${this.number('WEB_ACCESS_TOKEN_TTL_MINUTES', 15)}m`;
  }

  private number(key: string, fallback: number) {
    const value = Number(this.config.get<string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private idleMs() {
    return this.number('REFRESH_IDLE_DAYS', 7) * DAY_MS;
  }

  cookieOptions(maxAgeMs: number) {
    return {
      httpOnly: true,
      // Off only for local http://localhost development.
      secure: this.config.get<string>('REFRESH_COOKIE_SECURE') !== 'false',
      sameSite: 'strict' as const,
      // nginx serves the API under /api, so the browser path is /api/auth;
      // the cookie is never sent with any other request.
      path: this.config.get<string>('REFRESH_COOKIE_PATH') || '/api/auth',
      maxAge: Math.max(0, maxAgeMs),
    };
  }

  cookieMaxAge(session: RefreshSession) {
    return Math.min(session.expiresAt.getTime(), session.absoluteExpiresAt.getTime()) - Date.now();
  }

  async create(userId: number, tenantId: number, userAgent?: string) {
    const refreshToken = randomBytes(32).toString('base64url');
    const now = Date.now();
    const absolute = new Date(now + this.number('REFRESH_ABSOLUTE_DAYS', 30) * DAY_MS);
    const session = await this.sessions.save(
      this.sessions.create({
        tenantId,
        userId,
        tokenHash: hash(refreshToken),
        lastUsedAt: new Date(now),
        expiresAt: new Date(Math.min(now + this.idleMs(), absolute.getTime())),
        absoluteExpiresAt: absolute,
        userAgent: userAgent ? userAgent.slice(0, 300) : null,
      }),
    );
    return { session, refreshToken };
  }

  // Swaps a refresh token for a new one. Throws 401 for anything that is
  // not a live session of this tenant.
  async rotate(refreshToken: string | undefined, tenantId: number): Promise<RotateResult> {
    if (!refreshToken) throw new UnauthorizedException('Session expired');
    const tokenHash = hash(refreshToken);
    const now = new Date();

    const current = await this.sessions.findOne({ where: { tokenHash } });
    if (current) {
      this.assertLive(current, tenantId, now);
      const next = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Math.min(now.getTime() + this.idleMs(), current.absoluteExpiresAt.getTime()));
      // Conditional on the old hash so two simultaneous refreshes can't
      // both swap - the loser falls through to the grace check below.
      const res = await this.sessions
        .createQueryBuilder()
        .update()
        .set({ tokenHash: hash(next), previousTokenHash: tokenHash, rotatedAt: now, lastUsedAt: now, expiresAt })
        .where('id = :id AND "tokenHash" = :tokenHash', { id: current.id, tokenHash })
        .execute();
      if (res.affected === 1) {
        return { session: { ...current, expiresAt, lastUsedAt: now }, refreshToken: next };
      }
    }

    const previous = await this.sessions.findOne({ where: { previousTokenHash: tokenHash } });
    if (!previous) throw new UnauthorizedException('Session expired');
    this.assertLive(previous, tenantId, now);
    if (previous.rotatedAt && now.getTime() - previous.rotatedAt.getTime() <= ROTATION_GRACE_MS) {
      return { session: previous, refreshToken: null };
    }
    // An old token turning up again later means a copy of it exists
    // somewhere - end the whole sign-in rather than let either copy go on.
    await this.revokeSession(previous.id, 'reuse');
    this.logger.warn(`Refresh token reuse on session ${previous.id} (user ${previous.userId}) - session revoked.`);
    throw new UnauthorizedException('Session expired');
  }

  private assertLive(session: RefreshSession, tenantId: number, now: Date) {
    if (session.revokedAt || session.tenantId !== tenantId || session.expiresAt <= now || session.absoluteExpiresAt <= now) {
      throw new UnauthorizedException('Session expired');
    }
  }

  async revokeByToken(refreshToken: string | undefined, reason = 'logout') {
    if (!refreshToken) return;
    const tokenHash = hash(refreshToken);
    const session =
      (await this.sessions.findOne({ where: { tokenHash } })) || (await this.sessions.findOne({ where: { previousTokenHash: tokenHash } }));
    if (session && !session.revokedAt) await this.revokeSession(session.id, reason);
  }

  async revokeSession(id: number, reason: string) {
    await this.sessions.update({ id }, { revokedAt: new Date(), revokedReason: reason });
  }

  // Old rows are only kept for a week after they stop working (a trail of
  // recent sign-ins), then removed.
  @Cron('35 3 * * *')
  async prune() {
    const cutoff = new Date(Date.now() - 7 * DAY_MS);
    const expired = await this.sessions.delete({ expiresAt: LessThan(cutoff) });
    const revoked = await this.sessions.delete({ revokedAt: LessThan(cutoff) });
    const removed = (expired.affected || 0) + (revoked.affected || 0);
    if (removed) this.logger.log(`Pruned ${removed} old sign-in sessions.`);
  }
}

// Reads one cookie from the raw Cookie header (no cookie-parser needed for
// the single cookie this app uses).
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
