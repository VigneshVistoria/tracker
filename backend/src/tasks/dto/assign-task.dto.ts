import { IsInt } from 'class-validator';

export class AssignTaskDto {
  @IsInt()
  assigneeUserId: number;
}
