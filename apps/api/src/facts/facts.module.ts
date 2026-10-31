import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FactsController } from './facts.controller';
import { FactsService } from './facts.service';

@Module({
  imports: [AuthModule],
  controllers: [FactsController],
  providers: [FactsService],
})
export class FactsModule {}
