import { IsString, MinLength, MaxLength } from 'class-validator';

export class GenerateUserStoryDto {
  @IsString()
  @MinLength(3, { message: 'Give at least a few words to work with' })
  @MaxLength(200, { message: 'Keep the keyword/phrase short - this is a starting point, not the full spec' })
  keyword: string;
}
