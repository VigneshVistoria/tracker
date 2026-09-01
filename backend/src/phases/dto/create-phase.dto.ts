import { IsString, MinLength, IsInt } from 'class-validator';

export class CreatePhaseDto {
  @IsInt()
  moduleId: number;

  @IsString()
  @MinLength(1, { message: 'Name is required.' })
  name: string;
}
