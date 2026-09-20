import { IsArray, IsInt, IsOptional, IsString, MinLength, MaxLength, Validate, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { QaReviewArtifactDto, UniqueQaArtifactTypesConstraint } from './qa-review-artifact.dto';
import { TASK_TITLE_MAX_LENGTH } from '../../tasks/task-title.constants';

// One ticket within the optional "Create linked defect(s)" step on a QA
// rejection (TaskQaReviewsService.reject()) - reuses
// TasksService.createDefect(), not a new ticket type. Project/Module/Phase
// are deliberately not here: they're inherited from the parent task being
// rejected, same project/module/phase the work already lives under, so QA
// never re-picks them. Assignee is required, same as the standalone Create
// Defect form (CreateDefectTaskDto) - a linked defect always goes straight
// to a Developer, never sits unassigned. Artifacts are NOT per-item here -
// the whole batch shares one set, see QaRejectTaskDto.linkedDefectArtifacts.
export class RejectLinkedDefectDto {
  @IsString()
  @MinLength(1, { message: 'Linked defect title is required.' })
  @MaxLength(TASK_TITLE_MAX_LENGTH, { message: `Title must be ${TASK_TITLE_MAX_LENGTH} characters or fewer.` })
  title: string;

  @IsString()
  @MinLength(1, { message: 'Linked defect description is required.' })
  description: string;

  @IsInt()
  assigneeUserId: number;
}

export class QaRejectTaskDto {
  @IsString()
  @MinLength(1, { message: 'A comment explaining the rejection is required.' })
  comment: string;

  // Optional, same as QaApproveTaskDto's artifacts field - QA can justify
  // a rejection with evidence (e.g. a Bug Report link) but isn't required
  // to.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QaReviewArtifactDto)
  @Validate(UniqueQaArtifactTypesConstraint)
  artifacts?: QaReviewArtifactDto[];

  // Optional alongside the plain reject-with-comments flow above - QA can
  // still reject with just a comment for a minor issue that doesn't need
  // a tracked ticket. When present, TaskQaReviewsService.reject() files one
  // Defect (ProjectTask.parentTaskId = this task) per entry via
  // TasksService.createDefect(), which then blocks this task from being
  // resubmitted for QA until every one of those defects resolves (see
  // TasksService.assertNoOpenLinkedDefects()). Open-ended - no cap on how
  // many defects one rejection can spin off.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RejectLinkedDefectDto)
  linkedDefects?: RejectLinkedDefectDto[];

  // One shared set of evidence artifacts applied to every entry in
  // linkedDefects above, rather than picked separately per defect - QA
  // rejects with one artifact (e.g. one failing test-run recording) that's
  // the reason for several distinct defects. There's no schema concept of
  // many defects referencing one shared artifact row, so this is copied
  // into each new defect's own task_defect_artifacts rows by
  // TaskQaReviewsService.reject() - same one-artifact-row-per-parent shape
  // every other artifact table in this app already uses.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QaReviewArtifactDto)
  @Validate(UniqueQaArtifactTypesConstraint)
  linkedDefectArtifacts?: QaReviewArtifactDto[];
}
