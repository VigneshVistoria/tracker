import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

// One assignee's slice of WeeklyReportsService.generate()'s output - see
// that file for exactly how each field is computed.
export interface AssigneePerformanceStat {
  assigneeEmail: string;
  totalAssigned: number;
  completedAllTime: number;
  completionPercent: number;
  currentOpenCount: number;
  performancePercent: number;
  currentOpenItems: any[];
  completedThisWeek: any[];
  carryForwardItems: any[];
  delayedItems: any[];
  blockedItems: any[];
  dependencyItems: any[];
  riskItems: any[];
  performanceRate: number;
  trend: { direction: 'up' | 'down' | 'flat' | 'new'; performanceRateDelta: number | null; completionPercentDelta: number | null };
}

export interface PerformanceReportMeta {
  weekStartDate: string;
  weekEndDate: string;
  previousWeekStartDate: string;
  previousWeekEndDate: string;
}

// Renders one PDF per assignee for the Weekly Performance Report feature.
// Deliberately built with pdfkit (pure JS, no headless-browser/Chromium
// dependency) since this runs unattended on a modest production EC2 box.
@Injectable()
export class PdfPerformanceReportService {
  async buildAssigneeReport(meta: PerformanceReportMeta, stat: AssigneePerformanceStat): Promise<Buffer> {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    this.renderHeader(doc, meta, stat);
    this.renderExecutiveSummary(doc, meta, stat);
    this.renderKpiMetrics(doc, stat);
    this.renderTaskDetails(doc, stat);
    this.renderCarryForward(doc, stat);
    this.renderDependenciesAndRisks(doc, stat);
    this.renderPerformanceInsights(doc, meta, stat);

    doc.end();
    return done;
  }

  private renderHeader(doc: PDFKit.PDFDocument, meta: PerformanceReportMeta, stat: AssigneePerformanceStat) {
    doc.fontSize(20).fillColor('#1a1a1a').text('Weekly Performance Report', { align: 'left' });
    doc.fontSize(11).fillColor('#555555').text(`Week: ${meta.weekStartDate} to ${meta.weekEndDate}`);
    doc.text(`Assignee: ${stat.assigneeEmail}`);
    doc.moveDown(1);
    this.hr(doc);
    doc.moveDown(0.5);
  }

  private renderExecutiveSummary(doc: PDFKit.PDFDocument, meta: PerformanceReportMeta, stat: AssigneePerformanceStat) {
    this.sectionTitle(doc, 'Executive Summary');
    const trendLine = this.trendSentence(stat.trend);
    doc
      .fontSize(10)
      .fillColor('#222222')
      .text(
        `${stat.assigneeEmail} completed ${stat.completedThisWeek.length} item(s) this week and currently has ` +
          `${stat.currentOpenCount} open item(s), for an overall completion rate of ${stat.completionPercent}% ` +
          `(${stat.completedAllTime}/${stat.totalAssigned} all-time). ${trendLine}`,
      );
    if (stat.delayedItems.length > 0 || stat.blockedItems.length > 0) {
      doc
        .fillColor('#a83232')
        .text(
          `Attention needed: ${stat.delayedItems.length} delayed item(s) and ${stat.blockedItems.length} blocked ` +
            `item(s) are impacting this week's Performance Rate.`,
        )
        .fillColor('#222222');
    }
    doc.moveDown(1);
  }

  private renderKpiMetrics(doc: PDFKit.PDFDocument, stat: AssigneePerformanceStat) {
    this.sectionTitle(doc, 'KPI Metrics');
    const rows: [string, string][] = [
      ['Current Open Items', String(stat.currentOpenCount)],
      ['Completed Items (this week)', String(stat.completedThisWeek.length)],
      ['Completed Items (all-time)', `${stat.completedAllTime} / ${stat.totalAssigned}`],
      ['Overall Completion Percentage', `${stat.completionPercent}%`],
      ['Performance Rate', `${stat.performanceRate}%`],
      ['Status Health Score', `${stat.performancePercent}%`],
    ];
    this.keyValueTable(doc, rows);

    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#222222').text('Item Status Summary:', { continued: false });
    const statusCounts = this.statusCounts(stat);
    this.keyValueTable(doc, [
      ['Completed (this week)', String(statusCounts.completed)],
      ['In Progress', String(statusCounts.inProgress)],
      ['Delayed', String(statusCounts.delayed)],
      ['Blocked', String(statusCounts.blocked)],
    ]);
    doc.moveDown(1);
  }

