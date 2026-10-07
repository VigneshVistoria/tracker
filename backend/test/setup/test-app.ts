import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { assertTestDatabase } from './test-db-config';

// The real backend (AppModule, every module and guard), pointed at the
// throwaway test database by test/setup/env.ts.
export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  const dataSource = app.get(DataSource);
  assertTestDatabase(dataSource.options as any);
  await app.init();
  const jwt = app.get(JwtService);
  // Same payload shape AuthService issues at login.
  const tokenFor = (user: { id: number; email: string; tenantId: number }) =>
    jwt.sign({ sub: user.id, email: user.email, tenantId: user.tenantId });
  return { app, dataSource, jwt, tokenFor };
}
