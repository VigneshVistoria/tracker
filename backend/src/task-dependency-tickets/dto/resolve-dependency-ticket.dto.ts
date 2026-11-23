import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DEPENDENCY_RESOLUTION_NOTE_MAX_LENGTH } from '../dependency-attachments';

// Dependency attachments (2026-11-13): Resolve's optional note - JSON, or a
// multipart field alongside the "files" (only with the project's
// attachments switch on; checked in the service).
export class ResolveDependencyTicketDto {
  @IsOptional()
  @IsString()
  @MaxLength(DEPENDENCY_RESOLUTION_NOTE_MAX_LENGTH, {
    message: `The resolution note must be ${DEPENDENCY_RESOLUTION_NOTE_MAX_LENGTH} characters or fewer.`,
  })
  note?: string;

  // Optional "Hours spent" (2026-11-23) - saved as the linked dependency
  // task's actualHours, since Resolve skips QA submit (the usual place
  // actualHours is entered). @Type: multipart sends it as a string.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Hours spent must be a number.' })
  @Min(0, { message: 'Hours spent must be zero or more.' })
  @Max(999.99, { message: 'Hours spent must be 999.99 or less.' })
  hoursSpent?: number;
}
