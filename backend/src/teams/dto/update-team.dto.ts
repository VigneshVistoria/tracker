import { IsString, MinLength, IsOptional } from 'class-validator';

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
