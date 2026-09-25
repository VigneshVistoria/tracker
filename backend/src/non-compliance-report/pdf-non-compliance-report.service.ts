import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { DeveloperNonComplianceRow, NonComplianceReportResult } from './non-compliance-report.service';

const MISSED_SLA_REASON_LABEL: Record<string, string> = {
  resolved_late: 'Resolved late',
  open_past_due: 'Open, past due',
  review_overdue: 'Pending review, past QA Review Due Date',
};

// Same color roles as the dashboard (frontend/pages/reports/non-compliance.js),
// just the raw hex pdfkit needs instead of the app's CSS custom
// properties - kept in sync by hand (no shared token source between a
// browser stylesheet and a pdfkit render in this codebase).
const CRITICAL = '#b91c1c'; // --ds-color-error-dark
const GOOD = '#15803d'; // --ds-color-success-dark
const MUTED = '#8a7d72';
const INK = '#362b23';
const INK_SOFT = '#6b5f55';

function devName(dev: DeveloperNonComplianceRow): string {
  return dev.fullName || dev.email;
}

// Single PDF covering every developer for the selected range - unlike
// PdfPerformanceReportService (one PDF per assignee, emailed out
// separately), this is one on-demand document an Admin/PM/Executive
// downloads to review the whole team at once. Mirrors the in-app
// dashboard's structure (KPI row, two bar charts, flagged-only detail,
// compact compliant list) rather than the flat per-developer text wall
// the previous version of this PDF used - same underlying report data,
// laid out so nothing wraps mid-row. Still pure pdfkit (no headless
// browser) - bars are drawn as plain filled rectangles.
@Injectable()
export class PdfNonComplianceReportService {
  async buildReport(report: NonComplianceReportResult): Promise<Buffer> {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    this.renderHeader(doc, report);
    this.renderSummary(doc, report);
    if (report.developers.length > 0) {
      this.renderBarChart(
        doc,
        'Missed SLA / Due Dates (by developer)',
        [...report.developers].sort((a, b) => b.missedSla.count - a.missedSla.count),
        (dev) => ({ value: dev.missedSla.count, flagged: dev.missedSla.flagged, label: `${dev.missedSla.count}`, eligible: true }),
        report.thresholds.missedSlaCount,
      );
      doc.moveDown(0.5);
      const isRateEligible = (dev: DeveloperNonComplianceRow) => dev.rejectionRate.submissions >= report.thresholds.rejectionRateMinSubmissions;
      const rateSorted = [...report.developers].sort((a, b) => {
        const aEligible = isRateEligible(a);
        const bEligible = isRateEligible(b);
        if (aEligible !== bEligible) return aEligible ? -1 : 1;
        return b.rejectionRate.rate - a.rejectionRate.rate;
      });
      this.renderBarChart(
        doc,
        'QA / Peer Review Rejection Rate (by developer)',
        rateSorted,
        (dev) => ({
          value: dev.rejectionRate.rate,
          flagged: dev.rejectionRate.flagged,
          label: `${dev.rejectionRate.rate}%`,
          eligible: isRateEligible(dev),
        }),
        report.thresholds.rejectionRatePercent,
      );
      doc.moveDown(0.3);
      this.renderLegend(doc, report.thresholds.rejectionRateMinSubmissions);
      doc.moveDown(0.5);
      this.renderBarChart(
        doc,
        'Vague / Poor Resolution Notes (flagged of checked, by developer)',
        [...report.developers].sort((a, b) => b.resolutionQuality.count - a.resolutionQuality.count),
        (dev) => ({
          value: dev.resolutionQuality.count,
          flagged: dev.resolutionQuality.flagged,
          label: `${dev.resolutionQuality.count}/${dev.resolutionQuality.checked}`,
          eligible: true,
        }),
        report.thresholds.vagueNotesCount,
      );
      doc.moveDown(0.5);
      this.hr(doc);
      doc.moveDown(0.5);
    }
    this.renderFlaggedDetail(doc, report);
    this.renderCompliantList(doc, report);
    this.renderDeferredDimensions(doc, report);

    doc.end();
    return done;
  }

