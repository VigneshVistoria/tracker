import { IsIn, IsISO8601 } from 'class-validator';

export class GenerateKpiPeriodDto {
  @IsIn(['daily', 'weekly', 'monthly'])
  periodType: 'daily' | 'weekly' | 'monthly';

  // Any date within the target period - the service resolves it to that
  // period's actual start/end (matches WeeklyReportsService.generate()'s
  // own "any date in the week" convention).
  @IsISO8601()
  referenceDate: string;
}
