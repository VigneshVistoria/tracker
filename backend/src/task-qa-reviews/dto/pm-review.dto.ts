import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// PM review gate (2026-10-13). Comments are rich text (sanitized server-
// side); the send-back comment is required, the send-to-QA one optional.
export class PmSendToQaDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  comment?: string;
}

export class PmSendBackDto {
  @IsString()
  @MinLength(1, { message: 'Feedback for the developer is required.' })
  @MaxLength(20000)
  comment: string;
}

export class SetPmReviewSwitchDto {
  @IsBoolean()
  enabled: boolean;
}
