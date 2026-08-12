import { IsString, IsOptional, IsInt } from 'class-validator';

export class ConnectTeamsChannelDto {
  @IsString()
  teamId: string;

  @IsString()
  channelId: string;

  @IsOptional()
  @IsString()
  channelName?: string;

  @IsOptional()
  @IsInt()
  projectId?: number;
}
