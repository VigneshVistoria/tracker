import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

// Uses the OAuth2 "client credentials" flow - i.e. the backend itself
// authenticates as the registered Azure AD app, not as any individual
// user. This is what lets it read channel messages continuously without
// a person having to stay signed in.
@Injectable()
export class GraphAuthService {
  private readonly logger = new Logger(GraphAuthService.name);
  private cached: CachedToken | null = null;

  constructor(private config: ConfigService) {}

  async getAccessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) {
      return this.cached.accessToken;
    }

    const tenantId = this.config.get<string>('MS_TENANT_ID');
    const clientId = this.config.get<string>('MS_CLIENT_ID');
    const clientSecret = this.config.get<string>('MS_CLIENT_SECRET');

    if (!tenantId || !clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'Microsoft Teams integration is not configured - missing MS_TENANT_ID, MS_CLIENT_ID, or MS_CLIENT_SECRET.',
      );
    }

    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Failed to get Graph token: ${res.status} ${text}`);
      throw new InternalServerErrorException('Could not authenticate with Microsoft Graph.');
    }

    const data = await res.json();
    this.cached = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return this.cached.accessToken;
  }
}
