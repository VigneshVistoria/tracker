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

  // Admins see every issue. Regular users only see issues where they are
  // the assignee.
  @Get()
  async findAll(@Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role === UserRole.ADMIN) {
      return this.issuesService.findAll();
    }
    return this.issuesService.findByAssignee(currentUser.id);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    const issue = await this.issuesService.findOne(id);

    if (currentUser.role !== UserRole.ADMIN && issue.assigneeUserId !== currentUser.id) {
      throw new ForbiddenException('You do not have access to this issue');
    }

    return issue;
  }

  @Post()
  create(@Body() dto: CreateIssueDto, @Req() req: any) {
    const { sub: userId, email } = req.user;
    return this.issuesService.create(dto, userId, email);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateIssueDto) {
    return this.issuesService.update(id, dto);
  }
}
