import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { ClientMeasuresService } from './client-measures.service';
import { RecordUatResultDto, SaveReleaseSatisfactionDto, SetClientPriorityTierDto } from './dto/client-measures.dto';

// Performance Tracking L3-L5 - see ./client-measures.ts.
@Controller()
@UseGuards(JwtAuthGuard)
export class ClientMeasuresController {
  constructor(
    private measures: ClientMeasuresService,
    private usersService: UsersService,
  ) {}

  private async me(req: any) {
    return (await this.usersService.findByIdAndTenant(req.user.sub, req.user.tenantId))!;
  }

  @Get('tasks/:id/client-measures')
  async taskState(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.measures.taskState(id, await this.me(req), req.user.tenantId);
  }

  @Patch('tasks/:id/client-priority-tier')
  async setTier(@Param('id', ParseIntPipe) id: number, @Body() dto: SetClientPriorityTierDto, @Req() req: any) {
    return this.measures.setTier(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post('tasks/:id/uat-results')
  async recordUat(@Param('id', ParseIntPipe) id: number, @Body() dto: RecordUatResultDto, @Req() req: any) {
    return this.measures.recordUat(id, dto, await this.me(req), req.user.tenantId);
  }

  @Get('releases/:id/satisfaction')
  async releaseState(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.measures.releaseState(id, await this.me(req), req.user.tenantId);
  }

  @Put('releases/:id/satisfaction')
  async saveSatisfaction(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveReleaseSatisfactionDto, @Req() req: any) {
    return this.measures.saveSatisfaction(id, dto, await this.me(req), req.user.tenantId);
  }
}
