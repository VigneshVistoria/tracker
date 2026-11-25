import { Entity, PrimaryColumn } from 'typeorm';

// A linked ticket (srs_story_tickets) -> the criteria it covers. Optional.
@Entity('srs_ticket_criteria')
export class SrsTicketCriterion {
  @PrimaryColumn()
  storyTicketId: number;

  @PrimaryColumn()
  criterionId: number;
}
