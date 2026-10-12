import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

// Shared reason rule for every way into Junk - required, trimmed, short.
export const JUNK_REASON_MIN = 3;
export const JUNK_REASON_MAX = 500;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class JunkReasonDto {
  @Transform(trim)
  @IsString()
  @MinLength(JUNK_REASON_MIN, { message: `Enter a reason (at least ${JUNK_REASON_MIN} characters).` })
  @MaxLength(JUNK_REASON_MAX)
  reason: string;
}

export class BulkMarkJunkDto extends JunkReasonDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  taskIds: number[];
}
