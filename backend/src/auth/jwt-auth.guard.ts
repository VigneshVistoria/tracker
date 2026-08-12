import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

// Protects a route: requires a valid "Authorization: Bearer <token>" header.
// On success, attaches the decoded payload as request.user (so controllers
// can access request.user.sub / request.user.email).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.slice('Bearer '.length);

    try {
      const payload = this.jwtService.verify(token);
      request.user = payload; // { sub: userId, email }
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
