import { IsString, IsOptional } from 'class-validator';

export class AnalyzeIssueDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
