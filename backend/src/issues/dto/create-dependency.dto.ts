import { IsString, MinLength, IsOptional, IsInt } from 'class-validator';

export class CreateDependencyDto {
  @IsString()
  @MinLength(1, { message: 'Title is required' })
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  // The "dependency owner" - any user, same as a normal assignee.
  @IsInt()
  assigneeUserId: number;

  // Defaults to the parent issue's project if not provided.
  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsInt()
  storyPoints?: number;
}
