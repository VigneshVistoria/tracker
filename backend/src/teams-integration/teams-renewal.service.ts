import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { TeamsSubscription } from './teams-subscription.entity';
import { GraphSubscriptionNotFoundError, TeamsGraphService } from './teams-graph.service';

@Injectable()
export class TeamsRenewalService {
  private readonly logger = new Logger(TeamsRenewalService.name);

  constructor(
    @InjectRepository(TeamsSubscription)
    private subscriptionsRepo: Repository<TeamsSubscription>,
    private teamsGraph: TeamsGraphService,
  ) {}

  // Runs every 15 minutes and renews anything expiring within the next
  // 20 minutes, so a subscription should never actually lapse even if
  // one renewal attempt fails - there's another chance before it expires.
  @Cron('*/15 * * * *') // every 15 minutes
  async renewExpiringSubscriptions() {
    const cutoff = new Date(Date.now() + 20 * 60 * 1000);
    const dueForRenewal = await this.subscriptionsRepo.find({
      where: { active: true, expirationDateTime: LessThan(cutoff) },
    });

    for (const sub of dueForRenewal) {
      try {
        const result = await this.teamsGraph.renewSubscription(sub.graphSubscriptionId);
        sub.expirationDateTime = new Date(result.expirationDateTime);
        await this.subscriptionsRepo.save(sub);
        this.logger.log(`Renewed Teams subscription ${sub.graphSubscriptionId}`);
      } catch (err) {
        if (err instanceof GraphSubscriptionNotFoundError) {
          // Microsoft already deleted this subscription (it lapsed before we
          // got to renew it - e.g. the backend was down across its expiry).
          // A PATCH can never bring it back; recreate it from scratch so the
          // channel keeps working without a human having to notice and
          // manually reconnect it.
          await this.recreateSubscription(sub);
          continue;
        }
        this.logger.error(`Failed to renew Teams subscription ${sub.graphSubscriptionId}: ${err.message}`);
      }
    }
  }

  private async recreateSubscription(sub: TeamsSubscription): Promise<void> {
    try {
      const clientState = randomBytes(24).toString('hex');
      const result = await this.teamsGraph.createChannelMessageSubscription(sub.teamId, sub.channelId, clientState);
      sub.graphSubscriptionId = result.id;
      sub.clientState = clientState;
      sub.expirationDateTime = new Date(result.expirationDateTime);
      await this.subscriptionsRepo.save(sub);
      this.logger.log(
        `Teams subscription for channel ${sub.channelId} had already expired on Microsoft's side - recreated it as ${result.id}.`,
      );
    } catch (err) {
      this.logger.error(`Failed to recreate expired Teams subscription for channel ${sub.channelId}: ${err.message}`);
    }
  }
}
