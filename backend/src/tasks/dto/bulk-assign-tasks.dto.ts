import { IsArray, ArrayNotEmpty, IsInt } from 'class-validator';

export class BulkAssignTasksDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  taskIds: number[];

  @IsInt()
  assigneeUserId: number;
}
