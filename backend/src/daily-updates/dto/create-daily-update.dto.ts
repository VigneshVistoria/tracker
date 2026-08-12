import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateDailyUpdateDto {
  @IsOptional()
  @IsDateString()
  date?: string; // defaults to today if omitted

  @IsOptional()
  @IsString()
  completedText?: string;

  @IsOptional()
  @IsString()
  pendingText?: string;

  @IsOptional()
  @IsString()
  blockersText?: string;
}
