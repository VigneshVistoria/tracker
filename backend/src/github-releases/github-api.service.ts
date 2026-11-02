import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'crypto';
import { readFileSync } from 'fs';
import { GITHUB_PR_LOOKUPS_MAX } from './github-releases';

// Read-only GitHub access as the GitHub App (P1/P2 from GitHub, see
// ./github-releases.ts): the commits and pull requests in a release, used
// to find TRK-<task> references. Configured in backend/.env:
//   GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_PATH (a .pem readable only by
//   the backend). GITHUB_API_URL is for tests only.
// Without them, releases are still recorded - only the event's own text is
// searched for tasks. Uses Node's built-in crypto and fetch, no library.
@Injectable()
export class GithubApiService {
  private readonly logger = new Logger(GithubApiService.name);
  private tokens = new Map<number, { token: string; expiresAt: number }>();

  constructor(private readonly config: ConfigService) {}

  configured(): boolean {
    return !!(this.config.get<string>('GITHUB_APP_ID') && this.config.get<string>('GITHUB_APP_PRIVATE_KEY_PATH'));
  }

  private base(): string {
    return (this.config.get<string>('GITHUB_API_URL') || 'https://api.github.com').replace(/\/+$/, '');
  }

  // A 9-minute App JWT (RS256), as GitHub requires.
  private appJwt(): string {
    const appId = this.config.get<string>('GITHUB_APP_ID')!;
    const key = readFileSync(this.config.get<string>('GITHUB_APP_PRIVATE_KEY_PATH')!, 'utf8');
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: appId })}`;
    return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url')}`;
  }

  private async request(path: string, token: string, method = 'GET'): Promise<any> {
    const res = await fetch(`${this.base()}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'vistoria-tracker',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]} returned ${res.status}`);
    return res.json();
  }

  // Installation tokens last an hour; reused until a minute before expiry.
  private async installationToken(installationId: number): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
    const body = await this.request(`/app/installations/${installationId}/access_tokens`, this.appJwt(), 'POST');
    this.tokens.set(installationId, { token: body.token, expiresAt: Date.parse(body.expires_at) || Date.now() + 3_000_000 });
    return body.token;
  }

  // The commit a tag or ref points at.
  async commitSha(installationId: number, repo: string, ref: string): Promise<string> {
    const token = await this.installationToken(installationId);
    const body = await this.request(`/repos/${repo}/commits/${encodeURIComponent(ref)}`, token);
    return body.sha;
  }

  // The text that may name tasks for a release at `sha`: commit messages
  // since `previousSha` (or just this commit, for the first release), and
  // the titles and branch names of their pull requests.
  async releaseTexts(installationId: number, repo: string, sha: string, previousSha: string | null): Promise<{ texts: string[]; notes: string[] }> {
    const token = await this.installationToken(installationId);
    const notes: string[] = [];
    let commits: Array<{ sha: string; commit: { message: string } }>;
    if (previousSha && previousSha !== sha) {
      try {
        const body = await this.request(`/repos/${repo}/compare/${previousSha}...${sha}`, token);
        commits = body.commits ?? [];
        if ((body.total_commits ?? 0) > commits.length) notes.push(`Only the first ${commits.length} of ${body.total_commits} commits were checked for tasks.`);
      } catch (err: any) {
        this.logger.warn(`compare ${repo} ${previousSha}...${sha}: ${err.message}`);
        notes.push('Could not compare with the previous release - only this commit was checked for tasks.');
        commits = [await this.request(`/repos/${repo}/commits/${sha}`, token)];
      }
    } else {
      commits = [await this.request(`/repos/${repo}/commits/${sha}`, token)];
      if (!previousSha) notes.push('First GitHub release of this app - only its own commit was checked for tasks.');
    }
    const texts = commits.map((c) => c.commit?.message ?? '');
    const seen = new Set<number>();
    const recent = [...commits].reverse().slice(0, GITHUB_PR_LOOKUPS_MAX);
    if (commits.length > recent.length) notes.push(`Pull requests were looked up for the newest ${recent.length} commits only.`);
    for (const c of recent) {
      try {
        const pulls: Array<{ number: number; title: string; head?: { ref?: string } }> = await this.request(`/repos/${repo}/commits/${c.sha}/pulls`, token);
        for (const p of pulls) {
          if (seen.has(p.number)) continue;
          seen.add(p.number);
          texts.push(p.title ?? '', p.head?.ref ?? '');
        }
      } catch (err: any) {
        this.logger.warn(`pulls for ${repo}@${c.sha.slice(0, 7)}: ${err.message}`);
      }
    }
    return { texts, notes };
  }
}
