import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JdsController } from './jds.controller';
import { JdsService } from './jds.service';

@Module({
  imports: [AuthModule],
  controllers: [JdsController],
  providers: [JdsService],
})
export class JdsModule {}
