import { IsArray, ArrayMaxSize, IsString } from 'class-validator';

export class UpdateTemplateColumnOrderDto {
  // Column keys in display order - built-in column names and 'cf:<id>'.
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  columnOrder: string[];
}
