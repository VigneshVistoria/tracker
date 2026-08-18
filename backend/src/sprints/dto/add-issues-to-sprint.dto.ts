import { IsArray, IsInt } from 'class-validator';

export class AddIssuesToSprintDto {
  @IsArray()
  @IsInt({ each: true })
  issueIds: number[];
}
