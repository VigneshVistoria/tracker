import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { COUNTRIES, Country } from '../work-calendar';

// Time zone, hours and weekend are checked in the service (calendarProblem).
export class SetPersonCalendarDto {
  @IsString()
  @MaxLength(60)
  timeZone: string;

  @IsString()
  @MaxLength(5)
  workStart: string;

  @IsString()
  @MaxLength(5)
  workEnd: string;

  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  weekendDays: number[];

  @IsOptional()
  @IsIn([...COUNTRIES, null])
  country?: Country | null;
}

export class AddLeaveDto {
  @IsInt()
  userId: number;

  @IsDateString({ strict: true })
  startDate: string;

  @IsDateString({ strict: true })
  endDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AddCountryHolidayDto {
  @IsIn(COUNTRIES)
  country: Country;

  @IsDateString({ strict: true })
  date: string;

  @IsString()
  @MaxLength(200)
  name: string;
}
