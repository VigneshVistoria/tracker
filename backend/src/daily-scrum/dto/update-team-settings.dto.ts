import { IsOptional, IsString, Matches } from 'class-validator';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Every field optional - only what's sent changes. The time zone name is
// checked against Node's time zone data in DailyScrumService, and
// workdayStart must stay before workdayEnd.
export class UpdateTeamSettingsDto {
  @IsOptional()
  @IsString()
  timeZone?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'Working hours start must be a time like 07:30.' })
  workdayStart?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'Working hours end must be a time like 15:30.' })
  workdayEnd?: string;
}