  private renderHeader(doc: PDFKit.PDFDocument, report: NonComplianceReportResult) {
    doc.fontSize(20).fillColor(INK).font('Helvetica-Bold').text('Developer Non-Compliance Report');
    doc.font('Helvetica');
    const rangeLabel = report.range.from || report.range.to ? `${report.range.from ?? 'Start'} to ${report.range.to ?? 'Now'}` : 'All Time';
    doc.fontSize(10).fillColor(INK_SOFT).text(`Period: ${rangeLabel}`);
    doc.text(
      `Thresholds: ${report.thresholds.missedSlaCount}+ missed SLA/due dates, rejection rate > ${report.thresholds.rejectionRatePercent}% (min ${report.thresholds.rejectionRateMinSubmissions} submissions), ${report.thresholds.escalationCount}+ escalation(s), ${report.thresholds.vagueNotesCount}+ vague resolution note(s).`,
    );
    doc.moveDown(0.8);
    this.hr(doc);
    doc.moveDown(0.5);
  }

  // Four-tile KPI row, laid out as evenly-spaced columns rather than
  // pdfkit's default vertical text flow - same numbers the dashboard's
  // KPI row shows, computed once server-side (NonComplianceReportService.
  // computeReport()'s `summary`) so this can never drift from the
  // dashboard's own math.
  private renderSummary(doc: PDFKit.PDFDocument, report: NonComplianceReportResult) {
    const { summary } = report;
    const left = doc.page.margins.left;
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startY = doc.y;

    const tiles: Array<{ label: string; value: string; sub: string; critical: boolean }> = [
      {
        label: 'DEVELOPERS FLAGGED',
        value: `${summary.flaggedCount} / ${summary.totalDevelopers}`,
        sub: summary.flaggedNames.join(', ') || 'None',
        critical: summary.flaggedCount > 0,
      },
      {
        label: 'MISSED SLA / DUE DATES',
        value: `${summary.missedSlaTotal}`,
        sub: 'across flagged developers',
        critical: false,
      },
      {
        label: 'REJECTIONS / SUBMISSIONS',
        value: `${summary.rejectionsTotal} / ${summary.submissionsTotal}`,
        sub: `${summary.blendedRejectionRate}% blended rate`,
        critical: false,
      },
      {
        label: 'ESCALATED TO PM',
        value: `${summary.escalationsTotal}`,
        sub: 'across flagged developers',
        critical: false,
      },
      {
        label: 'VAGUE NOTES',
        value: `${summary.vagueNotesTotal}`,
        sub: 'across flagged devs (AI pilot)',
        critical: false,
      },
    ];

    const colWidth = contentWidth / tiles.length;
    tiles.forEach((tile, i) => {
      const x = left + i * colWidth;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(INK_SOFT).text(tile.label, x, startY, { width: colWidth - 10 });
      doc
        .fontSize(20)
        .font('Helvetica-Bold')
        .fillColor(tile.critical ? CRITICAL : INK)
        .text(tile.value, x, doc.y, { width: colWidth - 10 });
      doc.fontSize(8).font('Helvetica').fillColor(MUTED).text(tile.sub, x, doc.y, { width: colWidth - 10 });
    });

    // pdfkit remembers the last explicit x a .text() call used as the
    // "cursor" for the next unpositioned call - the tiles loop above
    // leaves it at the rightmost tile's x, so anything rendered next
    // (e.g. the following chart's title) would wrap inside a sliver of
    // the page unless x is explicitly put back at the left margin here.
    doc.x = left;
    doc.y = startY + 82;
    doc.moveDown(0.5);
    this.hr(doc);
    doc.moveDown(0.5);
  }

