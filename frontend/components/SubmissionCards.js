import { Image, GitPullRequest, Package, FileText, Workflow, FileBarChart, Video, Paperclip, Send, Undo2 } from 'lucide-react';
import { formatDate } from '../lib/formatDate';
import { groupSubmissions, roundOutcome, labelArtifacts } from '../lib/submissions';
import Avatar from './ui/Avatar';
import Badge from './ui/Badge';
import RichTextDisplay from './ui/RichTextDisplay';
import CollapsibleSection from './ui/CollapsibleSection';
import { ScreenshotGallery } from './DefectScreenshots';
import { SubmissionChecklistSummary } from './SubmissionChecklist';
import styles from '../styles/submissionCards.module.css';

// Review history, one card per submission (task page, TASK_PAGE_V2,
// 2026-11-04): the latest submission first and open, older ones collapsed
// with a count. Replaces the timeline + "All rounds" table, which showed
// the same submission text twice. Display only.

const ARTIFACT_ICONS = {
  'Screenshot': Image,
  'Pull Request Link': GitPullRequest,
  'APK Build': Package,
  'Technical Documentation': FileText,
  'Build Pipeline Link': Workflow,
  'Deployment Report': FileBarChart,
  'Demo Video': Video,
};

const ROUND_LABEL = { peer: 'Peer review', pm: 'PM review', qa: 'QA review' };

function ArtifactLinks({ artifacts, label }) {
  if (!artifacts || artifacts.length === 0) return null;
  return (
    <div className={styles.artifacts}>
      <span className={styles.label}>{label}</span>
      <ul className={styles.artifactList}>
        {labelArtifacts(artifacts).map((a) => {
          const Icon = ARTIFACT_ICONS[a.type] || Paperclip;
          return (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noreferrer" className={styles.artifactLink}>
                <Icon size={14} aria-hidden="true" />
                {a.label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Decision({ round, screenshots }) {
  const outcome = roundOutcome(round);
  return (
    <li className={styles.decision}>
      <div className={styles.decisionHead}>
        <span className={styles.decisionType}>{ROUND_LABEL[round.reviewType] || 'Review'}</span>
        <Badge tone={outcome.tone}>{outcome.text}</Badge>
      </div>
      {round.status === 'pending' ? (
        round.reviewType === 'peer' && round.reviewerFullName && (
          <p className={styles.meta}>Waiting for {round.reviewerFullName}</p>
        )
      ) : (
        <p className={styles.meta}>
          {round.status === 'withdrawn' ? 'Sent back by' : 'By'} <Avatar name={round.reviewedByFullName} size="xs" /> {round.reviewedByFullName || 'Unknown'}
          {round.reviewedAt ? ` · ${formatDate(round.reviewedAt)}` : ''}
        </p>
      )}
      {round.qaComment && (
        <div className={styles.comment}>
          <RichTextDisplay value={round.qaComment} />
        </div>
      )}
      <ArtifactLinks artifacts={round.qaArtifacts} label="QA evidence:" />
      <ScreenshotGallery
        id={`roundScreenshots-${round.id}`}
        label="QA screenshots:"
        files={screenshots.filter((a) => a.taskQaReviewId === round.id && a.uploadedByUserId !== round.submittedByUserId)}
        filePath={(id) => `/tasks/qa-review-attachments/${id}`}
      />
      {round.status === 'reverted' && (
        <p className={styles.meta}>
          <Undo2 size={12} aria-hidden="true" />
          Reverted by {round.revertedByFullName || 'Unknown'}
          {round.revertedAt ? ` · ${formatDate(round.revertedAt)}` : ''}
          {round.revertReason ? `: ${round.revertReason}` : ''}
        </p>
      )}
    </li>
  );
}

function SubmissionCard({ submission, latest, screenshots }) {
  const s = submission;
  return (
    <article className={`${styles.card} ${latest ? styles.latest : ''}`} id={`submission-${s.number}`} aria-labelledby={`submission-${s.number}-title`}>
      <header className={styles.head}>
        <h3 className={styles.title} id={`submission-${s.number}-title`}>
          Submission {s.number}
          {latest && <span className={styles.latestTag}>Latest</span>}
        </h3>
        <Badge tone={s.outcome.tone}>{s.outcome.text}</Badge>
      </header>
      <p className={styles.meta}>
        <Send size={12} aria-hidden="true" />
        <Avatar name={s.submittedByFullName} size="xs" /> {s.submittedByFullName || 'Unknown'} · {formatDate(s.submittedAt)}
      </p>
      {s.resolution && (
        <div className={styles.note}>
          <span className={styles.label}>Resolution note</span>
          <RichTextDisplay value={s.resolution} />
        </div>
      )}
      <ArtifactLinks artifacts={s.artifacts} label="Artifacts:" />
      <SubmissionChecklistSummary checklist={s.submissionChecklist} />
      <ScreenshotGallery
        id={`submissionSelfTest-${s.number}`}
        label="Self-test screenshots:"
        files={screenshots.filter((a) => s.rounds.some((r) => r.id === a.taskQaReviewId) && a.uploadedByUserId === s.submittedByUserId)}
        filePath={(id) => `/tasks/qa-review-attachments/${id}`}
      />
      <ol className={styles.decisions} aria-label={`Reviews of submission ${s.number}`}>
        {[...s.rounds].reverse().map((r) => (
          <Decision key={r.id ?? r.roundNumber} round={r} screenshots={screenshots} />
        ))}
      </ol>
    </article>
  );
}

export default function SubmissionCards({ reviews, decisionScreenshots = [], userId }) {
  const submissions = groupSubmissions(reviews).reverse();
  if (submissions.length === 0) {
    return <p className={styles.empty}>No submissions yet. They appear here once the task is submitted for review.</p>;
  }
  const [latest, ...older] = submissions;
  return (
    <div>
      <SubmissionCard submission={latest} latest screenshots={decisionScreenshots} />
      {older.length > 0 && (
        <CollapsibleSection
          count={older.length}
          label={older.length === 1 ? 'older submission' : 'older submissions'}
          storageKey={`taskSection:olderSubmissions:${userId}`}
        >
          {older.map((s) => (
            <SubmissionCard key={s.key} submission={s} screenshots={decisionScreenshots} />
          ))}
        </CollapsibleSection>
      )}
    </div>
  );
}
