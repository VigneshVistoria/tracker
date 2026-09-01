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
import { LabelsService } from './labels.service';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Read (list/get) is open to any authenticated user. Every mutating route
// is Admin/Program Manager only, the same boundary the Issues bulk
// import/export endpoints use (IssuesBulkService).
@Controller('labels')
@UseGuards(JwtAuthGuard)
export class LabelsController {
  constructor(
    private labelsService: LabelsService,
    private usersService: UsersService,
  ) {}

  private async assertCanManage(userId: number): Promise<void> {
    const currentUser = await this.usersService.findById(userId);
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Admin or Program Manager can manage labels.');
    }
  }

  @Get()
  findAll(@Req() req: any) {
    return this.labelsService.findAll(req.user.tenantId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.labelsService.findOneOrFail(id, req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateLabelDto, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.labelsService.create(dto, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLabelDto, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.labelsService.update(id, dto, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Patch(':id/deactivate')
  async deactivate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.labelsService.setActive(id, false, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Patch(':id/activate')
  async activate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.labelsService.setActive(id, true, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    await this.labelsService.remove(id, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
    return { success: true };
  }
}
