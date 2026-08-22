import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { IssuesService } from './issues.service';
import { IssueAnalyzerService } from './issue-analyzer.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { AnalyzeIssueDto } from './dto/analyze-issue.dto';
import { RejectIssueDto } from './dto/reject-issue.dto';
import { CreateDependencyDto } from './dto/create-dependency.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

@Controller('issues')
@UseGuards(JwtAuthGuard) // every route below requires a logged-in user
export class IssuesController {
  constructor(
    private issuesService: IssuesService,
    private usersService: UsersService,
    private issueAnalyzerService: IssueAnalyzerService,
  ) {}

  // Analyzes a draft title/description before the issue is created. Never
  // blocks creation - it just returns guidance the frontend can show.
  @Post('analyze')
  analyze(@Body() dto: AnalyzeIssueDto) {
    return this.issueAnalyzerService.analyze(dto.title, dto.description);
  }

  // Admin and Executive see every issue (Executive is read-only everywhere
  // else in this controller). Developer and QA see issues that belong to
  // any of the projects they're assigned to - broader than "just their own
  // assigned issues", since QA specifically needs to see and reassign
  // tickets that aren't necessarily assigned to them yet.
  @Get()
  async findAll(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.EXECUTIVE) {
      return this.issuesService.findAll();
    }
    const projectIds = (currentUser.projects || []).map((p) => p.id);
    return this.issuesService.findByProjects(projectIds);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const issue = await this.issuesService.findOneWithDependencies(id);

    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.EXECUTIVE) {
      const assignedProjectIds = (currentUser.projects || []).map((p) => p.id);
      if (!issue.projectId || !assignedProjectIds.includes(issue.projectId)) {
        throw new ForbiddenException('You do not have access to this issue');
      }
    }

    return issue;
  }

  // Executives are read-only - everything below this point changes data,
  // so none of it is available to that role.
  @Post()
  create(@Body() dto: CreateIssueDto, @Req() req: any) {
    const { sub: userId, email } = req.user;
    return this.issuesService.create(dto, userId, email);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateIssueDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role === UserRole.EXECUTIVE) {
      throw new ForbiddenException('Executives have read-only access.');
    }
    return this.issuesService.update(id, dto, { id: currentUser.id, role: currentUser.role });
  }

  // Any developer/QA/admin can spin off a dependency ticket from a parent -
  // it's just a normal issue with parentIssueId set, assigned to whoever
  // is designated as the dependency owner.
  @Post(':id/dependencies')
  async createDependency(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateDependencyDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role === UserRole.EXECUTIVE) {
      throw new ForbiddenException('Executives have read-only access.');
    }
    return this.issuesService.createDependency(id, dto, currentUser.id, currentUser.email);
  }

  // Only the assignee (or an admin) can submit their own work for review.
  @Post(':id/submit-for-review')
  async submitForReview(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const issue = await this.issuesService.findOne(id);
    if (currentUser.role !== UserRole.ADMIN && issue.assigneeUserId !== currentUser.id) {
      throw new ForbiddenException('Only the assignee can submit this issue for review.');
    }
    return this.issuesService.submitForReview(id, currentUser.id, currentUser.email);
  }

  // Only the designated Program Manager (or an admin, as an override) can
  // approve or send back an issue in review.
  @Post(':id/approve')
  async approve(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role === UserRole.EXECUTIVE) {
      throw new ForbiddenException('Executives have read-only access.');
    }
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only the Program Manager can approve issues.');
    }
    return this.issuesService.approve(id, currentUser.id, currentUser.email);
  }

  @Post(':id/reject')
  async reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectIssueDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role === UserRole.EXECUTIVE) {
      throw new ForbiddenException('Executives have read-only access.');
    }
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only the Program Manager can send issues back.');
    }
    return this.issuesService.reject(id, currentUser.id, currentUser.email, dto.reason);
  }
}

