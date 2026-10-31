// apps/api/src/runs/runs.controller.ts
// 01-SPEC-v3.md section 7.7. Ports the Express routes from Part 3
// (output, validation, docx, pdf) into NestJS and adds the run lifecycle.

import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, Sse,
  UseGuards, type MessageEvent,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, distinctUntilChanged, exhaustMap, from, map, takeUntil, takeWhile, timer } from 'rxjs';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { ConfirmCompanyDto, CreateRunDto } from './dto/create-run.dto';
import { ListRunsQuery } from './dto/list-runs.dto';
import { RunsService, isTerminal } from './runs.service';

@Controller('runs')
@UseGuards(JwtAuthGuard)
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Post()
  @HttpCode(202)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRunDto) {
    return this.runs.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListRunsQuery) {
    return this.runs.list(user, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.get(user, id);
  }

  /** Server sent events. Ends when the run reaches a terminal state, or after 10 minutes. */
  @Sse(':id/events')
  events(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Observable<MessageEvent> {
    return timer(0, 1000).pipe(
      exhaustMap(() => from(this.runs.progress(user, id))),
      distinctUntilChanged((a, b) => a.status === b.status && a.stage === b.stage && a.progress === b.progress),
      takeWhile((p) => !isTerminal(p.status), true),
      takeUntil(timer(10 * 60 * 1000)),
      map((p) => ({ data: p }) as MessageEvent),
    );
  }

  @Post(':id/confirm-company')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmCompanyDto,
  ) {
    return this.runs.confirmCompany(user, id, dto.companyName);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.cancel(user, id);
  }

  @Post(':id/retry')
  @HttpCode(202)
  retry(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.retry(user, id);
  }

  @Get(':id/output')
  output(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.output(user, id);
  }

  @Get(':id/validation')
  validation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.validation(user, id);
  }

  /** `?redirect=1` answers 302 to the signed URL; the default is JSON { url, expiresAt }. */
  @Get(':id/docx')
  async docx(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('redirect') redirect: string | undefined,
    @Res() res: Response,
  ) {
    return this.send(res, await this.runs.artifact(user, id, 'docx'), redirect);
  }

  @Get(':id/pdf')
  async pdf(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('redirect') redirect: string | undefined,
    @Res() res: Response,
  ) {
    return this.send(res, await this.runs.artifact(user, id, 'pdf'), redirect);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.runs.remove(user, id);
  }

  private send(res: Response, ref: { url: string; expiresAt: string }, redirect?: string) {
    res.setHeader('Cache-Control', 'no-store');
    if (redirect === '1') return res.redirect(302, ref.url);
    return res.json(ref);
  }
}
