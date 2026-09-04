import { IsInt, IsString, MinLength } from 'class-validator';

export class CreateTaskDependencyTicketDto {
  @IsInt()
  parentTaskId: number;

  @IsString()
  @MinLength(1, { message: 'Dependency Description is required.' })
  description: string;

  @IsInt()
  ownerUserId: number;
}
