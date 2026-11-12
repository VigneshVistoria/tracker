import { WeeklyReportsService } from '../src/reports/weekly-reports.service';
import { UserRole } from '../src/users/user.entity';

// Saturday performance report emails follow "Show own performance metrics
// to team members" (2026-11-12): a Developer/Designer/DevOps/QA whose role
// isn't ticked gets no email; PM/Admin/Executive still do; unknown
// addresses are skipped.
describe('Weekly performance report emails - own-metrics setting', () => {
  const users = [
    { email: 'dev@x.test', role: UserRole.DEVELOPER },
    { email: 'qa@x.test', role: UserRole.QA },
    { email: 'pm@x.test', role: UserRole.PROGRAM_MANAGER },
  ];
  const report: any = {
    tenantId: 1,
    data: {
      weekStartDate: '2026-11-09',
      weekEndDate: '2026-11-13',
      assigneeStats: [
        { assigneeEmail: 'DEV@x.test' },
        { assigneeEmail: 'qa@x.test' },
        { assigneeEmail: 'pm@x.test' },
        { assigneeEmail: 'gone@x.test' },
      ],
    },
  };

  function build(ownRoles: UserRole[]) {
    const mail = { sendToAssignee: jest.fn().mockResolvedValue(undefined) };
    const pdf = { buildAssigneeReport: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    const usersService = { findAll: jest.fn().mockResolvedValue(users) };
    const wide = [UserRole.ADMIN, UserRole.PROGRAM_MANAGER, UserRole.EXECUTIVE];
    const ownMetrics = { canSeeOwn: jest.fn(async (u: any) => wide.includes(u.role) || ownRoles.includes(u.role)) };
    const service = new WeeklyReportsService(
      {} as any, {} as any, {} as any, {} as any,
      mail as any, pdf as any, usersService as any, ownMetrics as any,
    );
    // The email body needs full stats; only who gets one matters here.
    jest.spyOn(service as any, 'buildPerformanceEmailHtml').mockReturnValue('<p>report</p>');
    return { service, mail };
  }

  it('setting OFF (no roles ticked): only the PM is emailed', async () => {
    const { service, mail } = build([]);
    const res = await service.emailPerformanceReports(report);
    expect(res.sent).toEqual(['pm@x.test']);
    expect(res.skipped).toEqual(['DEV@x.test', 'qa@x.test', 'gone@x.test']);
    expect(mail.sendToAssignee).toHaveBeenCalledTimes(1);
  });

  it('Developer ticked: developers are emailed again, QA still not', async () => {
    const { service } = build([UserRole.DEVELOPER]);
    const res = await service.emailPerformanceReports(report);
    expect(res.sent).toEqual(['DEV@x.test', 'pm@x.test']);
    expect(res.skipped).toEqual(['qa@x.test', 'gone@x.test']);
  });
});
