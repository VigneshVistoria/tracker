import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail } from 'class-validator';

export class EmailReleaseDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one recipient.' })
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true, message: 'Each recipient must be a valid email address.' })
  recipients: string[];
}
