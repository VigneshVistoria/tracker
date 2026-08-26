import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';

// Structured output schema - the model's response is validated against
// this directly (output_config.format), rather than asking for Markdown
// and regex-parsing it. Far more reliable, and this is the officially
// documented approach for "predictable, easy to parse" responses.
const UserStorySchema = z.object({
  suggestedTitle: z.string(),
  userStory: z.string(),
  acceptanceCriteria: z.array(z.string()),
  scopeIncluded: z.array(z.string()),
  scopeExcluded: z.array(z.string()),
});

export type GeneratedUserStory = z.infer<typeof UserStorySchema>;

@Injectable()
export class AiAssistService {
  private readonly logger = new Logger(AiAssistService.name);
  private client: Anthropic | null = null;
  private model: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    // Model is config, not code - switching from the free-tier testing
    // model (Haiku 4.5) to Sonnet/Opus later is a one-line env change,
    // not a rebuild.
    this.model = this.configService.get<string>('ANTHROPIC_MODEL', 'claude-haiku-4-5');
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      this.logger.warn('ANTHROPIC_API_KEY is not set - AI user story generation is disabled.');
    }
  }

  async generateUserStory(keyword: string): Promise<GeneratedUserStory> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'AI generation is not configured on this server yet. Fill in the fields manually for now.',
      );
    }

    try {
      const message = await this.client.messages.parse({
        model: this.model,
        max_tokens: 1024,
        output_config: {
          format: zodOutputFormat(UserStorySchema),
        },
        messages: [
          {
            role: 'user',
            content:
              `Turn this short keyword/phrase into a well-formed agile ticket. Keyword: "${keyword}"\n\n` +
              'Provide:\n' +
              '- suggestedTitle: a short, clear ticket title (5-8 words)\n' +
              '- userStory: a single "As a [role], I want [goal], so that [benefit]" sentence - infer a sensible role from context if none is given\n' +
              '- acceptanceCriteria: 3-6 specific, testable checklist items (not vague statements like "it should work well")\n' +
              '- scopeIncluded: what this ticket covers\n' +
              '- scopeExcluded: what is explicitly out of scope for this ticket\n\n' +
              'Keep everything concise and concrete - this is a starting draft a Program Manager will review and edit, not final copy.',
          },
        ],
      });

      if (!message.parsed_output) {
        throw new Error('Response did not match the expected format.');
      }

      return message.parsed_output;
    } catch (err: any) {
      // Most-specific-first, per the SDK's typed exception classes -
      // never string-match error messages. Whatever the cause, the
      // caller (and ultimately the form) just needs to know generation
      // failed and fields are still manually editable - it should never
      // block ticket creation.
      if (err instanceof Anthropic.RateLimitError) {
        this.logger.warn(`AI generation rate-limited: ${err.message}`);
        throw new ServiceUnavailableException('AI generation is busy right now - try again shortly, or fill in the fields manually.');
      }
      if (err instanceof Anthropic.APIError) {
        this.logger.error(`AI generation API error: ${err.status} ${err.message}`);
        throw new ServiceUnavailableException('AI generation failed - fill in the fields manually for now.');
      }
      this.logger.error(`AI generation unexpected error: ${err.message}`);
      throw new ServiceUnavailableException('AI generation failed - fill in the fields manually for now.');
    }
  }
}
