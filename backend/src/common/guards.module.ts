import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';

// Kept as a shared reference so it can be both imported here AND
// re-exported below - modules that import GuardsModule need this
// available too, since AdminGuard depends on it.
const userRepositoryModule = TypeOrmModule.forFeature([User]);

@Module({
  imports: [
    userRepositoryModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '1d') },
      }),
    }),
  ],
  providers: [JwtAuthGuard, AdminGuard],
  exports: [JwtAuthGuard, AdminGuard, JwtModule, userRepositoryModule],
})
export class GuardsModule {}
