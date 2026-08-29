import { IsString, IsEmail, IsOptional, MinLength, Matches } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(1, { message: 'Name is required' })
  name: string;

  // Lowercase letters, numbers, and hyphens only, no leading/trailing
  // hyphen - matches what's actually usable as a DNS label once Phase D's
  // wildcard is live.
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message: 'Subdomain must be lowercase letters, numbers, and hyphens only (no leading/trailing hyphen)',
  })
  subdomain: string;

  @IsEmail()
  adminEmail: string;

  @IsOptional()
  @IsString()
  adminFullName?: string;
}
