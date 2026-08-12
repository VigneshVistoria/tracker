import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Query,
  Param,
  Res,
  HttpCode,
  UseGuards,
  Req,
  ParseIntPipe,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { randomBytes } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TeamsSubscription } from './teams-subscription.entity';
import { TeamsGraphService } from './teams-graph.service';
import { TeamsMessageConverterService } from './teams-message-converter.service';
import { ConnectTeamsChannelDto } from './dto/connect-teams-channel.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/admin.guard';

@Controller('integrations/teams')
export class TeamsIntegrationController {
  private readonly logger = new Logger(TeamsIntegrationController.name);

  constructor(
    @InjectRepository(TeamsSubscription)
    private subscriptionsRepo: Repository<TeamsSubscription>,
    private teamsGraph: TeamsGraphService,
    private converter: TeamsMessageConverterService,
  ) {}

  // ---------- Admin management (requires login + admin role) ----------

  @Get()
  @UseGuards(JwtAuthGuard, AdminGuard)
  list() {
    return this.subscriptionsRepo.find({ order: { createdAt: 'DESC' } });
  }

  @Post('connect')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async connect(@Body() dto: ConnectTeamsChannelDto, @Req() req: any) {
    const clientState = randomBytes(24).toString('hex');
    const graphResult = await this.teamsGraph.createChannelMessageSubscription(
      dto.teamId,
      dto.channelId,
      clientState,
    );

    const record = this.subscriptionsRepo.create({
      graphSubscriptionId: graphResult.id,
      teamId: dto.teamId,
      channelId: dto.channelId,
      channelName: dto.channelName,
      projectId: dto.projectId,
      clientState,
      expirationDateTime: new Date(graphResult.expirationDateTime),
      active: true,
      createdByUserId: req.user.sub,
    });

    return this.subscriptionsRepo.save(record);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async disconnect(@Param('id', ParseIntPipe) id: number) {
    const record = await this.subscriptionsRepo.findOne({ where: { id } });
    if (!record) return { ok: true };

    await this.teamsGraph.deleteSubscription(record.graphSubscriptionId);
    await this.subscriptionsRepo.remove(record);
    return { ok: true };
  }

  // ---------- Webhook Microsoft Graph calls (no auth - Graph can't log in) ----------
  //
  // Security here comes from the clientState secret, not a login: every
  // real notification from Microsoft echoes back the clientState we gave
  // it when creating the subscription, and we reject anything that
  // doesn't match.

  @Post('webhook')
  @HttpCode(202)
  async webhook(
    @Query('validationToken') validationToken: string | undefined,
    @Body() body: any,
    @Res() res: Response,
  ) {
    // Step 1 of Graph's handshake: when a subscription is first created,
    // Graph immediately POSTs here with ?validationToken=... and expects
    // that exact value echoed back as plain text within 10 seconds.
    if (validationToken) {
      res.status(200).setHeader('Content-Type', 'text/plain').send(validationToken);
      return;
    }

    // Step 2, ongoing: real notifications arrive as { value: [...] }.
    const notifications = body?.value || [];

    for (const notification of notifications) {
      try {
        await this.handleNotification(notification);
      } catch (err) {
        // Never let one bad notification take down the whole batch, and
        // never throw here - Graph will just retry (and eventually give
        // up on this subscription) if we don't ack quickly.
        this.logger.error(`Failed to process Teams notification: ${err.message}`);
      }
    }

    res.status(202).send();
  }

  private async handleNotification(notification: any): Promise<void> {
    const subscription = await this.subscriptionsRepo.findOne({
      where: { graphSubscriptionId: notification.subscriptionId },
    });

    if (!subscription) {
      this.logger.warn(`Notification for unknown subscription ${notification.subscriptionId}`);
      return;
    }

    if (notification.clientState !== subscription.clientState) {
      this.logger.warn(`clientState mismatch on subscription ${notification.subscriptionId} - ignoring`);
      return;
    }

    // resourceData carries enough to identify the exact message; we then
    // fetch the full message ourselves rather than trusting notification
    // payload contents (Graph deliberately keeps these minimal).
    const messageId = notification.resourceData?.id;
    if (!messageId) return;

    const message = await this.teamsGraph.getChannelMessage(
      subscription.teamId,
      subscription.channelId,
      messageId,
    );

    const issue = await this.converter.convertAndCreateIssue(message, subscription);
    if (issue) {
      this.logger.log(`Created issue #${issue.id} from a tagged Teams message, assigned to user #${issue.assigneeUserId}.`);
    }
  }
}
