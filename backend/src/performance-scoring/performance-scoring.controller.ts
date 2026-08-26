import { Controller, Get, Post, Patch, Delete, Body, Param, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { PerformanceScoringService } from './performance-scoring.service';
import { UpdatePerformanceScoringConfigDto } from './dto/update-performance-scoring-config.dto';
import { CreateOverduePenaltyTierDto } from './dto/create-overdue-penalty-tier.dto';
import { UpdateOverduePenaltyTierDto } from './dto/update-overdue-penalty-tier.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';

// Admin-only end to end, per spec - same shape as SlaController.
@Controller('performance-scoring-config')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PerformanceScoringController {
  constructor(private performanceScoringService: PerformanceScoringService) {}

  @Get()
  getConfig() {
    return this.performanceScoringService.getEffectiveConfig();
  }

  @Patch()
  updateConfig(@Body() dto: UpdatePerformanceScoringConfigDto, @Req() req: any) {
    return this.performanceScoringService.updateConfig(dto, { id: req.user.sub, email: req.user.email });
  }

  @Post('tiers')
  createTier(@Body() dto: CreateOverduePenaltyTierDto, @Req() req: any) {
    return this.performanceScoringService.createTier(dto, { id: req.user.sub, email: req.user.email });
  }

  @Patch('tiers/:id')
  updateTier(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOverduePenaltyTierDto, @Req() req: any) {
    return this.performanceScoringService.updateTier(id, dto, { id: req.user.sub, email: req.user.email });
  }

  @Delete('tiers/:id')
  removeTier(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.performanceScoringService.removeTier(id, { id: req.user.sub, email: req.user.email });
  }
}
