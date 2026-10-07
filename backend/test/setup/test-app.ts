import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { createValidationPipe } from '../../src/validation-pipe';
import { StorageService } from '../../src/storage/storage.service';
import { MemoryStorage } from './memory-storage';
import { assertTestDatabase } from './test-db-config';

// The real backend (AppModule, every module and guard), pointed at the
// throwaway test database by test/setup/env.ts.
export async function createTestApp() {
  // File storage is always the in-memory stand-in - never the real bucket.
  const storage = new MemoryStorage();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StorageService).useValue(storage).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.useGlobalPipes(createValidationPipe()); // same as main.ts
  const dataSource = app.get(DataSource);
  assertTestDatabase(dataSource.options as any);
  await app.init();
  const jwt = app.get(JwtService);
  // Same payload shape AuthService issues at login.
  const tokenFor = (user: { id: number; email: string; tenantId: number }) =>
    jwt.sign({ sub: user.id, email: user.email, tenantId: user.tenantId });
  return { app, dataSource, jwt, tokenFor, storage };
}
