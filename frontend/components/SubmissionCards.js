import { useEffect, useState } from 'react';
import { Image, GitPullRequest, Package, FileText, Workflow, FileBarChart, Video, PenTool, MousePointerClick, Ruler, Paperclip, Send, Undo2, ChevronDown } from 'lucide-react';
import { formatDate } from '../lib/formatDate';
import { groupSubmissions, roundOutcome, labelArtifacts } from '../lib/submissions';
import { renamedArtifactLabels, useArtifactMenu } from '../lib/artifactTypes';
import Avatar from './ui/Avatar';
import Badge from './ui/Badge';
import RichTextDisplay from './ui/RichTextDisplay';
import { REVEAL_EVENT } from '../lib/useHashTarget';
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
  'Design file': PenTool,
  'Prototype': MousePointerClick,
  'Design spec': Ruler,
};

const ROUND_LABEL = { peer: 'Peer review', pm: 'PM review', qa: 'QA review' };

// "Latest work" (2026-11-05): the newest submission's main links (see
// latestWork() in lib/artifactTypes.js), shown above the submit form so
// nobody has to scroll to Review history for them.
export function LatestWork({ work, isDesign }) {
  if (!work) return null;
  return (
    <section className={`${styles.card} ${styles.latestWork}`} aria-labelledby="latest-work-title">
      <h2 className={styles.title} id="latest-work-title">
        {isDesign ? 'Latest prototype and handover' : 'Latest build and pull request'}
      </h2>
      <p className={styles.meta}>
        From submission {work.number} · {formatDate(work.submittedAt)} ·{' '}
        <a href={`#submission-${work.number}`}>see it in Review history</a>
      </p>
      <ArtifactLinks artifacts={work.artifacts} label="Links:" />
    </section>
  );
}

// qa: QA's own evidence (a separate list of types) - never renamed here.
function ArtifactLinks({ artifacts, label, qa = false }) {
  const menu = useArtifactMenu();
  if (!artifacts || artifacts.length === 0) return null;
  return (
    <div className={styles.artifacts}>
      <span className={styles.label}>{label}</span>
      <ul className={styles.artifactList}>
        {labelArtifacts(artifacts, qa ? {} : renamedArtifactLabels(menu)).map((a) => {
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
        {/* A pending round is the newest one; its status is already the card's badge. */}
        {round.status !== 'pending' && <Badge tone={outcome.tone}>{outcome.text}</Badge>}
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
      <ArtifactLinks artifacts={round.qaArtifacts} label="QA evidence:" qa />
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

// Earlier submissions start collapsed - just their heading, outcome and
// date - and open on click (2026-11-05). The latest is always open. Not
// remembered between visits, so every task opens on its latest round.
function SubmissionCard({ submission, latest, screenshots }) {
  const s = submission;
  const [open, setOpen] = useState(!!latest);
  const bodyId = `submission-${s.number}-body`;
  useEffect(() => {
    if (latest) return undefined;
    // A deep link to this submission (#submission-N) opens it.
    const onReveal = (e) => {
      if (e.detail?.id === `submission-${s.number}`) setOpen(true);
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal);
  }, [latest, s.number]);
  const heading = (
    <>
      Submission {s.number}
      {latest && <span className={styles.latestTag}>Latest</span>}
      {!latest && !open && <span className={styles.collapsedDate}>{formatDate(s.submittedAt)}</span>}
    </>
  );
  return (
    <article className={`${styles.card} ${latest ? styles.latest : ''} ${open ? '' : styles.collapsed}`} id={`submission-${s.number}`} aria-labelledby={`submission-${s.number}-title`}>
      <header className={styles.head}>
        <h3 className={styles.title} id={`submission-${s.number}-title`}>
          {latest ? (
            heading
          ) : (
            <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
              <ChevronDown size={16} aria-hidden="true" className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
              {heading}
            </button>
          )}
        </h3>
        <Badge tone={s.outcome.tone}>{s.outcome.text}</Badge>
      </header>
      <div id={bodyId} hidden={!open}>
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
      </div>
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
        <p className={styles.olderHint}>
          {older.length === 1 ? 'An earlier submission' : `${older.length} earlier submissions`} - click one to open it.
        </p>
      )}
      {older.map((s) => (
        <SubmissionCard key={s.key} submission={s} screenshots={decisionScreenshots} />
      ))}
    </div>
  );
}
