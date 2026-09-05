import { Controller, Get, Post, Body, Param, ParseIntPipe, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import { CreateEvidenceDto } from './dto/create-evidence.dto';
import { IssuesService } from '../issues/issues.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';

// Every staff role except 'client' - Evidence isn't a client-facing
// concept today, same reasoning as the Task QA review viewer's role list.
const EVIDENCE_VIEW_ROLES = ['admin', 'executive', 'program_manager', 'qa', 'developer'];

// Mounted at the same 'issues' prefix as IssuesController - same reasoning
// as TaskQaReviewsController sharing 'tasks' with TasksController: these
// routes are two-segment (':id/evidence'), so they never collide with
// IssuesController's own routes, while keeping this feature's logic in
// its own module.
@Controller('issues')
@UseGuards(JwtAuthGuard)
export class EvidenceController {
  constructor(
    private evidenceService: EvidenceService,
    private issuesService: IssuesService,
    private usersService: UsersService,
  ) {}

  @Get(':id/evidence')
  async findForIssue(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    await this.issuesService.findOne(id, req.user.tenantId); // 404s if it doesn't exist in this tenant
    if (!EVIDENCE_VIEW_ROLES.includes(currentUser.role)) {
      throw new ForbiddenException("You do not have access to this issue's evidence.");
    }
    return this.evidenceService.findForIssue(id, req.user.tenantId);
  }

  @Post(':id/evidence')
  async submit(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateEvidenceDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const issue = await this.issuesService.findOne(id, req.user.tenantId);
    if (issue.assigneeUserId !== currentUser.id) {
      throw new ForbiddenException("Only this issue's Assignee can submit Evidence for it.");
    }
    return this.evidenceService.createBatch(id, dto.items, currentUser, req.user.tenantId);
  }
}
