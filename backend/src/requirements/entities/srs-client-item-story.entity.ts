import { Entity, PrimaryColumn } from 'typeorm';

// Client item -> the stories it blocks while open.
@Entity('srs_client_item_stories')
export class SrsClientItemStory {
  @PrimaryColumn()
  itemId: number;

  @PrimaryColumn()
  storyId: number;
}
