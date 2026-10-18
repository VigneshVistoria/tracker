import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { ReturnToQaService } from './return-to-qa.service';
import { AddDefectEvidenceDto, ReturnToQaDto, ReturnToQaSendBackDto } from './dto/return-to-qa.dto';

// Return to QA - see ./return-to-qa.ts. Registered before TasksController
// in TasksModule so 'returned-to-qa' is never read as a task ':id'.
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class ReturnToQaController {
  constructor(
    private returnToQa: ReturnToQaService,
    private usersService: UsersService,
  ) {}

  private me(req: any) {
    return this.usersService.findById(req.user.sub);
  }

  // QA: tickets currently returned to me.
  @Get('returned-to-qa')
  async mine(@Req() req: any) {
    return this.returnToQa.listForQa((await this.me(req))!, req.user.tenantId);
  }

  @Get(':id/return-to-qa')
  async state(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.returnToQa.state(id, (await this.me(req))!, req.user.tenantId);
  }

  // Program Manager: send the ticket back to QA.
  @Patch(':id/return-to-qa')
  async send(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnToQaDto, @Req() req: any) {
    return this.returnToQa.returnToQa(id, dto, (await this.me(req))!, req.user.tenantId);
  }

  // The QA it was returned to (or a PM): back to Development.
  @Patch(':id/return-to-qa/send-back')
  async sendBack(@Param('id', ParseIntPipe) id: number, @Body() dto: ReturnToQaSendBackDto, @Req() req: any) {
    return this.returnToQa.sendBack(id, dto, (await this.me(req))!, req.user.tenantId);
  }

  @Post(':id/defect-artifacts')
  async addEvidence(@Param('id', ParseIntPipe) id: number, @Body() dto: AddDefectEvidenceDto, @Req() req: any) {
    return this.returnToQa.addEvidence(id, dto, (await this.me(req))!, req.user.tenantId);
  }

  @Delete(':id/defect-artifacts/:artifactId')
  async removeEvidence(@Param('id', ParseIntPipe) id: number, @Param('artifactId', ParseIntPipe) artifactId: number, @Req() req: any) {
    return this.returnToQa.removeEvidence(id, artifactId, (await this.me(req))!, req.user.tenantId);
  }
}
