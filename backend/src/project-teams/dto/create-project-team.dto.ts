import { IsString, MinLength, IsInt, IsOptional, IsIn } from 'class-validator';
import { PROJECT_TEAM_STATUSES, ProjectTeamStatus } from '../project-team.entity';

export class CreateProjectTeamDto {
  @IsInt()
  projectId: number;

  @IsString()
  @MinLength(1, { message: 'Team name is required.' })
  name: string;

  @IsOptional()
  @IsIn(PROJECT_TEAM_STATUSES)
  status?: ProjectTeamStatus;
}
