import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

// Logs every refused request (4xx) with the reason the user was given, so
// "why was this rejected?" can be answered from the server log. The
// response itself is unchanged (BaseExceptionFilter sends it as before).
// 401s are left out - an expired session refreshes itself and would only
// add noise. Only the method, path (no query string), user id, status and
// message are logged - never the request body, which can hold passwords or
// personal data.
@Catch()
export class RefusedRequestLoggingFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('RefusedRequest');

  catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof HttpException && host.getType() === 'http') {
      const status = exception.getStatus();
      if (status >= 400 && status < 500 && status !== 401) {
        const req = host.switchToHttp().getRequest();
        this.logger.warn(refusedRequestLine(status, req, exception.getResponse()));
      }
    }
    super.catch(exception, host);
  }
}

export function refusedRequestLine(status: number, req: { method?: string; originalUrl?: string; url?: string; user?: { sub?: number } }, response: unknown): string {
  const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
  const raw = typeof response === 'string' ? response : (response as { message?: unknown })?.message;
  const message = Array.isArray(raw) ? raw.join('; ') : String(raw ?? '');
  return `${status} ${req.method} ${path} user=${req.user?.sub ?? '-'}: ${message}`;
}
