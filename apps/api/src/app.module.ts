import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { AuthModule } from './auth/auth.module';
import { ProfilesModule } from './profiles/profiles.module';
import { JdsModule } from './jds/jds.module';
import { RunsModule } from './runs/runs.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RateLimitModule,
    AuthModule,
    ProfilesModule,
    JdsModule,
    RunsModule,
    AdminModule,
  ],
})
export class AppModule {}
