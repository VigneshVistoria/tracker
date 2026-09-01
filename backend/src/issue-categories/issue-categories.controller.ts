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
import { IssueCategoriesService } from './issue-categories.service';
import { CreateIssueCategoryDto } from './dto/create-issue-category.dto';
import { UpdateIssueCategoryDto } from './dto/update-issue-category.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Read (list/get) is open to any authenticated user - this is reference
// data other screens may eventually populate dropdowns from. Every
// mutating route is Admin/Program Manager only, the same boundary the
// Issues bulk import/export endpoints use (IssuesBulkService).
@Controller('issue-categories')
@UseGuards(JwtAuthGuard)
export class IssueCategoriesController {
  constructor(
    private issueCategoriesService: IssueCategoriesService,
    private usersService: UsersService,
  ) {}

  private async assertCanManage(userId: number): Promise<void> {
    const currentUser = await this.usersService.findById(userId);
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Admin or Program Manager can manage issue categories.');
    }
  }

  @Get()
  findAll(@Req() req: any) {
    return this.issueCategoriesService.findAll(req.user.tenantId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.issueCategoriesService.findOneOrFail(id, req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateIssueCategoryDto, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.issueCategoriesService.create(dto, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateIssueCategoryDto, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.issueCategoriesService.update(id, dto, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Patch(':id/deactivate')
  async deactivate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.issueCategoriesService.setActive(id, false, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Patch(':id/activate')
  async activate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.issueCategoriesService.setActive(id, true, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    await this.issueCategoriesService.remove(id, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
    return { success: true };
  }
}
