import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { RELEASE_KINDS } from '../github-releases';

// P1/P2 from GitHub - the switch and task key prefix. Values are checked
// again in the service.
export class UpdateGithubSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  taskKeyPrefix?: string;

  @IsOptional()
  @IsBoolean()
  prHelpersEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  prHelperProjectIds?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(30)
  branchPrefix?: string;
}

// A repository mapping (create: repoFullName, projectId and appName
// required; update: any of them).
export class RepoMappingDto {
  @IsOptional()
  @IsString()
  @MaxLength(250)
  repoFullName?: string;

  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  appName?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stagingEnvironments?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productionEnvironments?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deployWorkflows?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stagingBranches?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productionBranches?: string[];

  @IsOptional()
  @IsIn(RELEASE_KINDS as unknown as string[])
  publishedReleaseIs?: string;

  @IsOptional()
  @IsIn(RELEASE_KINDS as unknown as string[])
  preReleaseIs?: string;
}
