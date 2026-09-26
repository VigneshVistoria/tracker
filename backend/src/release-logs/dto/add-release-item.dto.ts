import { IsInt } from 'class-validator';

export class AddReleaseItemDto {
  @IsInt()
  taskId: number;
}
