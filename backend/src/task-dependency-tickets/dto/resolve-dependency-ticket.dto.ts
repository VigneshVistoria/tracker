import { IsOptional, IsString, MaxLength } from 'class-validator';
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
}
