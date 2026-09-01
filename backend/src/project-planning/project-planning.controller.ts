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
import { ProjectPlanningService } from './project-planning.service';
import { CreateProjectPlanEntryDto } from './dto/create-project-plan-entry.dto';
import { UpdateProjectPlanEntryDto } from './dto/update-project-plan-entry.dto';
import { UpdateProjectPlanStatusDto } from './dto/update-project-plan-status.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Wider read access than write access, same shape as
// WeeklyReportsController: Admin/Executive/Program Manager can view
// (leadership oversight), but only Program Manager can create/edit -
// narrower than every other module built today (those allow Admin+PM to
// manage). QA/Developer get 403 on every route here, including reads.
@Controller('project-planning')
@UseGuards(JwtAuthGuard)
export class ProjectPlanningController {
  constructor(
    private projectPlanningService: ProjectPlanningService,
    private usersService: UsersService,
  ) {}

  private async assertCanView(userId: number): Promise<void> {
    const currentUser = await this.usersService.findById(userId);
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.EXECUTIVE &&
      currentUser.role !== UserRole.PROGRAM_MANAGER
    ) {
      throw new ForbiddenException('Only Admin, Executive, and Program Manager can view Project Planning.');
    }
  }

  private async assertCanManage(userId: number): Promise<{ id: number; email: string }> {
    const currentUser = await this.usersService.findById(userId);
    if (currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Program Manager can manage Project Planning entries.');
    }
    return { id: currentUser.id, email: currentUser.email };
  }

  @Get()
  async findAll(@Req() req: any) {
    await this.assertCanView(req.user.sub);
    return this.projectPlanningService.findAll(req.user.tenantId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanView(req.user.sub);
    return this.projectPlanningService.findOneWithCompletion(id, req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateProjectPlanEntryDto, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.projectPlanningService.create(dto, user, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProjectPlanEntryDto, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.projectPlanningService.update(id, dto, user, req.user.tenantId);
  }

  @Patch(':id/status')
  async updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProjectPlanStatusDto, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.projectPlanningService.updateStatus(id, dto.status, user, req.user.tenantId);
  }

  @Patch(':id/deactivate')
  async deactivate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.projectPlanningService.setActive(id, false, user, req.user.tenantId);
  }

  @Patch(':id/activate')
  async activate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.projectPlanningService.setActive(id, true, user, req.user.tenantId);
  }
}
