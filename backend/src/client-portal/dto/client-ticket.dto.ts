import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { CLIENT_TICKET_CATEGORIES, CLIENT_TICKET_PRIORITIES, CLIENT_TICKET_SEVERITIES } from '../client-ticket.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// What a client may send when raising a ticket. The client, project and
// ticket number are never accepted from the request - the backend takes
// them from the caller's own company (ClientTicketsService.create).
export class CreateClientTicketDto {
  @IsIn(CLIENT_TICKET_CATEGORIES)
  category: string;

  @IsIn(CLIENT_TICKET_SEVERITIES)
  severity: string;

  @IsIn(CLIENT_TICKET_PRIORITIES)
  priority: string;

  @IsInt()
  moduleId: number;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Title is required' })
  @MaxLength(120)
  title: string;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Description is required' })
  @MaxLength(10000)
  description: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(10000)
  stepsToReproduce?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(10000)
  expectedResult?: string;
}

export class CreateClientTicketCommentDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Reply is required' })
  @MaxLength(5000)
  body: string;

  // Team-only note. Refused for client users.
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}

// Team only. Stage 2 statuses a team member can set; 'submitted' is the
// starting state and 'waiting_client' arrives with Request info (Stage 4).
export const TEAM_SETTABLE_STATUSES = ['in_progress', 'client_review', 'closed'] as const;

export class UpdateClientTicketDto {
  @IsOptional()
  @IsIn(TEAM_SETTABLE_STATUSES)
  status?: string;

  // null = unassign. Must be on the ticket's client team.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  assigneeUserId?: number | null;
}
