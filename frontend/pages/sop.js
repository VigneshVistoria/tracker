import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AlertTriangle, Info, Eye, XCircle, CheckCircle2 } from 'lucide-react';
import AppShell from '../components/AppShell';
import styles from '../styles/issues.module.css';
import g from '../styles/sop.module.css';

// Developer user guide - the in-app version of SOP-DEV-001
// (SOP-Developer-Workflow.docx at the repo root). Keep the two in sync
// when the task workflow changes.
//
// Admin/Executive/Program Manager only for now, as a review preview
// (confirmed with the user 2026-09-25; Executive added the same day). To release it to developers, add
// ...DEVELOPER_EQUIVALENT_ROLES here and to the matching nav entry in
// AppShell.js, and drop the preview banner below. Developers have no
// sidebar (AppShell hideSidebar), so they'll also need a link from their
// Dashboard.
const VIEW_ROLES = ['admin', 'executive', 'program_manager'];

const SECTIONS = [
  { id: 'purpose', label: '1. Purpose and scope' },
  { id: 'roles', label: '2. Who does what' },
  { id: 'navigation', label: '3. Getting around' },
  { id: 'statuses', label: '4. Task statuses' },
  { id: 'daily', label: '5. Start of day' },
  { id: 'new-task', label: '6. Picking up a task' },
  { id: 'dependencies', label: '7. Dependency tickets' },
  { id: 'submit', label: '8. Submitting work' },
  { id: 'rejections', label: '9. Rejections, defects, escalations' },
  { id: 'peer-reviewer', label: '10. Acting as peer reviewer' },
  { id: 'measured', label: '11. How you are measured' },
  { id: 'resolution-notes', label: '12. Writing resolution notes' },
  { id: 'do-dont', label: '13. Do and don’t' },
  { id: 'checklist', label: '14. Pre-submission checklist' },
];

const ROLES = [
  ['Developer / Designer / DevOps', 'Sets Estimated Hours and Due Date, does the work, raises dependency tickets when blocked, submits for QA or peer review with evidence, fixes rejections, resolves dependency tickets routed to them, performs peer reviews when assigned.'],
  ['QA', 'Reviews submissions: approves (Pass), rejects (Failed), raises defects, or escalates unclear submissions to the PM.'],
  ['Peer Reviewer', 'Another developer picked by the submitter. Approves or rejects peer review rounds.'],
  ['Program Manager', 'Creates and assigns tasks; owns Title, Description, Priority and Project/Module/Phase; changes locked estimates and due dates; handles escalations; enables peer review; puts tasks on Hold or Closes them.'],
  ['Admin', 'Creates user accounts; can Hold/Close/Reopen tasks and enable peer review.'],
];

const TILES = [
  ['My Tasks', 'All tasks assigned to you, sorted by priority', 'Work top-down: Immediate, then High, then Medium'],
  ['Rejected', 'Tasks QA or a peer reviewer sent back (status Failed)', 'Treat as top priority; fix and resubmit'],
  ['Inbound', 'Dependency tickets you filed against another developer that are still open', 'Follow up with the owner'],
  ['Outbound', 'Dependency tickets another developer filed against you that are still open', 'Resolve them promptly; they block someone else'],
  ['Overdue', 'Your tasks past Due Date, plus Outbound tickets whose parent task is overdue', 'Clear these first; they hurt your KPI'],
  ['Defects', 'Defects QA raised directly against you', 'Work them like any task'],
];

const PAGES = [
  ['My Tasks', '/tasks/mine', 'See all your tasks in one list'],
  ['Peer Review queue', '/tasks/peer-review', 'See peer reviews assigned to you'],
  ['Dependency Clearance', '/dependency-clearance', 'Resolve dependency tickets routed to you'],
  ['KPI Dashboard', '/kpi', 'See your own KPI scores'],
];

const STATUSES = [
  ['Development', 'Assigned to you, not yet submitted', 'You'],
  ['Feedback', 'First submission waiting for QA', 'QA'],
  ['Re-Feedback', 'Resubmission after a rejection, waiting for QA', 'QA'],
  ['Peer Review', 'First submission waiting for your peer reviewer', 'Peer reviewer'],
  ['Re-Peer-Review', 'Peer resubmission after a rejection', 'Peer reviewer'],
  ['Failed', 'Rejected by QA or peer reviewer', 'You'],
  ['Escalated', 'QA sent the round to the PM instead of deciding', 'PM'],
  ['Pass', 'Approved; task complete', 'Nobody'],
  ['Junk', 'PM closed an escalated task as not a real issue; does not count against you', 'Nobody'],
  ['Hold', 'Paused by PM/Admin', 'PM/Admin (to release)'],
  ['Closed', 'Closed by PM/Admin', 'PM/Admin (to reopen)'],
];

