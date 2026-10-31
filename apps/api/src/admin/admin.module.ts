import { Module } from '@nestjs/common';
import { RunsModule } from '../runs/runs.module';
import { AdminReadService } from './admin-read.service';
import { AdminGuard } from '../auth/admin.guard';
import { Admin2faService } from './admin-2fa.service';
import { AdminOrBootstrapGuard } from './admin-or-bootstrap.guard';
import { AdminController } from './admin.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [RunsModule],
  controllers: [AdminController],
  providers: [Admin2faService, AdminReadService, AuditService, AdminGuard, AdminOrBootstrapGuard],
  exports: [AuditService],
})
export class AdminModule {}
