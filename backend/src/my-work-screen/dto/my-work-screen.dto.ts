import { ArrayMaxSize, IsArray, IsBoolean, IsInt } from 'class-validator';
import { PILOT_USERS_MAX } from '../my-work-screen';

export class SaveMyWorkScreenDto {
  @IsBoolean()
  enabled: boolean;

  @IsArray()
  @ArrayMaxSize(PILOT_USERS_MAX)
  @IsInt({ each: true })
  pilotUserIds: number[];
}
