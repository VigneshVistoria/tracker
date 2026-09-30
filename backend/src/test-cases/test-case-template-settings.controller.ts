import { Controller, Get, Put, Body, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { TestCaseTemplateSettingsService } from './test-case-template-settings.service';
import { UpdateTemplateColumnOrderDto } from './dto/update-template-column-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Same access as TestCaseCustomFieldsController: any authenticated user
// can read the order, only Admin/Program Manager can change it.
@Controller('test-case-template')
@UseGuards(JwtAuthGuard)
export class TestCaseTemplateSettingsController {
  constructor(
    private settingsService: TestCaseTemplateSettingsService,
    private usersService: UsersService,
  ) {}

  @Get('column-order')
  getColumnOrder(@Req() req: any) {
    return this.settingsService.getColumnOrder(req.user.tenantId);
  }

  @Put('column-order')
  async updateColumnOrder(@Body() dto: UpdateTemplateColumnOrderDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Admin or Program Manager can change the template column order.');
    }
    return this.settingsService.updateColumnOrder(dto.columnOrder, { id: req.user.sub, email: req.user.email }, req.user.tenantId);
  }
}
