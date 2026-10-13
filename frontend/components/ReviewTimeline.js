import { CheckCircle2, Clock, Send, XCircle, AlertTriangle, Undo2 } from 'lucide-react';
import { formatDate } from '../lib/formatDate';
import { stripHtmlForPreview } from '../lib/richText';
import { statusLabel } from '../lib/taskTableShared';
import Avatar from './ui/Avatar';
import styles from '../styles/reviewTimeline.module.css';

const OUTCOME = {
  pending: { icon: Clock, tone: styles.pending, text: 'Awaiting review' },
  approved: { icon: CheckCircle2, tone: styles.approved, text: 'Approved' },
  rejected: { icon: XCircle, tone: styles.rejected, text: 'Sent back' },
  escalated: { icon: AlertTriangle, tone: styles.escalated, text: statusLabel('Escalated') },
  // A QA decision a PM/Admin undid as a mistake - the decision is still
  // shown, followed by who reverted it and why.
  reverted: { icon: Undo2, tone: styles.reverted, text: 'Reverted' },
};

// Review rounds (QA and Peer) as a vertical timeline, oldest first - the
// same data as the Review History table, read as a story. Outcome is
// always icon + text, never colour alone.
export default function ReviewTimeline({ reviews }) {
  const rounds = [...reviews].sort((a, b) => a.roundNumber - b.roundNumber);
  if (rounds.length === 0) {
    return <p className={styles.empty}>No review rounds yet. Rounds appear here once the task is submitted for review.</p>;
  }
  return (
    <ol className={styles.timeline}>
      {rounds.map((r) => {
        const outcome = OUTCOME[r.status] || { icon: Clock, tone: styles.pending, text: statusLabel(r.status) };
        // For a reverted round, the "Reviewed by" line still shows what QA
        // actually decided (approved / sent back).
        const decided = r.status === 'reverted' ? OUTCOME[r.revertedDecision] || outcome : outcome;
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
                  Round {r.roundNumber} · {r.reviewType === 'peer' ? 'Peer review' : 'QA review'}
                </span>
                <span className={`${styles.outcome} ${outcome.tone}`}>
                  {r.status === 'reverted' && OUTCOME[r.revertedDecision] ? `${OUTCOME[r.revertedDecision].text}, then reverted` : outcome.text}
                </span>
              </div>
              <p className={styles.meta}>
                <Send size={12} aria-hidden="true" />
                Submitted by <Avatar name={r.submittedByFullName} size="xs" /> {r.submittedByFullName || 'Unknown'} · {formatDate(r.submittedAt)}
              </p>
              {resolution && <p className={styles.text}>{resolution}</p>}
              {r.status !== 'pending' && (
                <p className={styles.meta}>
                  <decided.icon size={12} aria-hidden="true" />
                  Reviewed by <Avatar name={r.reviewedByFullName} size="xs" /> {r.reviewedByFullName || 'Unknown'}
                  {r.reviewedAt ? ` · ${formatDate(r.reviewedAt)}` : ''}
                </p>
              )}
              {comment && <blockquote className={styles.comment}>{comment}</blockquote>}
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
