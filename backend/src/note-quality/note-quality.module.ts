import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskQaReview } from '../task-qa-reviews/task-qa-review.entity';
import { NoteQualityService } from './note-quality.service';

@Module({
  imports: [TypeOrmModule.forFeature([TaskQaReview])],
  providers: [NoteQualityService],
  exports: [NoteQualityService],
})
export class NoteQualityModule {}
