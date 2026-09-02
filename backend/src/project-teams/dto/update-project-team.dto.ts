import { IsString, MinLength, IsOptional, IsIn } from 'class-validator';
import { PROJECT_TEAM_STATUSES, ProjectTeamStatus } from '../project-team.entity';

export class UpdateProjectTeamDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Team name is required.' })
  name?: string;

  @IsOptional()
  @IsIn(PROJECT_TEAM_STATUSES)
  status?: ProjectTeamStatus;
}
