import { Body, Controller, Get, Param, ParseIntPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { EscapedDefectService } from './escaped-defect.service';
import { UpdateEscapedDefectDto } from './dto/escaped-defect.dto';

// Performance Tracking Q4 - see ./escaped-defect.ts.
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class EscapedDefectController {
  constructor(
    private escaped: EscapedDefectService,
    private usersService: UsersService,
  ) {}

  private me(req: any) {
    return this.usersService.findById(req.user.sub);
  }

  @Get(':id/escaped-defect')
  async state(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.escaped.state(id, (await this.me(req))!, req.user.tenantId);
  }

  @Patch(':id/escaped-defect')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEscapedDefectDto, @Req() req: any) {
    return this.escaped.update(id, dto, (await this.me(req))!, req.user.tenantId);
  }
}
