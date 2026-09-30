import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Release } from './release.entity';
import { ReleaseItem } from './release-item.entity';

// Same ink colors as PdfNonComplianceReportService - raw hex for pdfkit,
// kept in sync by hand.
const INK = '#362b23';
const INK_SOFT = '#6b5f55';
const MUTED = '#8a7d72';
const RULE = '#e1d9cd';

// Resolutions are stored as sanitizeRichText()'d HTML - pdfkit only
// draws plain text, so keep paragraph/list breaks and drop the tags.
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

// One PDF per Release: header (app, version, project, date), the
// release-wide Artifacts field, then one block per ticket with its
// snapshotted Resolution. Used for both the download and the email
// attachment so the two are always identical.
@Injectable()
export class PdfReleaseService {
  async buildRelease(release: Release & { items: ReleaseItem[] }): Promise<Buffer> {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    doc.fontSize(20).font('Helvetica-Bold').fillColor(INK).text(`${release.appName} ${release.version}`);
    doc.font('Helvetica').fontSize(10).fillColor(INK_SOFT);
    doc.text(`Project: ${release.projectName}`);
    doc.text(`Release Date: ${release.releaseDate}`);
    doc.text(`Tickets: ${release.items.length}`);
    doc.moveDown(0.6);
    this.hr(doc);

    doc.moveDown(0.4);
    doc.fontSize(12).font('Helvetica-Bold').fillColor(INK).text('Artifacts');
    doc.font('Helvetica').fontSize(10);
    if (release.artifacts) {
      doc.fillColor(INK).text(release.artifacts);
    } else {
      doc.fillColor(MUTED).text('None recorded.');
    }
    doc.moveDown(0.6);
    this.hr(doc);

    doc.moveDown(0.4);
    doc.fontSize(12).font('Helvetica-Bold').fillColor(INK).text('Tickets');
    doc.font('Helvetica');
    doc.moveDown(0.3);
    if (release.items.length === 0) {
      doc.fontSize(10).fillColor(MUTED).text('No tickets in this release.');
    }
    release.items.forEach((item, index) => {
      if (index > 0) doc.moveDown(0.5);
      doc.fontSize(10.5).font('Helvetica-Bold').fillColor(INK).text(`#${item.taskId}  ${item.taskTitle}`);
      doc.font('Helvetica').fontSize(9.5);
      const resolution = item.resolution ? htmlToText(item.resolution) : '';
      if (resolution) {
        doc.fillColor(INK_SOFT).text(resolution, { indent: 12 });
      } else {
        doc.fillColor(MUTED).text('No Resolution recorded.', { indent: 12 });
      }
      doc.moveDown(0.3);
      this.hr(doc);
    });

    doc.end();
    return done;
  }

  private hr(doc: PDFKit.PDFDocument) {
    const y = doc.y;
    doc
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.width - doc.page.margins.right, y)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.moveDown(0.2);
  }
}
