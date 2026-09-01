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
import { PhasesService } from './phases.service';
import { CreatePhaseDto } from './dto/create-phase.dto';
import { UpdatePhaseDto } from './dto/update-phase.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Brand-new entity, no legacy capability to protect (unlike Modules,
// which widened an existing admin-only feature) - so this follows the
// Project Planning precedent instead: manage is Program Manager only,
// exactly as requested. View is Admin/Executive/PM, same as every
// module built today.
@Controller('phases')
@UseGuards(JwtAuthGuard)
export class PhasesController {
  constructor(
    private phasesService: PhasesService,
    private usersService: UsersService,
  ) {}

  private async assertCanView(userId: number): Promise<void> {
    const currentUser = await this.usersService.findById(userId);
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.EXECUTIVE &&
      currentUser.role !== UserRole.PROGRAM_MANAGER
    ) {
      throw new ForbiddenException('Only Admin, Executive, and Program Manager can view Phases.');
    }
  }

  private async assertCanManage(userId: number): Promise<{ id: number; email: string }> {
    const currentUser = await this.usersService.findById(userId);
    if (currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Program Manager can manage phases.');
    }
    return { id: currentUser.id, email: currentUser.email };
  }

  // Module-scoped search-select, used by Project Planning and the Issue
  // create/edit forms - active only by default.
  @Get()
  async findAllForModule(@Query('moduleId', ParseIntPipe) moduleId: number, @Req() req: any) {
    await this.assertCanView(req.user.sub);
    return this.phasesService.findAllForModule(moduleId, req.user.tenantId);
  }

  // Tenant-wide list with %Complete, across every project/module -
  // powers the Project Phases page.
  @Get('all')
  async findAllWithCompletion(
    @Query('projectId') projectId: string | undefined,
    @Query('moduleId') moduleId: string | undefined,
    @Req() req: any,
  ) {
    await this.assertCanView(req.user.sub);
    return this.phasesService.findAllWithCompletion(req.user.tenantId, {
      projectId: projectId !== undefined ? Number(projectId) : undefined,
      moduleId: moduleId !== undefined ? Number(moduleId) : undefined,
    });
  }

  @Post()
  async create(@Body() dto: CreatePhaseDto, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.phasesService.create(dto, user, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePhaseDto, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.phasesService.update(id, dto, user, req.user.tenantId);
  }

  @Patch(':id/deactivate')
  async deactivate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.phasesService.setActive(id, false, user, req.user.tenantId);
  }

  @Patch(':id/activate')
  async activate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    return this.phasesService.setActive(id, true, user, req.user.tenantId);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const user = await this.assertCanManage(req.user.sub);
    await this.phasesService.remove(id, user, req.user.tenantId);
    return { success: true };
  }
}
