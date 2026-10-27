import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildTicketCard, cleanText, TeamsWorkflowWebhookService } from '../src/teams-integration/teams-workflow-webhook.service';

// Teams QA notifications, Stage 1 (2026-10-12): the group-chat sender on
// its own. fetch is faked - nothing is ever sent to Teams from tests.
describe('TeamsWorkflowWebhookService', () => {
  const SECRET_URL = 'https://prod-00.westeurope.logic.azure.com/workflows/abc123/triggers/manual/paths/invoke?sig=TOPSECRETSIGNATURE';
  let logs: string[];
  let fetchMock: jest.SpyInstance;

  const service = (env: Record<string, string | undefined>) =>
    new TeamsWorkflowWebhookService({ get: (key: string) => env[key] } as unknown as ConfigService);

  beforeEach(() => {
    logs = [];
    for (const level of ['log', 'debug', 'warn', 'error', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: any[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // The address and its signature must never reach a log line.
    for (const line of logs) {
      expect(line).not.toContain('logic.azure.com');
      expect(line).not.toContain('TOPSECRETSIGNATURE');
    }
  });

  const card = buildTicketCard({ heading: 'QA rejected task', ticketLabel: 'Task #1: Login', facts: [], url: 'https://tracker.example/tasks/1' });

  it('posts the card as JSON to the configured address, with a timeout', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const ok = await service({ TEAMS_QA_WEBHOOK_URL: SECRET_URL }).postCard(card, 'task #1 rejected');
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SECRET_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual(card);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('is off when the address is missing, blank or not https - nothing sent', async () => {
    for (const value of [undefined, '', '   ', 'http://insecure.example/hook']) {
      const s = service({ TEAMS_QA_WEBHOOK_URL: value });
      expect(s.isConfigured()).toBe(false);
      expect(await s.postCard(card, 'task #1 rejected')).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws: a Teams error, a network error or a timeout just returns false and logs the status only', async () => {
    const s = service({ TEAMS_QA_WEBHOOK_URL: SECRET_URL });

    fetchMock.mockResolvedValueOnce(new Response(`bad request for ${SECRET_URL}`, { status: 400 }));
    await expect(s.postCard(card, 'task #1 rejected')).resolves.toBe(false);

    const network = Object.assign(new TypeError(`fetch failed for ${SECRET_URL}`), { cause: { code: 'ENOTFOUND', message: SECRET_URL } });
    fetchMock.mockRejectedValueOnce(network);
    await expect(s.postCard(card, 'task #2 rejected')).resolves.toBe(false);

    fetchMock.mockRejectedValueOnce(new DOMException(`aborted ${SECRET_URL}`, 'TimeoutError'));
    await expect(s.postCard(card, 'defect #3 created')).resolves.toBe(false);

    fetchMock.mockImplementationOnce(() => {
      throw new Error(`sync failure ${SECRET_URL}`);
    });
    await expect(s.postCard(card, 'defect #4 created')).resolves.toBe(false);

    expect(logs).toEqual([
      expect.stringContaining('Teams QA notification failed for task #1 rejected: HTTP 400'),
      expect.stringContaining('Teams QA notification failed for task #2 rejected: ENOTFOUND'),
      expect.stringContaining('Teams QA notification failed for defect #3 created: timed out after 5000ms'),
      expect.stringContaining('Teams QA notification failed for defect #4 created: Error'),
    ]);
  });

  it('builds the Tracker link from FRONTEND_URL', () => {
    expect(service({ FRONTEND_URL: 'https://tracker.vistoriasystems.com/' }).ticketUrl(42)).toBe('https://tracker.vistoriasystems.com/tasks/42');
  });
});

describe('buildTicketCard', () => {
  it('builds one Adaptive Card with heading, facts, reason, @mention and an Open in Tracker button', () => {
    const payload = buildTicketCard({
      heading: 'QA rejected task',
      ticketLabel: 'Task #12: Claim form total is wrong',
      facts: [
        { title: 'Project', value: 'Amanah' },
        { title: 'Module', value: 'Medical Claim' },
        { title: 'Priority', value: null },
      ],
      text: { label: 'Reason', value: '  Total\n\nignores   VAT ' },
      mention: { email: 'dev@vistoriasystems.com', name: 'Dev One' },
      url: 'https://tracker.example/tasks/12',
    });
    expect(payload.type).toBe('message');
    expect(payload.attachments).toHaveLength(1);
    const content = payload.attachments[0].content as any;
    expect(payload.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(content.type).toBe('AdaptiveCard');
    expect(content.body[0].text).toBe('QA rejected task');
    expect(content.body[2].facts).toEqual([
      { title: 'Project', value: 'Amanah' },
      { title: 'Module', value: 'Medical Claim' },
    ]); // empty facts left out
    expect(content.body.map((b: any) => b.text)).toEqual(expect.arrayContaining(['Assigned to <at>Dev One</at>', 'Total ignores VAT']));
    expect(content.msteams.entities).toEqual([
      { type: 'mention', text: '<at>Dev One</at>', mentioned: { id: 'dev@vistoriasystems.com', name: 'Dev One' } },
    ]);
    expect(content.actions).toEqual([{ type: 'Action.OpenUrl', title: 'Open in Tracker', url: 'https://tracker.example/tasks/12' }]);
  });

  it('works without a mention or reason', () => {
    const content = buildTicketCard({ heading: 'H', ticketLabel: 'L', facts: [], url: 'u' }).attachments[0].content as any;
    expect(content.msteams).toBeUndefined();
    expect(content.body).toHaveLength(3);
  });

  it('cleanText strips control characters and cuts long text', () => {
    expect(cleanText('a\u0000b\u0007c')).toBe('abc');
    expect(cleanText('x'.repeat(600))).toHaveLength(500);
    expect(cleanText('x'.repeat(600)).endsWith('…')).toBe(true);
    expect(cleanText(null)).toBe('');
  });
});
