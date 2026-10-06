import { Injectable } from '@nestjs/common';
import { IssuesService } from '../issues/issues.service';
import { TasksService } from '../tasks/tasks.service';
import { TestCasesService } from '../test-cases/test-cases.service';
import { UsersService } from '../users/users.service';
import { UserRole, DEVELOPER_EQUIVALENT_ROLES } from '../users/user.entity';

const PER_GROUP = 5;
// Same viewer roles as TestCasesController.requireViewer.
const TEST_CASE_VIEW_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.QA, UserRole.PROGRAM_MANAGER];
// Confirmed with the user 2026-10-06: People results are leadership-only.
const PEOPLE_SEARCH_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE];

export interface SearchHit {
  id: number;
  title: string;
  subtitle?: string | null;
  href: string | null;
}

export interface SearchResults {
  issues: SearchHit[];
  tasks: SearchHit[];
  testCases: SearchHit[];
  people: SearchHit[];
}

// Lower is better; null = no match. "#42" / "42" match ids exactly.
function score(query: string, id: number, ...fields: Array<string | null | undefined>): number | null {
  const q = query.toLowerCase();
  const idQuery = q.replace(/^#/, '');
  if (/^\d+$/.test(idQuery) && String(id) === idQuery) return 0;
  let best: number | null = null;
  for (const field of fields) {
    if (!field) continue;
    const f = field.toLowerCase();
    const s = f.startsWith(q) ? 1 : f.split(/[\s\-_/.@]+/).some((w) => w.startsWith(q)) ? 2 : f.includes(q) ? 3 : null;
    if (s !== null && (best === null || s < best)) best = s;
  }
  return best;
}

function top<T>(rows: T[], scoreOf: (row: T) => number | null): T[] {
  return rows
    .map((row) => ({ row, s: scoreOf(row) }))
    .filter((r) => r.s !== null)
    .sort((a, b) => (a.s as number) - (b.s as number))
    .slice(0, PER_GROUP)
    .map((r) => r.row);
}

// Global search for the command palette. Every group reuses the exact
// service calls the matching list page/endpoint uses, so search can never
// surface a row the caller couldn't already see there:
//   issues    -> IssuesController.findAll's role branching
//   tasks     -> TasksService.findVisibleToUser (behind findAllForUser)
//   testCases -> TestCasesController viewer roles
//   people    -> leadership only
@Injectable()
export class SearchService {
  constructor(
    private issuesService: IssuesService,
    private tasksService: TasksService,
    private testCasesService: TestCasesService,
    private usersService: UsersService,
  ) {}

  private async visibleIssues(currentUser: any, tenantId: number) {
    if (currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.EXECUTIVE) {
      return this.issuesService.findAll(tenantId);
    }
    if (currentUser.role === UserRole.CLIENT) {
      return this.issuesService.findByCreator(currentUser.id, tenantId);
    }
    if (DEVELOPER_EQUIVALENT_ROLES.includes(currentUser.role) || currentUser.role === UserRole.QA) {
      return this.issuesService.findByAssignee(currentUser.id, tenantId);
    }
    const projectIds = (currentUser.projects || []).map((p: { id: number }) => p.id);
    return this.issuesService.findByProjects(projectIds, tenantId);
  }

  async search(query: string, userId: number, tenantId: number): Promise<SearchResults> {
    const q = query.trim().slice(0, 100);
    const empty: SearchResults = { issues: [], tasks: [], testCases: [], people: [] };
    if (q.length < 2) return empty;

    const currentUser = await this.usersService.findById(userId);
    if (!currentUser) return empty;

    const [issues, tasks, testCases, people] = await Promise.all([
      this.visibleIssues(currentUser, tenantId),
      this.tasksService.findVisibleToUser(currentUser, tenantId),
      TEST_CASE_VIEW_ROLES.includes(currentUser.role) ? this.testCasesService.findAll(tenantId) : Promise.resolve([]),
      PEOPLE_SEARCH_ROLES.includes(currentUser.role) ? this.usersService.findAll(tenantId) : Promise.resolve([]),
    ]);

    return {
      issues: top(issues, (i) => score(q, i.id, i.title)).map((i) => ({
        id: i.id,
        title: i.title,
        subtitle: [`#${i.id}`, i.status, i.projectName].filter(Boolean).join(' · '),
        href: `/issues/${i.id}`,
      })),
      tasks: top(tasks, (t) => score(q, t.id, t.title)).map((t) => ({
        id: t.id,
        title: t.title,
        subtitle: [`#${t.id}`, t.status === 'Escalated' ? 'Intervention' : t.status, t.projectName].filter(Boolean).join(' · '),
        href: `/tasks/${t.id}`,
      })),
      testCases: top(testCases, (tc) => score(q, tc.id, tc.title, tc.caseNumber)).map((tc) => ({
        id: tc.id,
        title: tc.title,
        subtitle: [tc.caseNumber, tc.lastResult || 'Not executed', tc.projectName].filter(Boolean).join(' · '),
        href: `/qa/test-cases/${tc.id}`,
      })),
      people: top(people, (u) => score(q, u.id, u.fullName, u.email)).map((u) => ({
        id: u.id,
        title: u.fullName || u.email,
        subtitle: [u.email, u.role].filter(Boolean).join(' · '),
        href: currentUser.role === UserRole.ADMIN ? `/admin/users/${u.id}` : null,
      })),
    };
  }
}
