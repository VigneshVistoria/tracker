import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
// Deliberately conservative defaults, well under the published Gemini
// free-tier caps for this model - meant to be tuned down further (or up,
// once the actual account limits are confirmed in AI Studio) via env vars
// rather than a code change.
const RPM_LIMIT = Number(process.env.GEMINI_RPM_LIMIT) || 10;
const RPD_LIMIT = Number(process.env.GEMINI_RPD_LIMIT) || 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Resolution text is sanitizeRichText()'d HTML (see TaskQaReviewsService.
// submit()) - strip tags before sending it to the model so the prompt is
// plain text, not markup.
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPrompt(taskTitle: string, resolution: string): string {
  return [
    `A software developer just submitted a resolution note explaining how they fixed or completed a task called "${taskTitle}".`,
    '',
    'Resolution note:',
    '"""',
    resolution,
    '"""',
    '',
    'Decide if this note is too vague to be useful - i.e. it does not explain what was actually changed, fixed, or done ' +
      '(generic filler like "fixed it", "done", "resolved", "completed as discussed" with no specifics), or it is empty/' +
      'near-empty. A short note that names a specific cause, file, or change is NOT vague, even if brief.',
    '',
    'Respond with ONLY a JSON object, no other text: {"vague": true or false, "reason": "one short sentence"}',
  ].join('\n');
}

// Pilot, flag-only dimension (Developer Non-Compliance Report, "Vague /
// Poor Resolution Notes") - never blocks or slows down a QA/Peer Review
// submission. Callers use queueCheck() and never await its result; any
// failure (missing key, network error, malformed model output, rate
// budget exhausted) just leaves the review's noteQualityFlagged/Reason
// columns NULL ("not checked"), same as a check that never ran.
@Injectable()
export class NoteQualityService {
  private readonly logger = new Logger(NoteQualityService.name);
  // In-process sliding windows, not a queue - this app has no Bull/Redis
  // background job runner, and queueing a "check quality of this specific
  // submission" task to run minutes later isn't useful anyway. Simpler to
  // just skip the check outright when over budget than to defer it.
  private minuteWindow: number[] = [];
  private dayWindow: number[] = [];

  constructor(
    @InjectRepository(TaskQaReview)
    private qaReviewsRepository: Repository<TaskQaReview>,
  ) {}

  queueCheck(reviewId: number, taskTitle: string, resolution: string): void {
    this.check(reviewId, taskTitle, resolution).catch((err) => {
      this.logger.warn(`Note-quality check failed for review ${reviewId}: ${err?.message ?? err}`);
    });
  }

  private async check(reviewId: number, taskTitle: string, resolution: string): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return; // feature not configured yet - stay silent, not an error

    const plainResolution = stripHtml(resolution);
    if (!plainResolution) return;

    if (!this.withinBudget()) {
      this.logger.warn(`Skipping note-quality check for review ${reviewId} - Gemini rate budget exhausted.`);
      return;
    }
    this.recordCall();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildPrompt(taskTitle, plainResolution) }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0 },
          }),
        },
      );
      if (!res.ok) {
        this.logger.warn(`Gemini request failed (${res.status}) for review ${reviewId}`);
        return;
      }
      const data: any = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return;
      const parsed = JSON.parse(text);
      const flagged = parsed?.vague === true;
      const reason = typeof parsed?.reason === 'string' ? parsed.reason.slice(0, 500) : null;
      await this.qaReviewsRepository.update(reviewId, { noteQualityFlagged: flagged, noteQualityReason: reason });
    } finally {
      clearTimeout(timeout);
    }
  }

  private withinBudget(): boolean {
    const now = Date.now();
    this.minuteWindow = this.minuteWindow.filter((t) => now - t < MINUTE_MS);
    this.dayWindow = this.dayWindow.filter((t) => now - t < DAY_MS);
    return this.minuteWindow.length < RPM_LIMIT && this.dayWindow.length < RPD_LIMIT;
  }

  private recordCall(): void {
    const now = Date.now();
    this.minuteWindow.push(now);
    this.dayWindow.push(now);
  }
}
