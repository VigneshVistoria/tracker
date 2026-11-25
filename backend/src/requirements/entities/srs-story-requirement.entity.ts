import { Entity, PrimaryColumn } from 'typeorm';

// Story -> requirement IDs it traces to.
@Entity('srs_story_requirements')
export class SrsStoryRequirement {
  @PrimaryColumn()
  storyId: number;

  @PrimaryColumn()
  requirementId: number;
}
