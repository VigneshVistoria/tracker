import { IsString, MinLength, MaxLength, IsInt, IsOptional, IsDateString } from 'class-validator';

export class CreateReleaseDto {
  @IsInt()
  projectId: number;

  @IsString()
  @MinLength(1, { message: 'App Name is required.' })
  @MaxLength(200)
  appName: string;

  @IsString()
  @MinLength(1, { message: 'Version is required.' })
  @MaxLength(100)
  version: string;

  @IsDateString({}, { message: 'Release Date must be a valid date.' })
  releaseDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  artifacts?: string;
}
