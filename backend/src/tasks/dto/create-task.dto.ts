import { IsString, MinLength, IsInt } from 'class-validator';

// Stage 1 (Task Backlog creation, Program Manager only) - deliberately
// just the Project -> Module -> Phase chain plus Description. No
// Assignee/Estimated Hours/Due Date here anymore - those are entered at
// later stages (assignment, then the Assignee's own My Tasks entry) via
// PATCH /tasks/:id/assign and PATCH /tasks/:id.
export class CreateTaskDto {
  @IsInt()
  projectId: number;

  @IsInt()
  moduleId: number;

  @IsInt()
  phaseId: number;

  @IsString()
  @MinLength(1, { message: 'Task description is required.' })
  description: string;
}
