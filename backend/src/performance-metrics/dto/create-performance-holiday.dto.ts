import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreatePerformanceHolidayDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be like 2027-01-07.' })
  date: string;

  @IsString()
  @IsNotEmpty({ message: 'Give the holiday a name.' })
  @MaxLength(120)
  name: string;
}
