import { CheckCircle2, Clock, Send, XCircle, AlertTriangle, Undo2, PackageX } from 'lucide-react';
import { formatDate } from '../lib/formatDate';
import { stripHtmlForPreview } from '../lib/richText';
import { statusLabel } from '../lib/taskTableShared';
import Avatar from './ui/Avatar';
import styles from '../styles/reviewTimeline.module.css';
import { ScreenshotGallery } from './DefectScreenshots';
import { SubmissionChecklistSummary } from './SubmissionChecklist';

const OUTCOME = {
  pending: { icon: Clock, tone: styles.pending, text: 'Awaiting review' },
  approved: { icon: CheckCircle2, tone: styles.approved, text: 'Approved' },
  rejected: { icon: XCircle, tone: styles.rejected, text: 'Sent back' },
  escalated: { icon: AlertTriangle, tone: styles.escalated, text: statusLabel('Escalated') },
  // A QA decision a PM/Admin undid as a mistake - the decision is still
  // shown, followed by who reverted it and why.
  reverted: { icon: Undo2, tone: styles.reverted, text: 'Reverted' },
  // A PM/Admin pulled the task back from QA before QA decided it - not a
  // QA verdict; "Reviewed by" below is the PM, the comment their reason.
  withdrawn: { icon: Undo2, tone: styles.reverted, text: 'Sent back by PM before QA review' },
  // QA could not start testing (2026-10-27) - not a rejection; the reason
  // QA picked is added to the text below.
  not_ready: { icon: PackageX, tone: styles.rejected, text: 'Not ready for testing' },
};

const PM_OUTCOME_TEXT = { pending: 'Waiting for PM', approved: 'Sent to QA', rejected: 'Sent back by PM' };

// Review rounds (QA and Peer) as a vertical timeline, oldest first - the
// same data as the Review History table, read as a story. Outcome is
// always icon + text, never colour alone.
// `decisionScreenshots` (2026-10-18): screenshots QA attached to a
// decision - GET /tasks/:id/qa-review-attachments - shown under their round.
export default function ReviewTimeline({ reviews, decisionScreenshots = [] }) {
  const rounds = [...reviews].sort((a, b) => a.roundNumber - b.roundNumber);
  if (rounds.length === 0) {
    return <p className={styles.empty}>No review rounds yet. Rounds appear here once the task is submitted for review.</p>;
  }
  return (
    <ol className={styles.timeline}>
      {rounds.map((r) => {
        const base = OUTCOME[r.status] || { icon: Clock, tone: styles.pending, text: statusLabel(r.status) };
        // PM review gate rounds read as the PM's decision, not a QA verdict.
        const outcome = r.reviewType === 'pm' ? { ...base, text: PM_OUTCOME_TEXT[r.status] || base.text } : base;
        // For a reverted round, the "Reviewed by" line still shows what QA
        // actually decided (approved / sent back).
        const decided = r.status === 'reverted' ? OUTCOME[r.revertedDecision] || outcome : outcome;
        const reasonSuffix = r.notReadyReason ? `: ${r.notReadyReason}` : '';
        const comment = stripHtmlForPreview(r.qaComment);
        const resolution = stripHtmlForPreview(r.resolution);
        return (
          <li key={r.id ?? r.roundNumber} className={styles.item}>
            <span className={`${styles.marker} ${outcome.tone}`} aria-hidden="true">
              <outcome.icon size={16} />
            </span>
            <div className={styles.body}>
              <div className={styles.head}>
                <span className={styles.title}>
                  Round {r.roundNumber} · {r.reviewType === 'peer' ? 'Peer review' : r.reviewType === 'pm' ? 'PM review' : 'QA review'}
                </span>
                <span className={`${styles.outcome} ${outcome.tone}`}>
                  {r.status === 'reverted' && OUTCOME[r.revertedDecision]
                    ? `${OUTCOME[r.revertedDecision].text}${reasonSuffix}, then reverted`
                    : `${outcome.text}${r.status === 'not_ready' ? reasonSuffix : ''}`}
                </span>
              </div>
              <p className={styles.meta}>
                <Send size={12} aria-hidden="true" />
                Submitted by <Avatar name={r.submittedByFullName} size="xs" /> {r.submittedByFullName || 'Unknown'} · {formatDate(r.submittedAt)}
              </p>
              {resolution && <p className={styles.text}>{resolution}</p>}
              {/* Submission checklist (2026-10-27) - null before Stage 2 or with it off. */}
              <SubmissionChecklistSummary checklist={r.submissionChecklist} />
              <ScreenshotGallery
                id={`roundSelfTest-${r.id}`}
                label="Self-test screenshots:"
                files={decisionScreenshots.filter((a) => a.taskQaReviewId === r.id && a.uploadedByUserId === r.submittedByUserId)}
                filePath={(id) => `/tasks/qa-review-attachments/${id}`}
              />
              {r.status !== 'pending' && (
                <p className={styles.meta}>
                  <decided.icon size={12} aria-hidden="true" />
                  {r.status === 'withdrawn' ? 'Sent back by' : 'Reviewed by'} <Avatar name={r.reviewedByFullName} size="xs" /> {r.reviewedByFullName || 'Unknown'}
                  {r.reviewedAt ? ` · ${formatDate(r.reviewedAt)}` : ''}
                </p>
              )}
              {comment && <blockquote className={styles.comment}>{comment}</blockquote>}
              <ScreenshotGallery
                id={`roundScreenshots-${r.id}`}
                label="QA screenshots:"
                files={decisionScreenshots.filter((a) => a.taskQaReviewId === r.id && a.uploadedByUserId !== r.submittedByUserId)}
                filePath={(id) => `/tasks/qa-review-attachments/${id}`}
              />
              {r.status === 'reverted' && (
                <p className={styles.meta}>
                  <Undo2 size={12} aria-hidden="true" />
                  Reverted by <Avatar name={r.revertedByFullName} size="xs" /> {r.revertedByFullName || 'Unknown'}
                  {r.revertedAt ? ` · ${formatDate(r.revertedAt)}` : ''}
                  {r.revertReason ? `: ${r.revertReason}` : ''}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
