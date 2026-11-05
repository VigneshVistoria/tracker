import { IsBoolean } from 'class-validator';

// Dependency tasks per-project switch (2026-11-05) - Admin or Program Manager.
export class SetDependencyTasksSwitchDto {
  @IsBoolean()
  enabled: boolean;
}
