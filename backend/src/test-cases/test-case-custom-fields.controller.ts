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
import { TestCaseCustomFieldsService } from './test-case-custom-fields.service';
import { CreateTestCaseCustomFieldDto } from './dto/create-test-case-custom-field.dto';
import { UpdateTestCaseCustomFieldDto } from './dto/update-test-case-custom-field.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Read is open to any authenticated user (the test case forms/list need
// the definitions), same as GET /labels. Defining, editing, deactivating
// and deleting fields is Admin/Program Manager only (confirmed with the
// user 2026-09-30) - QA fills values in on test cases but can't change
// the field definitions themselves.
@Controller('test-case-custom-fields')
@UseGuards(JwtAuthGuard)
export class TestCaseCustomFieldsController {
  constructor(
    private fieldsService: TestCaseCustomFieldsService,
    private usersService: UsersService,
  ) {}

  private async assertCanManage(userId: number): Promise<void> {
    const currentUser = await this.usersService.findById(userId);
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Admin or Program Manager can manage test case fields.');
    }
  }

  @Get()
  findAll(@Req() req: any) {
    return this.fieldsService.findAll(req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateTestCaseCustomFieldDto, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.fieldsService.create(dto, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTestCaseCustomFieldDto, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.fieldsService.update(id, dto, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Patch(':id/deactivate')
  async deactivate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.fieldsService.setActive(id, false, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Patch(':id/activate')
  async activate(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    return this.fieldsService.setActive(id, true, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.assertCanManage(req.user.sub);
    await this.fieldsService.remove(id, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
    return { success: true };
  }
}