  private renderTaskDetails(doc: PDFKit.PDFDocument, stat: AssigneePerformanceStat) {
    this.sectionTitle(doc, 'Task Details');
    if (stat.currentOpenItems.length === 0) {
      doc.fontSize(10).fillColor('#555555').text('No open items - nice and clear.');
    } else {
      for (const item of stat.currentOpenItems) {
        this.issueLine(doc, item, { showBlocked: stat.blockedItems.some((b) => b.id === item.id) });
      }
    }
    doc.moveDown(1);
  }

  private renderCarryForward(doc: PDFKit.PDFDocument, stat: AssigneePerformanceStat) {
    this.sectionTitle(doc, 'Carry-Forward Items');
    if (stat.carryForwardItems.length === 0) {
      doc.fontSize(10).fillColor('#555555').text('None - everything open was picked up this week.');
    } else {
      doc
        .fontSize(10)
        .fillColor('#555555')
        .text(`${stat.carryForwardItems.length} item(s) rolled forward from a previous week:`);
      for (const item of stat.carryForwardItems) {
        this.issueLine(doc, item);
      }
    }
    doc.moveDown(1);
  }

  private renderDependenciesAndRisks(doc: PDFKit.PDFDocument, stat: AssigneePerformanceStat) {
    this.sectionTitle(doc, 'Dependencies & Risks');

    doc.fontSize(10).fillColor('#222222').text('Dependency items impacting completion:');
    if (stat.dependencyItems.length === 0) {
      doc.fillColor('#555555').text('None.');
    } else {
      for (const dep of stat.dependencyItems) {
        this.issueLine(doc, dep);
      }
    }
    doc.moveDown(0.5);

    doc.fillColor('#222222').text('Risks or blockers:');
    if (stat.riskItems.length === 0) {
      doc.fillColor('#555555').text('None identified.');
    } else {
      for (const risk of stat.riskItems) {
        const tags = [
          stat.blockedItems.some((b) => b.id === risk.id) ? 'Blocked' : null,
          risk.category === 'Critical' || risk.category === 'Showstopper' ? risk.category : null,
          risk.showstopper ? 'Showstopper flag' : null,
        ].filter(Boolean);
        this.issueLine(doc, risk, { suffix: tags.length ? ` [${tags.join(', ')}]` : '' });
      }
    }
    doc.moveDown(1);
  }

