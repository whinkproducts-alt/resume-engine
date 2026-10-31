import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { AuthModule } from './auth/auth.module';
import { ProfilesModule } from './profiles/profiles.module';
import { JdsModule } from './jds/jds.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RateLimitModule,
    AuthModule,
    ProfilesModule,
    JdsModule,
  ],
})
export class AppModule {}
