import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GuardsModule } from '../common/guards.module';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [UsersModule, GuardsModule, TenantsModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
