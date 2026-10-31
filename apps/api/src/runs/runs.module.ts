import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuotaService } from './quota.service';
import { QueueService } from './queue.service';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';
import { StorageService } from './storage.service';

@Module({
  imports: [AuthModule],
  controllers: [RunsController],
  providers: [RunsService, QuotaService, QueueService, StorageService],
  exports: [QuotaService, QueueService],
})
export class RunsModule {}
