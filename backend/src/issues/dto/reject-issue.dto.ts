import { IsOptional, IsString } from 'class-validator';

export class RejectIssueDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