  private renderPerformanceInsights(doc: PDFKit.PDFDocument, meta: PerformanceReportMeta, stat: AssigneePerformanceStat) {
    this.sectionTitle(doc, 'Performance Insights');

    doc.fontSize(10).fillColor('#222222').font('Helvetica-Bold').text('Achievement summary for the week');
    doc
      .font('Helvetica')
      .text(
        stat.completedThisWeek.length > 0
          ? `Completed ${stat.completedThisWeek.length} item(s): ${stat.completedThisWeek
              .map((i: any) => `#${i.id} ${i.title}`)
              .join(', ')}.`
          : 'No items were completed this week.',
      );
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').text('Completion trend');
    doc.font('Helvetica').text(this.trendSentence(stat.trend));
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').text('Outstanding actions');
    doc
      .font('Helvetica')
      .text(
        stat.currentOpenCount === 0
          ? 'No outstanding open items.'
          : `${stat.currentOpenCount} item(s) remain open, including ${stat.delayedItems.length} delayed ` +
              `and ${stat.blockedItems.length} blocked. Priority should go to items open longest and any ` +
              `flagged as Critical/Showstopper.`,
      );
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').text('Dependency impact assessment');
    doc
      .font('Helvetica')
      .text(
        stat.dependencyItems.length === 0
          ? 'No outstanding dependencies are affecting this assignee\'s work.'
          : `${stat.blockedItems.length} item(s) are blocked on ${stat.dependencyItems.length} open dependency ` +
              `ticket(s). Resolving those dependencies should be treated as a priority to unblock progress.`,
      );
    doc.moveDown(0.3);

    doc.font('Helvetica-Bold').text('Recommended next steps');
    doc.font('Helvetica');
    for (const step of this.recommendedNextSteps(stat)) {
      doc.text(`• ${step}`);
    }
  }

  // ---- narrative + formatting helpers -------------------------------

  private recommendedNextSteps(stat: AssigneePerformanceStat): string[] {
    const steps: string[] = [];
    if (stat.blockedItems.length > 0) {
      steps.push(`Escalate or follow up on the ${stat.dependencyItems.length} open dependency ticket(s) blocking work.`);
    }
    if (stat.delayedItems.length > 0) {
      steps.push(`Review the ${stat.delayedItems.length} item(s) with no status movement in 7+ days and unblock or reassign as needed.`);
    }
    if (stat.carryForwardItems.length > 0) {
      steps.push(`Prioritize the ${stat.carryForwardItems.length} carry-forward item(s) before taking on new work.`);
    }
    if (stat.riskItems.some((r: any) => r.category === 'Critical' || r.category === 'Showstopper' || r.showstopper)) {
      steps.push('Address flagged Critical/Showstopper items first - these carry the highest risk if left open.');
    }
    if (steps.length === 0) {
      steps.push('No specific concerns this week - maintain current pace.');
    }
    return steps;
  }

  private trendSentence(trend: AssigneePerformanceStat['trend']): string {
    if (trend.direction === 'new') return 'No prior week to compare against yet.';
    const delta = trend.performanceRateDelta ?? 0;
    if (trend.direction === 'up') return `Performance Rate improved by ${Math.abs(delta)} point(s) vs. last week.`;
    if (trend.direction === 'down') return `Performance Rate dropped by ${Math.abs(delta)} point(s) vs. last week.`;
    return 'Performance Rate is flat vs. last week.';
  }

  private statusCounts(stat: AssigneePerformanceStat) {
    const blockedIds = new Set(stat.blockedItems.map((i: any) => i.id));
    const delayedIds = new Set(stat.delayedItems.map((i: any) => i.id));
    const inProgress = stat.currentOpenItems.filter((i: any) => !blockedIds.has(i.id) && !delayedIds.has(i.id)).length;
    return {
      completed: stat.completedThisWeek.length,
      inProgress,
      delayed: stat.delayedItems.length,
      blocked: stat.blockedItems.length,
    };
  }

  private sectionTitle(doc: PDFKit.PDFDocument, title: string) {
    doc.moveDown(0.3);
    doc.fontSize(13).fillColor('#1a1a1a').font('Helvetica-Bold').text(title);
    doc.font('Helvetica');
    this.hr(doc, 1);
    doc.moveDown(0.3);
  }

  private hr(doc: PDFKit.PDFDocument, thickness = 0.5) {
    const y = doc.y;
    doc
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.width - doc.page.margins.right, y)
      .lineWidth(thickness)
      .strokeColor('#cccccc')
      .stroke();
    doc.moveDown(0.2);
  }

  private keyValueTable(doc: PDFKit.PDFDocument, rows: [string, string][]) {
    doc.fontSize(10);
    for (const [key, value] of rows) {
      doc.fillColor('#555555').text(key, { continued: true, width: 300 });
      doc.fillColor('#111111').text(`  ${value}`);
    }
  }

  private issueLine(doc: PDFKit.PDFDocument, item: any, opts: { showBlocked?: boolean; suffix?: string } = {}) {
    const blockedTag = opts.showBlocked ? ' [Blocked]' : '';
    doc
      .fontSize(9)
      .fillColor('#333333')
      .text(
        `#${item.id} ${item.title}${item.projectName ? ` (${item.projectName})` : ''} - ${item.status}${blockedTag}${
          opts.suffix || ''
        }`,
      );
  }
}
