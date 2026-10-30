import { IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

// Q5 - see ../tech-reviews.ts. Scores are checked against the rubric in
// the service.
export class ListTechReviewsDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}

export class UpdateTechReviewDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  itemTitle?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  taskId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  itemLink?: string | null;

  @IsOptional()
  @IsObject()
  scores?: Record<string, number>;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string | null;
}

export class CreateTechReviewDto {
  @IsInt()
  revieweeUserId: number;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month: string;

  // Needed when no task is given (the task's project is used otherwise).
  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  itemTitle: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  taskId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  itemLink?: string | null;

  @IsObject()
  scores: Record<string, number>;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string | null;
}

export class AddTechReviewEvidenceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  note: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  link?: string;
}
