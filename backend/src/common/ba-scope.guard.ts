import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { UserRole } from '../users/user.entity';

// Business Analyst scope (2026-11-25, approved by the user): a BA may call
// ONLY the Requirements API, sign-in/session, and the few per-user calls
// the app frame makes on every page. Every other route answers 403 for a
// BA - one central rule instead of patching each module's role checks
// (several of which treat an unknown role like a PM or a developer).
// Registered app-wide (APP_GUARD). Never affects any other role.
//
// It only looks at requests with a valid token; anything else is left to
// the route's own guard (JwtAuthGuard) exactly as before.
export const BA_ALLOWED_PREFIXES = ['/requirements', '/auth/', '/notifications'];
export const BA_ALLOWED_EXACT = ['/client-portal/me', '/own-metrics-visibility/me'];

export function baMayCall(path: string): boolean {
  const p = (path || '/').replace(/\/+$/, '') || '/';
  if (BA_ALLOWED_EXACT.includes(p)) return true;
  return BA_ALLOWED_PREFIXES.some((prefix) => (prefix.endsWith('/') ? p.startsWith(prefix) : p === prefix || p.startsWith(prefix + '/')));
}

// A user's role is looked up once per ROLE_TTL_MS, so a role change (to or
// from BA) applies within that time without a database read per request.
const ROLE_TTL_MS = 30_000;

@Injectable()
export class BaScopeGuard implements CanActivate {
  private roles = new Map<number, { role: string | null; at: number }>();

  constructor(
    private jwtService: JwtService,
    private dataSource: DataSource,
  ) {}

  private async roleOf(userId: number): Promise<string | null> {
    const hit = this.roles.get(userId);
    if (hit && Date.now() - hit.at < ROLE_TTL_MS) return hit.role;
    const rows: Array<{ role: string }> = await this.dataSource.query(`SELECT role::text AS role FROM users WHERE id = $1`, [userId]);
    const role = rows[0]?.role ?? null;
    if (this.roles.size > 5000) this.roles.clear();
    this.roles.set(userId, { role, at: Date.now() });
    return role;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) return true;
    let sub: number;
    try {
      sub = Number(this.jwtService.verify(header.slice('Bearer '.length))?.sub);
    } catch {
      return true; // the route's own guard refuses it as before
    }
    if (!Number.isInteger(sub)) return true;
    if ((await this.roleOf(sub)) !== UserRole.BA) return true;
    if (baMayCall(request.path)) return true;
    throw new ForbiddenException('Business Analysts can only use Requirements.');
  }
}
