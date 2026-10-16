import { IsInt } from 'class-validator';

// See TaskDependencyTicketsService.changeOwner() for who may change it
// and which owners are allowed.
export class ChangeTaskDependencyTicketOwnerDto {
  @IsInt()
  ownerUserId: number;
}
