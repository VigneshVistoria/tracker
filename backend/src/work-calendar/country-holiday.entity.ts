import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { Country } from './work-calendar';

// B4 - a holiday in one country (entered by the PM).
@Entity('country_holidays')
export class CountryHoliday {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column({ type: 'varchar', length: 20 })
  country: Country;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column()
  createdByUserId: number;

  @Column({ type: 'timestamp', default: () => 'now()' })
  createdAt: Date;
}
