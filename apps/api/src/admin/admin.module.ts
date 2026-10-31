import { Module } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { Admin2faService } from './admin-2fa.service';
import { AdminOrBootstrapGuard } from './admin-or-bootstrap.guard';
import { AdminController } from './admin.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AdminController],
  providers: [Admin2faService, AuditService, AdminGuard, AdminOrBootstrapGuard],
  exports: [AuditService],
})
export class AdminModule {}
