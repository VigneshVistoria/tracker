import { IsString, MinLength, MaxLength, IsOptional, IsDateString } from 'class-validator';

// Project is fixed once a Release is created - its rows are tickets from
// that Project.
export class UpdateReleaseDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'App Name is required.' })
  @MaxLength(200)
  appName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Version is required.' })
  @MaxLength(100)
  version?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Release Date must be a valid date.' })
  releaseDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  artifacts?: string;
}
