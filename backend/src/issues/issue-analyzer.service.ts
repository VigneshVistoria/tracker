import { Injectable } from '@nestjs/common';

export type IssueAnalysisStatus = 'invalid' | 'incomplete' | 'needs_more_info' | 'valid';

export interface IssueAnalysisResult {
  status: IssueAnalysisStatus;
  summary: string;
  gaps: string[];
  suggestions: string[];
}

// Looks for signal words/patterns rather than "understanding" the text -
// simple, fast, and doesn't need any external AI service or API key.
@Injectable()
export class IssueAnalyzerService {
  analyze(title: string, description: string): IssueAnalysisResult {
    const t = (title || '').trim();
    const d = (description || '').trim();
    const lowerD = d.toLowerCase();

    const gaps: string[] = [];
    const suggestions: string[] = [];

    const hasTitle = t.length >= 5;
    if (!hasTitle) {
      gaps.push('Title is missing or very short');
      suggestions.push("Give the issue a clear, specific title (e.g. \"Login button unresponsive on Safari\") instead of a one- or two-word summary.");
    }

    const hasDescription = d.length >= 20;
    if (!hasDescription) {
      gaps.push('Description is missing or too short to be useful');
      suggestions.push('Write at least a few sentences describing what happened, so whoever picks this up has enough to go on.');

      // Not enough text to check anything else meaningfully.
      return {
        status: 'invalid',
        summary: 'This issue doesn\'t have enough information yet for someone to act on it.',
        gaps,
        suggestions,
      };
    }

    const hasStepsToReproduce =
      /step[s]?\s*(to\s*)?(reproduce)?/i.test(d) ||
      /\brepro\b/i.test(d) ||
      /(^|\n)\s*(\d+[\.\)]|[-*])\s+/m.test(d);
    if (!hasStepsToReproduce) {
      gaps.push('No steps to reproduce');
      suggestions.push('List the exact steps someone would need to follow to see this issue happen (e.g. "1. Go to... 2. Click... 3. Observe...").');
    }

    const hasExpectedActual =
      (lowerD.includes('expected') && lowerD.includes('actual')) ||
      (lowerD.includes('should') && (lowerD.includes('instead') || lowerD.includes('but ')));
    if (!hasExpectedActual) {
      gaps.push('Missing expected vs. actual behavior');
      suggestions.push('Describe what you expected to happen, and what actually happened instead.');
    }

    const environmentKeywords = [
      'chrome', 'firefox', 'safari', 'edge', 'browser',
      'windows', 'macos', 'mac os', 'linux', 'android', 'ios',
      'mobile', 'desktop', 'tablet', 'version',
    ];
    const hasEnvironmentInfo = environmentKeywords.some((kw) => lowerD.includes(kw));
    if (!hasEnvironmentInfo) {
      gaps.push('No environment details (browser, device, OS, version)');
      suggestions.push('Mention the browser, device, or environment where this occurred - it often narrows down the cause quickly.');
    }

    const evidencePatterns = [
      /\bscreenshot/i,
      /\berror/i,
      /\blogs?\b/i,       // whole word only - won't match inside "login"
      /\battach\w*/i,
      /\brecording/i,
      /\bconsole/i,
    ];
    const hasEvidence = evidencePatterns.some((re) => re.test(d));
    if (!hasEvidence) {
      gaps.push('No supporting evidence mentioned');
      suggestions.push('If possible, attach a screenshot, error message, or log output to speed up diagnosis.');
    }

    const richnessChecks = [hasStepsToReproduce, hasExpectedActual, hasEnvironmentInfo, hasEvidence];
    const passedCount = richnessChecks.filter(Boolean).length;

    let status: IssueAnalysisStatus;
    let summary: string;

    if (passedCount === 0) {
      status = 'incomplete';
      summary = 'There\'s a description here, but it\'s missing the structure that makes an issue easy to act on.';
    } else if (passedCount <= 2) {
      status = 'needs_more_info';
      summary = 'This is a reasonable start, but a bit more detail would help whoever picks this up.';
    } else {
      status = 'valid';
      summary = 'This issue looks well-described and ready to submit.';
    }

    if (!hasTitle) {
      // A weak title still caps the status even if the description is rich.
      status = status === 'valid' ? 'needs_more_info' : status;
    }

    return { status, summary, gaps, suggestions };
  }
}
