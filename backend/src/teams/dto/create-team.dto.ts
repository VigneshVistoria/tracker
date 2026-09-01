import { IsString, MinLength, IsOptional } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
