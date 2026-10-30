import { IsString, MinLength, MaxLength, IsOptional, IsDateString, IsInt } from 'class-validator';

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

  // Performance Tracking P1/P2 (release-path.ts). null clears a field.
  @IsOptional()
  @IsInt()
  releasedByUserId?: number | null;

  @IsOptional()
  @IsDateString({}, { message: 'Staging sign-off date must be a valid date.' })
  stagingSignedOffOn?: string | null;

  @IsOptional()
  @IsInt()
  stagingSignedOffByUserId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  changeTicketRef?: string | null;
}