  // Bars are scaled to this chart's own current max ELIGIBLE value (not a
  // fixed scale) - same "relative severity at a glance" reasoning as the
  // dashboard's barWidthPercent()/thresholdPositionPercent(). Ineligible
  // developers (extract().eligible === false) still get a row - matching
  // the dashboard/mockup's own "n/a" row treatment - rather than being
  // dropped into a separate footnote line.
  private renderBarChart(
    doc: PDFKit.PDFDocument,
    title: string,
    rows: DeveloperNonComplianceRow[],
    extract: (dev: DeveloperNonComplianceRow) => { value: number; flagged: boolean; label: string; eligible: boolean },
    threshold: number,
  ) {
    const left = doc.page.margins.left;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(INK).text(title, left, doc.y);
    doc.font('Helvetica');
    doc.moveDown(0.2);

    const eligibleValues = rows.map(extract).filter((r) => r.eligible).map((r) => r.value);
    const max = Math.max(...eligibleValues, 1);
    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const nameWidth = 90;
    const valueWidth = 50;
    const trackWidth = contentWidth - nameWidth - valueWidth - 10;
    const trackHeight = 10;
    const thresholdX = left + nameWidth + Math.min((threshold / max) * trackWidth, trackWidth);

    rows.forEach((dev) => {
      const { value, flagged, label, eligible } = extract(dev);
      const rowY = doc.y;
      doc.fontSize(9).fillColor(INK).text(devName(dev), left, rowY + 1, { width: nameWidth - 5 });

      const trackX = left + nameWidth;
      if (eligible) {
        doc.rect(trackX, rowY, trackWidth, trackHeight).fillColor('#f1ede7').fill();
        const barWidth = Math.max((value / max) * trackWidth, 3);
        doc.rect(trackX, rowY, barWidth, trackHeight).fillColor(flagged ? CRITICAL : GOOD).fill();
        // Threshold marker line.
        doc
          .moveTo(thresholdX, rowY - 1)
          .lineTo(thresholdX, rowY + trackHeight + 1)
          .lineWidth(1)
          .strokeColor(INK)
          .opacity(0.4)
          .stroke()
          .opacity(1);
        doc.fontSize(9).fillColor(INK).font('Helvetica-Bold').text(label, trackX + trackWidth + 8, rowY + 1, { width: valueWidth });
        doc.font('Helvetica');
      } else {
        doc.rect(trackX, rowY, trackWidth, trackHeight).fillColor('#f1ede7').fill();
        doc
          .fontSize(8)
          .font('Helvetica-Oblique')
          .fillColor(MUTED)
          .text('n/a', trackX + trackWidth + 8, rowY + 1, { width: valueWidth });
        doc.font('Helvetica');
      }
      doc.y = rowY + trackHeight + 4;
    });

    // Same reset reasoning as renderSummary() above - the last row's
    // value text left x pinned near the right margin.
    doc.x = left;
  }

  private renderLegend(doc: PDFKit.PDFDocument, minSubmissions: number) {
    const left = doc.page.margins.left;
    doc.fontSize(8).fillColor(MUTED).text(`n/a = fewer than ${minSubmissions} submissions in this period, not zero-rejection compliance.`, left, doc.y);
    doc.moveDown(0.3);
    const y = doc.y;
    let x = left;

    const swatch = (color: string, label: string) => {
      doc.rect(x, y + 1, 8, 8).fillColor(color).fill();
      doc.fontSize(8).font('Helvetica').fillColor(INK_SOFT).text(label, x + 12, y, { continued: false });
      x += 12 + doc.widthOfString(label) + 18;
    };
    swatch(CRITICAL, 'Over threshold (flagged)');
    swatch(GOOD, 'Under threshold');

    doc
      .moveTo(x, y + 5)
      .lineTo(x + 14, y + 5)
      .lineWidth(1)
      .strokeColor(INK)
      .opacity(0.4)
      .dash(2, { space: 1.5 })
      .stroke()
      .undash()
      .opacity(1);
    doc.fontSize(8).fillColor(INK_SOFT).text('Flag threshold', x + 20, y);

    doc.x = left;
    doc.moveDown(0.5);
    this.hr(doc);
    doc.moveDown(0.5);
  }

