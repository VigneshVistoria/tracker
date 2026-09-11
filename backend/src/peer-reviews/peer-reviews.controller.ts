import { Controller, Post, Patch, Body, Param, ParseIntPipe, UseGuards, Req } from '@nestjs/common';
import { PeerReviewsService } from './peer-reviews.service';
import { SubmitPeerReviewDto } from './dto/submit-peer-review.dto';
import { ApprovePeerReviewDto } from './dto/approve-peer-review.dto';
import { RejectPeerReviewDto } from './dto/reject-peer-review.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';

// Mounted at the same 'tasks' prefix as TasksController/TaskQaReviewsController
// - same reasoning as TaskQaReviewsController's own comment: these routes
// are all two-segment (':id/peer-review-submit' etc.), so they never
// collide with either controller's own routes, while keeping Peer
// Review's round-tracking logic in its own module, untouched by and not
// touching the existing QA review module.
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class PeerReviewsController {
  constructor(
    private peerReviewsService: PeerReviewsService,
    private usersService: UsersService,
  ) {}

  @Post(':id/peer-review-submit')
  async submit(@Param('id', ParseIntPipe) id: number, @Body() dto: SubmitPeerReviewDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.peerReviewsService.submit(id, dto, currentUser, req.user.tenantId);
  }

  @Patch(':id/peer-review-approve')
  async approve(@Param('id', ParseIntPipe) id: number, @Body() dto: ApprovePeerReviewDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.peerReviewsService.approve(id, dto, currentUser, req.user.tenantId);
  }

  @Patch(':id/peer-review-reject')
  async reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectPeerReviewDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    return this.peerReviewsService.reject(id, dto, currentUser, req.user.tenantId);
  }
}
