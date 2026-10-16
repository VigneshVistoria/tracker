import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// "Waiting on the city office" - add one. Only title and requestedOn are
// required; party defaults to 'City office'.
export class CreateExternalWaitDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Say what the team is waiting for.' })
  @MaxLength(200)
  title: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  party?: string;

  @IsOptional()
  @IsInt()
  taskId?: number | null;

  @IsOptional()
  @IsInt()
  followUpUserId?: number | null;

  @Matches(YMD, { message: 'Requested on must be a date like 2026-10-16.' })
  requestedOn: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(YMD, { message: 'Expected by must be a date like 2026-10-20.' })
  expectedBy?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

// Edit or resolve/reopen - only what's sent changes. null clears an
// optional field.
export class UpdateExternalWaitDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Say what the team is waiting for.' })
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Say who the team is waiting on.' })
  @MaxLength(120)
  party?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  taskId?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  followUpUserId?: number | null;

  @IsOptional()
  @Matches(YMD, { message: 'Requested on must be a date like 2026-10-16.' })
  requestedOn?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(YMD, { message: 'Expected by must be a date like 2026-10-20.' })
  expectedBy?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @IsOptional()
  @IsIn(['open', 'resolved'])
  status?: 'open' | 'resolved';
}
