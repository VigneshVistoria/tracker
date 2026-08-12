import { Injectable } from '@nestjs/common';
import { UpdateStatus } from './daily-update.entity';

const BLOCKING_KEYWORDS = [
  'blocked', 'blocker', 'cannot proceed', "can't proceed", 'waiting on',
  'waiting for', 'stuck', 'dependency', 'unable to', 'no access', 'access denied',
];

export interface DailyUpdateAnalysis {
  completedTasks: string[];
  pendingTasks: string[];
  risks: string[];
  carryForwardTasks: string[];
  productivityScore: number;
  status: UpdateStatus;
  managerSummary: string;
}

@Injectable()
export class DailyUpdateAnalyzerService {
  // Splits free text into individual task lines - handles plain lines,
  // "- item", "* item", and "1. item" style bullets.
  private parseLines(text?: string): string[] {
    if (!text) return [];
    return text
      .split('\n')
      .map((line) => line.replace(/^\s*[-*]\s*/, '').replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter((line) => line.length > 0);
  }

  // Two task descriptions are treated as "the same task" if one contains
  // the other after normalizing whitespace/case - good enough without a
  // full NLP model, and avoids exact-match brittleness ("Fix login bug"
  // vs "fix login bug urgently" still counts as the same item).
  private isSameTask(a: string, b: string): boolean {
    const na = a.toLowerCase().trim();
    const nb = b.toLowerCase().trim();
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
  }

  analyze(
    completedText: string | undefined,
    pendingText: string | undefined,
    blockersText: string | undefined,
    previousPendingTasks: string[],
  ): DailyUpdateAnalysis {
    const completedTasks = this.parseLines(completedText);
    const pendingTasks = this.parseLines(pendingText);
    const risks = this.parseLines(blockersText);

    // Anything pending last time that hasn't since shown up as completed
    // today carries forward onto today's plate.
    const carryForwardTasks = (previousPendingTasks || []).filter(
      (prevTask) => !completedTasks.some((done) => this.isSameTask(done, prevTask)),
    );

    const totalWork = completedTasks.length + pendingTasks.length + carryForwardTasks.length;
    const productivityScore = totalWork === 0 ? 0 : Math.round((completedTasks.length / totalWork) * 100);

    const hasBlockingLanguage = risks.some((risk) =>
      BLOCKING_KEYWORDS.some((kw) => risk.toLowerCase().includes(kw)),
    );

    let status: UpdateStatus;
    if (risks.length > 0 && hasBlockingLanguage) {
      status = UpdateStatus.BLOCKED;
    } else if (risks.length > 0 || carryForwardTasks.length > 0 || productivityScore < 60) {
      status = UpdateStatus.AT_RISK;
    } else {
      status = UpdateStatus.ON_TRACK;
    }

    const managerSummary = this.buildManagerSummary({
      completedTasks,
      pendingTasks,
      carryForwardTasks,
      risks,
      productivityScore,
      status,
    });

    return { completedTasks, pendingTasks, risks, carryForwardTasks, productivityScore, status, managerSummary };
  }

  private buildManagerSummary(input: {
    completedTasks: string[];
    pendingTasks: string[];
    carryForwardTasks: string[];
    risks: string[];
    productivityScore: number;
    status: UpdateStatus;
  }): string {
    const { completedTasks, pendingTasks, carryForwardTasks, risks, productivityScore, status } = input;
    const parts: string[] = [];

    if (completedTasks.length > 0) {
      parts.push(`Completed ${completedTasks.length} item${completedTasks.length === 1 ? '' : 's'}, including "${completedTasks[0]}".`);
    } else {
      parts.push('No items were marked complete today.');
    }

    if (carryForwardTasks.length > 0) {
      parts.push(`${carryForwardTasks.length} item${carryForwardTasks.length === 1 ? '' : 's'} carried forward from a previous update.`);
    }

    if (pendingTasks.length > 0) {
      parts.push(`${pendingTasks.length} item${pendingTasks.length === 1 ? '' : 's'} still pending.`);
    }

    if (risks.length > 0) {
      parts.push(`Flagged risk${risks.length === 1 ? '' : 's'}: ${risks.join('; ')}.`);
    }

    parts.push(`Productivity score: ${productivityScore}%.`);

    if (status === UpdateStatus.BLOCKED) {
      parts.push('Recommended next step: unblock this person as a priority - progress has stalled on a dependency outside their control.');
    } else if (status === UpdateStatus.AT_RISK) {
      parts.push('Recommended next step: check in to see if support is needed to clear the backlog or resolve the flagged risk.');
    } else {
      parts.push('Recommended next step: none - on track.');
    }

    return parts.join(' ');
  }
}
