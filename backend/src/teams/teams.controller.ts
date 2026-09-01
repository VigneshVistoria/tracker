import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Read (list/get) is open to any authenticated user. Every mutating route
// is Admin/Program Manager only, the same boundary the Issues bulk
// import/export endpoints use (IssuesBulkService).
@Controller('teams')
@UseGuards(JwtAuthGuard)
export class TeamsController {
  constructor(
    private teamsService: TeamsService,
    private usersService: UsersService,
  ) {}

  private async assertCanManage(userId: number): Promise<void> {
    const currentUser = await this.usersService.findById(userId);
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Admin or Program Manager can manage teams.');
    }
  }

  @Get()
  findAll(@Req() req: any) {
    return this.teamsService.findAll(req.user.tenantId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.teamsService.findOneOrFail(id, req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateTeamDto, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.teamsService.create(dto, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTeamDto, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.teamsService.update(id, dto, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Patch(':id/deactivate')
  async deactivate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.teamsService.setActive(id, false, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Patch(':id/activate')
  async activate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.teamsService.setActive(id, true, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    await this.teamsService.remove(id, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
    return { success: true };
  }
}
