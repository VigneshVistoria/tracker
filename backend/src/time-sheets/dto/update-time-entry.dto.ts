import { IsOptional, IsString, IsDateString, IsNumber, Min, Max } from 'class-validator';

// Deliberately excludes issueId/projectId - re-pointing an entry at a
// different ticket/project would need to re-run the one-of validation
// and re-derive the denormalized project fields, which is simpler to get
// right by deleting and re-creating the entry instead.
export class UpdateTimeEntryDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.25, { message: 'Hours must be at least 0.25' })
  @Max(24, { message: 'Hours can’t exceed 24 in a single entry' })
  hours?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
