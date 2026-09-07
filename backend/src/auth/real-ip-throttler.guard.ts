import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// nginx (the only way to reach this app - see main.ts binding to 127.0.0.1)
// always sets X-Real-IP to the real client address and overwrites any
// client-supplied value of the same header, so it's safe to trust here.
// We read it directly instead of relying on Express's req.ip/trust-proxy
// mechanism, which keys off X-Forwarded-For - a header nginx never sets,
// and which passes through unmodified from the client when present,
// letting anyone bypass rate limiting by spoofing a fresh value per request.
@Injectable()
export class RealIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.headers['x-real-ip'] || req.ip;
  }
}
