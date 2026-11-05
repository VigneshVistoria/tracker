import { JunkReasonDto } from '../../tasks/dto/mark-junk.dto';

// Dependency tasks Stage 3: Cancel and Reopen both need a reason - the same
// rule as Junk (a cancelled ticket's task goes to Junk with this reason).
export class DependencyTicketReasonDto extends JunkReasonDto {}
