import { IsNumber, Max, Min } from 'class-validator';

// PATCH /tasks/:id/actual-hours (2026-11-23) - Actual hours on a Closed
// task or a dependency task at Pass, neither of which went through QA
// submit (the usual place it's entered). Rules live in
// TasksService.setActualHours().
export class SetActualHoursDto {
  @IsNumber({}, { message: 'Actual hours must be a number.' })
  @Min(0, { message: 'Actual hours must be zero or more.' })
  @Max(999.99, { message: 'Actual hours must be 999.99 or less.' })
  actualHours: number;
}
