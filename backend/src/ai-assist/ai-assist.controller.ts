import { Controller, Post, Body, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { AiAssistService } from './ai-assist.service';
import { GenerateUserStoryDto } from './dto/generate-user-story.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user.entity';

// Program Manager only, per spec - deliberately no Admin override here,
// unlike every other gated feature in this app. This is the one place
// the usual "Admin always overrides" pattern doesn't apply.
@Controller('issues/ai')
@UseGuards(JwtAuthGuard)
export class AiAssistController {
  constructor(
    private aiAssistService: AiAssistService,
    private usersService: UsersService,
  ) {}

  @Post('generate-user-story')
  async generateUserStory(@Body() dto: GenerateUserStoryDto, @Req() req: any) {
    const currentUser = await this.usersService.findById(req.user.sub);
    if (currentUser.role !== UserRole.PROGRAM_MANAGER) {
      throw new ForbiddenException('Only Program Managers can use AI ticket generation.');
    }
    return this.aiAssistService.generateUserStory(dto.keyword);
  }
}
