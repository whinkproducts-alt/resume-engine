// apps/api/src/facts/facts.controller.ts
import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/auth.types';
import {
  CreateFactDto, ImportFromBaseDto, ListFactsQuery, UpdateFactDto, VerifyFactsDto,
} from './dto/fact.dto';
import { FactsService } from './facts.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class FactsController {
  constructor(private readonly facts: FactsService) {}

  @Get('profiles/:id/facts')
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: ListFactsQuery) {
    return this.facts.list(user, id, q);
  }

  @Post('profiles/:id/facts')
  create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateFactDto) {
    return this.facts.create(user, id, dto);
  }

  @Post('profiles/:id/facts/verify')
  @HttpCode(200)
  verify(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyFactsDto) {
    return this.facts.verify(user, id, dto.factIds);
  }

  @Post('profiles/:id/facts/import-from-base')
  importFromBase(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImportFromBaseDto,
  ) {
    return this.facts.importFromBase(user, id, dto.baseResumeId);
  }

  @Patch('facts/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFactDto) {
    return this.facts.update(user, id, dto);
  }

  @Delete('facts/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.facts.remove(user, id);
  }
}
