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
import { ReleaseLogsService } from './release-logs.service';
import { CreateReleaseDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
import { AddReleaseItemDto } from './dto/add-release-item.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Program Manager only for now, view and manage alike - built PM-first
// for review (2026-09-26) before deciding what other roles get. Widen
// assertIsPm (and the page's VIEW_ROLES + the AppShell nav check)
// together when that's decided.
@Controller('releases')
@UseGuards(JwtAuthGuard)
export class ReleaseLogsController {
  constructor(
    private releaseLogsService: ReleaseLogsService,
    private usersService: UsersService,
  ) {}

  private async assertIsPm(userId: number): Promise<{ id: number; email: string }> {
    const currentUser = await this.usersService.findById(userId);
    if (currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Program Manager can access the Release Log.');
    }
    return { id: currentUser.id, email: currentUser.email };
  }

  @Get()
  async findAll(@Query('projectId') projectId: string | undefined, @Req() req: any) {
    await this.assertIsPm(req.user.sub);
    const parsedProjectId = projectId ? Number(projectId) : undefined;
    return this.releaseLogsService.findAll(req.user.tenantId, parsedProjectId);
  }

  @Get('ticket-options')
  async ticketOptions(@Query('projectId', ParseIntPipe) projectId: number, @Req() req: any) {
    await this.assertIsPm(req.user.sub);
    return this.releaseLogsService.findTicketOptions(projectId, req.user.tenantId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertIsPm(req.user.sub);
    return this.releaseLogsService.findOneWithItems(id, req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateReleaseDto, @Req() req: any) {
    const user = await this.assertIsPm(req.user.sub);
    return this.releaseLogsService.create(dto, user, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateReleaseDto, @Req() req: any) {
    const user = await this.assertIsPm(req.user.sub);
    return this.releaseLogsService.update(id, dto, user, req.user.tenantId);
  }

  @Post(':id/items')
  async addItem(@Param('id', ParseIntPipe) id: number, @Body() dto: AddReleaseItemDto, @Req() req: any) {
    const user = await this.assertIsPm(req.user.sub);
    return this.releaseLogsService.addItem(id, dto.taskId, user, req.user.tenantId);
  }

  @Delete(':id/items/:itemId')
  async removeItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Req() req: any,
  ) {
    const user = await this.assertIsPm(req.user.sub);
    return this.releaseLogsService.removeItem(id, itemId, user, req.user.tenantId);
  }
}
