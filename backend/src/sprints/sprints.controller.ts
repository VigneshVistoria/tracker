import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { SprintsService } from './sprints.service';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { AddIssuesToSprintDto } from './dto/add-issues-to-sprint.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Viewing sprints is open to anyone with access to the parent project -
// same check ProjectsController.findOne/ModulesController use - creating,
// editing, and moving issues in/out of a sprint is admin-only, consistent
// with how Projects are managed today.
@Controller('sprints')
@UseGuards(JwtAuthGuard)
export class SprintsController {
  constructor(
    private sprintsService: SprintsService,
    private usersService: UsersService,
  ) {}

  private async assertProjectAccess(projectId: number, req: any): Promise<void> {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role === UserRole.ADMIN) return;
    const assignedProjectIds = (currentUser.projects || []).map((p) => p.id);
    if (!assignedProjectIds.includes(projectId)) {
      throw new ForbiddenException('You do not have access to this project');
    }
  }

  @Get()
  async findAllForProject(@Query('projectId', ParseIntPipe) projectId: number, @Req() req: any) {
    await this.assertProjectAccess(projectId, req);
    return this.sprintsService.findAllForProject(projectId, req.user.tenantId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const sprint = await this.sprintsService.findOne(id, req.user.tenantId);
    await this.assertProjectAccess(sprint.projectId, req);
    return this.sprintsService.findOneWithIssues(id, req.user.tenantId);
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateSprintDto, @Req() req: any) {
    return this.sprintsService.create(dto, req.user.sub, req.user.tenantId);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSprintDto, @Req() req: any) {
    return this.sprintsService.update(id, dto, req.user.tenantId);
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.sprintsService.remove(id, req.user.tenantId);
  }

  @Post(':id/issues')
  @UseGuards(AdminGuard)
  addIssues(@Param('id', ParseIntPipe) id: number, @Body() dto: AddIssuesToSprintDto, @Req() req: any) {
    return this.sprintsService.addIssues(id, dto, req.user.tenantId);
  }

  @Delete(':id/issues/:issueId')
  @UseGuards(AdminGuard)
  removeIssue(@Param('id', ParseIntPipe) id: number, @Param('issueId', ParseIntPipe) issueId: number, @Req() req: any) {
    return this.sprintsService.removeIssue(id, issueId, req.user.tenantId);
  }
}
