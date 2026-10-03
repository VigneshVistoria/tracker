import { IsInt } from 'class-validator';

export class LinkBlockingDefectDto {
  @IsInt()
  defectId: number;
}