  private renderFlaggedDetail(doc: PDFKit.PDFDocument, report: NonComplianceReportResult) {
    doc.fontSize(13).font('Helvetica-Bold').fillColor(INK).text('Flagged Developers - Detail');
    doc.font('Helvetica');
    doc.moveDown(0.3);

    const flagged = report.developers.filter((d) => d.flagged);
    if (flagged.length === 0) {
      doc.fontSize(10).fillColor(INK_SOFT).text('No developers are flagged for this period.');
      doc.moveDown(0.5);
      return;
    }

    flagged.forEach((dev, index) => {
      if (index > 0) doc.moveDown(0.6);
      doc.fontSize(12).font('Helvetica-Bold').fillColor(CRITICAL).text(`${devName(dev)}  [FLAGGED]`);
      doc.font('Helvetica').fontSize(9).fillColor(INK_SOFT).text(dev.email);
      doc.moveDown(0.2);

      this.renderMetricLine(doc, 'Missed SLA / Due Dates', `${dev.missedSla.count}`, dev.missedSla.flagged);
      dev.missedSla.items.slice(0, 8).forEach((item) => {
        doc
          .fontSize(8.5)
          .fillColor(INK_SOFT)
          .text(`   #${item.taskId} ${item.title} - ${MISSED_SLA_REASON_LABEL[item.reason] ?? item.reason}`);
      });
      if (dev.missedSla.items.length > 8) {
        doc.fontSize(8.5).fillColor(MUTED).text(`   ...and ${dev.missedSla.items.length - 8} more.`);
      }

      const belowMin = dev.rejectionRate.submissions < report.thresholds.rejectionRateMinSubmissions;
      this.renderMetricLine(
        doc,
        'QA/Peer Review Rejection Rate',
        belowMin
          ? `${dev.rejectionRate.rejections}/${dev.rejectionRate.submissions} - below minimum submissions to flag`
          : `${dev.rejectionRate.rate}% (${dev.rejectionRate.rejections} of ${dev.rejectionRate.submissions} submissions)`,
        dev.rejectionRate.flagged,
      );

      this.renderMetricLine(doc, 'Escalated to PM', `${dev.escalations.count}`, dev.escalations.flagged);
      dev.escalations.items.forEach((item) => {
        doc.fontSize(8.5).fillColor(INK_SOFT).text(`   #${item.taskId} ${item.title} on ${item.escalatedAt}`);
      });

      this.renderMetricLine(
        doc,
        'Vague/Poor Resolution Notes',
        `${dev.resolutionQuality.count} of ${dev.resolutionQuality.checked} checked`,
        dev.resolutionQuality.flagged,
      );
      dev.resolutionQuality.items.slice(0, 8).forEach((item) => {
        doc
          .fontSize(8.5)
          .fillColor(INK_SOFT)
          .text(`   #${item.taskId} ${item.title} - "${item.resolutionExcerpt}"${item.reason ? ` (${item.reason})` : ''}`);
      });
      if (dev.resolutionQuality.items.length > 8) {
        doc.fontSize(8.5).fillColor(MUTED).text(`   ...and ${dev.resolutionQuality.items.length - 8} more.`);
      }

      this.hr(doc);
    });
  }

  private renderMetricLine(doc: PDFKit.PDFDocument, label: string, value: string, flagged: boolean) {
    doc.fontSize(10).font('Helvetica').fillColor(INK).text(`${label}: `, { continued: true });
    doc
      .font('Helvetica-Bold')
      .fillColor(flagged ? CRITICAL : INK)
      .text(value);
    doc.font('Helvetica');
  }

  // Compact - a compliant developer with zero data gets one line, not the
  // same section space a flagged developer's task lists take up. Directly
  // addresses the "the plain PDF gave a clean developer the same amount
  // of space as a flagged one" complaint.
  private renderCompliantList(doc: PDFKit.PDFDocument, report: NonComplianceReportResult) {
    const compliant = report.developers.filter((d) => !d.flagged);
    doc.moveDown(0.5);
    doc.fontSize(13).font('Helvetica-Bold').fillColor(INK).text('Compliant');
    doc.font('Helvetica');
    doc.fontSize(9).fillColor(INK_SOFT).text('No metric over threshold this period.');
    doc.moveDown(0.2);
    if (compliant.length === 0) {
      doc.fontSize(9).fillColor(MUTED).text('No developers found.');
      return;
    }
    compliant.forEach((dev) => {
      const rateText =
        dev.rejectionRate.submissions >= report.thresholds.rejectionRateMinSubmissions ? `${dev.rejectionRate.rate}% rate` : 'n/a rate';
      doc
        .fontSize(9.5)
        .fillColor(GOOD)
        .font('Helvetica-Bold')
        .text(`${devName(dev)}  `, { continued: true })
        .font('Helvetica')
        .fillColor(INK_SOFT)
        .text(`- ${dev.missedSla.count} missed, ${rateText}, ${dev.escalations.count} escalated`);
    });
  }

  private renderDeferredDimensions(doc: PDFKit.PDFDocument, report: NonComplianceReportResult) {
    if (report.deferredDimensions.length === 0) return;
    doc.moveDown(0.6);
    this.hr(doc);
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor(MUTED).font('Helvetica-Bold').text('Deferred Dimensions');
    doc.font('Helvetica');
    report.deferredDimensions.forEach((dim) => {
      doc.fontSize(9).fillColor(MUTED).text(`${dim.label}: ${dim.reason}`);
    });
  }

  private hr(doc: PDFKit.PDFDocument, thickness = 0.5) {
    const y = doc.y;
    doc
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.width - doc.page.margins.right, y)
      .lineWidth(thickness)
      .strokeColor('#e1d9cd')
      .stroke();
    doc.moveDown(0.2);
  }
}