const KPI_FACTORS = [
  ['Hours exceeded', 'Penalty', 'Actual Hours above Estimated Hours. Estimate honestly.'],
  ['Overdue', 'Penalty', 'Open tasks past their Due Date (excused if you filed an open dependency ticket on the task).'],
  ['Target miss', 'Penalty', 'Tasks completed after their Due Date (same excuse applies).'],
  ['Excessive rejections', 'Heavy penalty', 'More than 2 QA/peer rejections in the period.'],
  ['Outbound dependency overdue', 'Penalty', 'Tickets filed against you, still open past the parent task’s due date.'],
  ['Completion', 'Bonus (capped)', 'Tasks completed in the period.'],
];

const NON_COMPLIANCE_RULES = [
  ['Missed SLA', '3 or more items across: tasks completed after Due Date, open tasks past Due Date, and tasks whose QA Review Due Date has passed while still in review'],
  ['Rejection rate', 'Above 20%, with at least 3 submissions (QA and peer combined)'],
  ['Escalations', '1 or more rounds escalated to a PM'],
  ['Vague resolution notes', '3 or more resolution notes judged too vague'],
];

const NOTE_EXAMPLES = [
  ['Fixed the login issue.', 'Login failed for emails with uppercase letters. Lower-cased the email in auth.service before lookup. Tested with Test@x.com on staging.'],
  ['Done as discussed.', 'Added the Priority column to Team Tasks, sorted Immediate > High > Medium. Verified in light and dark themes.'],
  ['Resolved.', 'Upgraded the build image to Node 20; pipeline #412 green. Deployment report attached.'],
];

const DO_DONT = [
  ['Set realistic Estimated Hours and Due Date before starting', 'Guess estimates; you cannot change them later'],
  ['Raise a dependency ticket as soon as you are blocked', 'Wait silently on another developer'],
  ['Attach real, working evidence links', 'Submit with placeholder or broken URLs'],
  ['Write specific resolution notes', 'Write “done” or “fixed”'],
  ['Test before submitting', 'Use QA to find your bugs'],
  ['Fix linked defects before resubmitting the parent', 'Try to resubmit a parent with open defects'],
  ['Ask the PM before touching a Held or Closed task', 'Submit a Held or Closed task'],
  ['Enter your true Actual Hours', 'Adjust Actual Hours to match the estimate'],
];

const CHECKLIST = [
  'Estimated Hours and Due Date are set',
  'No open dependency tickets on the task',
  'No open linked defects',
  'Task is not Escalated, on Hold or Closed',
  'Work tested end to end',
  'Resolution states cause, change and verification',
  'At least one artifact, each link opens correctly',
  'Actual Hours entered truthfully',
];

