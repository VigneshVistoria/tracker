import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { TechReviewsService } from './tech-reviews.service';
import { AddTechReviewEvidenceDto, CreateTechReviewDto, ListTechReviewsDto, UpdateTechReviewDto } from './dto/tech-reviews.dto';

// Performance Tracking Q5 - see ./tech-reviews.ts.
@Controller('tech-reviews')
@UseGuards(JwtAuthGuard)
export class TechReviewsController {
  constructor(
    private reviews: TechReviewsService,
    private usersService: UsersService,
  ) {}

  private async me(req: any) {
    return (await this.usersService.findByIdAndTenant(req.user.sub, req.user.tenantId))!;
  }

  @Get()
  async list(@Query() q: ListTechReviewsDto, @Req() req: any) {
    return this.reviews.list(q.month, await this.me(req), req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: CreateTechReviewDto, @Req() req: any) {
    return this.reviews.create(dto, await this.me(req), req.user.tenantId);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTechReviewDto, @Req() req: any) {
    return this.reviews.update(id, dto, await this.me(req), req.user.tenantId);
  }

  @Post(':id/evidence')
  async addEvidence(@Param('id', ParseIntPipe) id: number, @Body() dto: AddTechReviewEvidenceDto, @Req() req: any) {
    return this.reviews.addEvidence(id, dto, await this.me(req), req.user.tenantId);
  }
}
