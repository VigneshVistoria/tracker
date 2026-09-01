import { Injectable } from '@nestjs/common';
import { Issue, IssueCategory } from './issue.entity';
import { Priority } from '../common/priority.enum';

export type ShowstopperVerdict = 'likely_valid' | 'questionable';
export type ShowstopperConfidence = 'low' | 'medium' | 'high';

export interface ShowstopperValidationResult {
  verdict: ShowstopperVerdict;
  confidence: ShowstopperConfidence | null;
  reasons: string[];
}

// Signal words a real blocking/critical issue's description tends to
// contain - same "look for signal words, don't try to understand the
// text" approach as IssueAnalyzerService. Not exhaustive; the goal is to
// catch descriptions that read like ordinary feature work rather than
// something urgent, not to be a precise classifier.
const SEVERITY_KEYWORDS = [
  'blocking', 'cannot', "can't", 'unable to', 'down', 'outage', 'crash',
  'crashed', 'crashing', 'data loss', 'production', 'all users', 'everyone',
  'broken', 'not working', "doesn't work", 'unusable', 'critical', 'urgent',
  'security', 'breach', 'corrupt',
];

const NON_BLOCKING_CATEGORIES: string[] = [IssueCategory.NEW_FEATURE, IssueCategory.ENHANCEMENT];
const LOW_URGENCY_PRIORITIES = [Priority.MEDIUM, Priority.LOW];

// How many of a creator's most recent tickets to look at for the
// "showstopper-happy" pattern check, and what fraction of those being
// tagged showstopper counts as suspicious.
const RECENT_TICKET_SAMPLE_SIZE = 5;
const RECENT_TICKET_SHOWSTOPPER_THRESHOLD = 3;

@Injectable()
export class ShowstopperValidatorService {
  // recentTicketsByCreator: this creator's most recent tickets (any
  // status), most-recent-first, NOT including the one just being
  // evaluated - the caller fetches this since it requires a query this
  // service has no repository access to run itself.
  evaluate(issue: Pick<Issue, 'description' | 'category' | 'priority'>, recentTicketsByCreator: Issue[]): ShowstopperValidationResult {
    const reasons: string[] = [];
    const description = (issue.description || '').trim();
    const lowerDescription = description.toLowerCase();

    const hasWeakDescription =
      description.length < 20 || !SEVERITY_KEYWORDS.some((kw) => lowerDescription.includes(kw));
    if (hasWeakDescription) {
      reasons.push(
        "Description doesn't contain language typically associated with a blocking or critical issue (e.g. \"down\", \"blocking\", \"cannot\", \"production\").",
      );
    }

    if (issue.category && NON_BLOCKING_CATEGORIES.includes(issue.category)) {
      reasons.push(`Marked Showstopper but categorized as "${issue.category}", which isn't typically blocking work.`);
    }

    if (issue.priority && LOW_URGENCY_PRIORITIES.includes(issue.priority)) {
      reasons.push(`Marked Showstopper but priority is set to "${issue.priority}", which contradicts that urgency.`);
    }

    const recentSample = recentTicketsByCreator.slice(0, RECENT_TICKET_SAMPLE_SIZE);
    const recentShowstopperCount = recentSample.filter((i) => i.showstopper).length;
    if (recentSample.length >= RECENT_TICKET_SAMPLE_SIZE && recentShowstopperCount >= RECENT_TICKET_SHOWSTOPPER_THRESHOLD) {
      reasons.push(
        `This reporter has tagged ${recentShowstopperCount} of their last ${recentSample.length} tickets as Showstopper - worth confirming this one is genuinely blocking rather than a habit.`,
      );
    }

    if (reasons.length === 0) {
      return { verdict: 'likely_valid', confidence: null, reasons: [] };
    }

    return {
      verdict: 'questionable',
      confidence: reasons.length >= 2 ? 'high' : 'low',
      reasons,
    };
  }
}
