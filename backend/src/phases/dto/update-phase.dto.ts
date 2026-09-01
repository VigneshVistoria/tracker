import { IsString, MinLength, IsOptional } from 'class-validator';

export class UpdatePhaseDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  name?: string;
}