function Table({ headers, rows, emphasizeFirstColumn = true }) {
  return (
    <div className={g.tableWrap}>
      <table className={`${g.table} ${emphasizeFirstColumn ? g.tableKeyed : ''}`}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) => (
                <td key={i}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Callout({ kind = 'note', label, children }) {
  const Icon = kind === 'important' ? AlertTriangle : Info;
  return (
    <div className={`${g.callout} ${kind === 'important' ? g.calloutImportant : g.calloutNote}`}>
      <Icon size={16} className={g.calloutIcon} aria-hidden="true" />
      <div>
        <span className={g.calloutLabel}>{label}</span> {children}
      </div>
    </div>
  );
}

function Section({ id, number, title, children }) {
  return (
    <section id={id} className={g.section} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={g.sectionTitle}>
        <span className={g.sectionNumber}>{number}.</span> {title}
      </h2>
      {children}
    </section>
  );
}

function Path({ children }) {
  return <code className={g.path}>{children}</code>;
}

export default function TrackerSopPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.replace('/');
      return;
    }
    const parsed = JSON.parse(storedUser);
    if (!VIEW_ROLES.includes(parsed.role)) {
      router.replace('/dashboard');
      return;
    }
    setUser(parsed);
  }, [router]);

  if (!user) return null;

  return (
    <AppShell>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Tracker SOP</h1>
          <p className={styles.pageSubtitle}>
            How to use Tracker as a Developer, Designer or DevOps user. Based on SOP-DEV-001.
          </p>
        </div>
      </div>

      <div className={g.previewBanner} role="note">
        <Eye size={16} className={g.calloutIcon} aria-hidden="true" />
        <div>
          <strong>Preview.</strong> Only Admins, Executives and Program Managers can see this page right now. Developers
          will get access once it has been reviewed.
        </div>
      </div>

      <div className={g.layout}>
        <nav className={g.toc} aria-label="Guide contents">
          <p className={g.tocTitle}>Contents</p>
          <ol className={g.tocList}>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={g.tocLink}>{s.label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div>
          <Section id="purpose" number={1} title="Purpose and scope">
            <p>
              This guide explains how developers receive, work, submit and close tasks in Tracker, so that every
              task moves through QA with accurate estimates, clear resolution notes and verifiable evidence.
              Following it keeps your KPI score healthy and keeps you off the Non-Compliance report.
            </p>
            <p>
              It applies to every user with the <strong>Developer</strong>, <strong>Designer</strong> or{' '}
              <strong>DevOps</strong> role. The three roles behave identically in Tracker; wherever this guide says
              “developer”, it means all three.
            </p>
            <p>
              It covers tasks, defects, dependency tickets, QA submission and peer review. It does not cover the
              Issues module or the older Dependencies page.
            </p>
          </Section>

          <Section id="roles" number={2} title="Who does what">
            <Table headers={['Role', 'Responsibility in this workflow']} rows={ROLES} />
          </Section>

          <Section id="navigation" number={3} title="Getting around">
            <p>
              An Admin creates your account (you cannot self-register). Sign in at{' '}
              <Path>tracker.vistoriasystems.com</Path>. You land on the <strong>Dashboard</strong>.
            </p>
            <h3 className={g.subTitle}>Dashboard tiles</h3>
            <p>
              Tiles only appear when they have something in them. Click a tile to expand it; click a row to open the
              task in a new tab.
            </p>
            <Table headers={['Tile', 'What it contains', 'What you should do']} rows={TILES} />
            <h3 className={g.subTitle}>Other pages</h3>
            <p>These pages work for your role but are not linked from the Dashboard. Bookmark them:</p>
            <Table
              headers={['Page', 'Address', 'Use it to']}
              rows={PAGES.map(([name, path, use]) => [name, <Path key={path}>{path}</Path>, use])}
            />
          </Section>

          <Section id="statuses" number={4} title="Task statuses">
            <p>
              You never set status by hand. It changes automatically when you submit and when QA, a peer reviewer
              or a PM acts.
            </p>
            <Table headers={['Status', 'Meaning', 'Who acts next']} rows={STATUSES} />
            <p>Older tasks may show legacy statuses such as “Released - No Showstoppers”. You cannot trigger these.</p>
          </Section>

          <Section id="daily" number={5} title="Start of day">
            <ol className={g.steps}>
              <li>
                Open the Dashboard. Clear <strong>Rejected</strong> and <strong>Overdue</strong> first, then{' '}
                <strong>Outbound</strong> dependency tickets, then <strong>My Tasks</strong> in priority order.
              </li>
              <li>
                Open <Path>/tasks/peer-review</Path> and complete any peer reviews assigned to you.
              </li>
            </ol>
          </Section>

          <Section id="new-task" number={6} title="Picking up a task">
            <ol className={g.steps}>
              <li>
                Open the task and read the Title, Description and Priority. These are set by the PM and are
                read-only for you. If anything is unclear, ask the PM before starting.
              </li>
              <li>
                Enter <strong>Estimated Hours</strong>. Make it realistic: it is compared against your Actual Hours
                for KPI.
              </li>
              <li>
                Enter <strong>Due Date</strong>. Make it achievable: late completion and open-past-due tasks are
                both measured.
              </li>
            </ol>
            <Callout kind="important" label="Important:">
              Estimated Hours and Due Date can each be entered <strong>once</strong>. After you save them they lock,
              and only a Program Manager can change them. Double-check before saving. You cannot submit a task until
              both are set.
            </Callout>
          </Section>

          <Section id="dependencies" number={7} title="Dependency tickets">
            <h3 className={g.subTitle}>When you are blocked by another developer</h3>
            <ol className={g.steps}>
              <li>
                On your task, click <strong>Create Dependency Ticket</strong>.
              </li>
              <li>Describe exactly what you need, and pick the developer who owns that work.</li>
              <li>
                The ticket appears in your <strong>Inbound</strong> tile and in their <strong>Outbound</strong> tile
                until they resolve it.
              </li>
              <li>
                Follow up until it is resolved. You can only file tickets on tasks assigned to you, and only against
                Developer, Designer or DevOps users.
              </li>
            </ol>
            <Callout label="Note:">
              While any dependency ticket on the task is open, you <strong>cannot submit it to QA</strong>. An open
              ticket you filed also protects you: the task is not counted as overdue or as a missed target in your
              KPI.
            </Callout>
            <h3 className={g.subTitle}>When a ticket is filed against you</h3>
            <ol className={g.steps}>
              <li>
                Find it in your <strong>Outbound</strong> tile or at <Path>/dependency-clearance</Path>.
              </li>
              <li>
                Deliver what was asked, then click <strong>Mark Resolved</strong>.
              </li>
            </ol>
            <p>Outbound tickets that stay open past the parent task’s due date count against your KPI.</p>
          </Section>

          <Section id="submit" number={8} title="Submitting work">
            <h3 className={g.subTitle}>Submit for QA</h3>
            <p>
              Use this when the task shows <strong>Submit for QA Testing</strong>. Before submitting, confirm:
            </p>
            <ul className={g.bullets}>
              <li>Estimated Hours and Due Date are set.</li>
              <li>No open dependency tickets on the task.</li>
              <li>No open linked defects (see section 9).</li>
              <li>The task is not Escalated, on Hold or Closed. Check with the PM before touching Held or Closed tasks.</li>
            </ul>
            <p>Then:</p>
            <ol className={g.steps}>
              <li>
                <strong>Resolution</strong>: describe what you did, following section 12. This is the note QA reads
                first.
              </li>
              <li>
                <strong>Artifacts</strong>: add at least one piece of evidence, each with a Type and a URL. Each type
                can be used once per submission. Types: Screenshot, Pull Request Link, APK Build, Technical
                Documentation, Build Pipeline Link, Deployment Report, Demo Video.
              </li>
              <li>
                <strong>Actual Hours Spent</strong>: enter the real time taken.
              </li>
              <li>
                Click <strong>Mark Ready for Feedback</strong>. The task moves to Feedback (first round) or
                Re-Feedback (resubmission).
              </li>
            </ol>
            <p>
              Only one round can be pending at a time. Each submission sets a <strong>QA Review Due Date</strong> 5
              business days (Monday to Friday) later. It is shown on the task page and highlighted red if it passes.
            </p>
            <h3 className={g.subTitle}>Submit for Peer Review</h3>
            <p>
              If the PM has enabled peer review on a task, the page shows <strong>Submit for Peer Review</strong>{' '}
              instead.
            </p>
            <ol className={g.steps}>
              <li>Fill in Resolution, Artifacts and Actual Hours exactly as for QA.</li>
              <li>
                Pick a <strong>Peer Reviewer</strong>: another Developer, Designer or DevOps user (not yourself).
              </li>
              <li>
                Submit. The task moves to Peer Review (or Re-Peer-Review on resubmission) and a 5-business-day review
                due date is set.
              </li>
            </ol>
          </Section>

          <Section id="rejections" number={9} title="Rejections, defects and escalations">
            <h3 className={g.subTitle}>Handling a rejection</h3>
            <ol className={g.steps}>
              <li>
                Open the task from the <strong>Rejected</strong> tile.
              </li>
              <li>
                Scroll to <strong>QA Review History</strong>. Rejected rounds are highlighted; read the reviewer’s
                comment and any artifacts they attached.
              </li>
              <li>Fix the problem. If anything in the comment is unclear, ask the reviewer before resubmitting.</li>
              <li>Resubmit (section 8). This starts a new round.</li>
            </ol>
            <Callout kind="important" label="Important:">
              Every rejection, from QA or a peer reviewer, is counted. More than 2 rejections in a KPI period
              triggers a heavy penalty, and a rejection rate above 20% puts you on the Non-Compliance report. Test
              your work before submitting.
            </Callout>
            <h3 className={g.subTitle}>Defects</h3>
            <p>
              QA can raise a defect directly against you. It appears in the <strong>Defects</strong> tile, starts in
              Development with no Estimated Hours or Due Date, and works exactly like a task: set both fields, fix,
              and submit. Your submission goes back to the QA person who raised the defect.
            </p>
            <p>
              When QA rejects a task, they may create <strong>one or more linked defects</strong> from that
              rejection. The parent task <strong>cannot be resubmitted to QA</strong> until every linked defect is
              Pass or Junk. Work the linked defects first, then resubmit the parent.
            </p>
            <h3 className={g.subTitle}>Escalation</h3>
            <p>
              If QA finds your resolution unclear or unrelated to the task, they can escalate the round to the PM.
              The task becomes <strong>Escalated</strong>, a notice appears on the task page, and you cannot
              resubmit. The PM will either reassign it (back to Development; your Estimated Hours and Due Date are
              kept) or close it as <strong>Junk</strong>. Junk does not count against you, but an escalation that is
              reassigned does. Clear resolution notes prevent escalations.
            </p>
          </Section>

          <Section id="peer-reviewer" number={10} title="Acting as a peer reviewer">
            <ol className={g.steps}>
              <li>
                Open <Path>/tasks/peer-review</Path> to see rounds assigned to you.
              </li>
              <li>Open the task, read the resolution, and check every artifact.</li>
              <li>
                <strong>Approve</strong> (comment and artifacts optional) to move the task to Pass, or{' '}
                <strong>Reject</strong> with a comment (required) explaining what must change.
              </li>
              <li>Complete the review before its QA Review Due Date.</li>
            </ol>
          </Section>

          <Section id="measured" number={11} title="How you are measured">
            <h3 className={g.subTitle}>KPI score</h3>
            <p>
              Your KPI score (visible to you at <Path>/kpi</Path>) is calculated per project for daily, weekly and
              monthly periods. It starts at 100:
            </p>
            <Table headers={['Factor', 'Effect', 'How to protect your score']} rows={KPI_FACTORS} />
            <p>
              Ratings: <strong>Good</strong> 80 and above, <strong>Average</strong> 50 to 79, <strong>Poor</strong>{' '}
              below 50. Hold, Closed and Junk tasks are excluded.
            </p>
            <h3 className={g.subTitle}>Non-Compliance report</h3>
            <p>
              Program Managers, Executives and Admins review a Non-Compliance report. You are flagged if{' '}
              <strong>any one</strong> of these is true in the reporting period:
            </p>
            <Table headers={['Rule', 'Flagged when']} rows={NON_COMPLIANCE_RULES} />
            <Callout label="Note:">
              Tasks on Hold still count toward “open past Due Date” on this report. If a task is put on Hold, ask the
              PM to adjust its Due Date.
            </Callout>
          </Section>

          <Section id="resolution-notes" number={12} title="Writing resolution notes">
            <p>
              Every resolution note is automatically checked for vagueness. Notes like “fixed it”, “done”,
              “resolved” or “completed as discussed” are flagged. A short note is fine if it names the specific
              cause, file or change.
            </p>
            <p>A good note answers:</p>
            <ul className={g.bullets}>
              <li>
                <strong>What was wrong</strong>: the root cause.
              </li>
              <li>
                <strong>What you changed</strong>: files, components, configuration or screens.
              </li>
              <li>
                <strong>How you verified it</strong>: what you tested and where.
              </li>
            </ul>
            <div className={g.exampleGrid}>
              <div className={`${g.exampleCard} ${g.exampleBad}`}>
                <p className={g.exampleHeading}>
                  <XCircle size={16} aria-hidden="true" /> Vague (flagged)
                </p>
                <ul className={g.exampleList}>
                  {NOTE_EXAMPLES.map(([bad]) => (
                    <li key={bad}>{bad}</li>
                  ))}
                </ul>
              </div>
              <div className={`${g.exampleCard} ${g.exampleGood}`}>
                <p className={g.exampleHeading}>
                  <CheckCircle2 size={16} aria-hidden="true" /> Specific (acceptable)
                </p>
                <ul className={g.exampleList}>
                  {NOTE_EXAMPLES.map(([bad, good]) => (
                    <li key={bad}>{good}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>

          <Section id="do-dont" number={13} title="Do and don’t">
            <Table headers={['Do', 'Don’t']} rows={DO_DONT} emphasizeFirstColumn={false} />
          </Section>

          <Section id="checklist" number={14} title="Pre-submission checklist">
            <p>Tick these off before every submission. Ticks are not saved; they are just for you.</p>
            <ul className={g.checklist}>
              {CHECKLIST.map((item) => (
                <li key={item}>
                  <label className={g.checkItem}>
                    <input type="checkbox" />
                    <span>{item}</span>
                  </label>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </AppShell>
  );
}
