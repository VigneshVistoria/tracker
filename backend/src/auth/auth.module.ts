import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GuardsModule } from '../common/guards.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AuditModule } from '../audit/audit.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshSession } from './refresh-session.entity';
import { SessionService } from './session.service';

@Module({
  imports: [UsersModule, GuardsModule, TenantsModule, AuditModule, TypeOrmModule.forFeature([RefreshSession])],
  controllers: [AuthController],
  providers: [AuthService, SessionService],
  exports: [AuthService],
})
export class AuthModule {}
