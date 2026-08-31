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
import { TimeSheetsService } from './time-sheets.service';
import { CreateTimeEntryDto } from './dto/create-time-entry.dto';
import { UpdateTimeEntryDto } from './dto/update-time-entry.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Logging time is Developer + Admin only for now - QA and Program
// Manager don't log time yet. Viewing the aggregated report is a
// separate permission (Admin/Executive/Program Manager), same
// leadership-wide-visibility set Performance Dashboard uses.
const ROLES_ALLOWED_TO_LOG_TIME: UserRole[] = [UserRole.ADMIN, UserRole.DEVELOPER];

@Controller('time-entries')
@UseGuards(JwtAuthGuard)
export class TimeSheetsController {
  constructor(
    private timeSheetsService: TimeSheetsService,
    private usersService: UsersService,
  ) {}

  @Post()
  async create(@Body() dto: CreateTimeEntryDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (!ROLES_ALLOWED_TO_LOG_TIME.includes(currentUser.role)) {
      throw new ForbiddenException('You are not able to log time entries.');
    }
    return this.timeSheetsService.create(dto, currentUser.id, currentUser.email, req.user.tenantId);
  }

  // Your own submission history - defaults to the current week, which is
  // the "weekly summary per user" view.
  @Get('me')
  findMine(@Query('startDate') startDate: string | undefined, @Query('endDate') endDate: string | undefined, @Req() req: any) {
    return this.timeSheetsService.findMine(req.user.sub, req.user.tenantId, startDate, endDate);
  }

  // Leadership-wide aggregated report - declared before ':id' below for
  // the same routing reason noted on DependenciesController.
  @Get('report')
  async getReport(
    @Query('startDate') startDate: string | undefined,
    @Query('endDate') endDate: string | undefined,
    @Query('userId') userId: string | undefined,
    @Query('projectId') projectId: string | undefined,
    @Req() req: any,
  ) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (
      currentUser.role !== UserRole.ADMIN &&
      currentUser.role !== UserRole.EXECUTIVE &&
      currentUser.role !== UserRole.PROGRAM_MANAGER
    ) {
      throw new ForbiddenException('Only Admins, Program Managers, and Executives can view the time sheet report.');
    }
    return this.timeSheetsService.getReport(
      req.user.tenantId,
      startDate,
      endDate,
      userId ? Number(userId) : undefined,
      projectId ? Number(projectId) : undefined,
    );
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTimeEntryDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.timeSheetsService.update(id, dto, currentUser, req.user.tenantId);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    await this.timeSheetsService.remove(id, currentUser, req.user.tenantId);
  }
}
