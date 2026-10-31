// apps/api/src/routes/runs.ts
// Stage 8 endpoints:
//   GET /runs/:id/output
//   GET /runs/:id/validation
//   GET /runs/:id/docx   -> signed S3/R2 URL
//   GET /runs/:id/pdf    -> signed S3/R2 URL

import { Router, Request, Response, NextFunction } from 'express';
import type { ValidationResult } from '@resume-engine/rules';
import type { ArtifactStore } from '@resume-engine/storage';
import { artifactKeys } from '@resume-engine/storage';

export interface RunArtifacts {
  docxKey?: string;
  pdfKey?: string;
  docxSize?: number;
  pdfSize?: number;
  pageCount?: number;
  generatedAt?: string;
}

export interface RunRecord {
  id: string;
  status: 'queued' | 'generating' | 'validating' | 'rendering'
        | 'exporting' | 'succeeded' | 'failed' | 'needs_review';
  attempts: number;
  fileName: string;
  slug: string;
  targetRole: string;
  createdAt: string;
  updatedAt: string;
  artifacts: RunArtifacts;
  validation?: ValidationResult;
  error?: { code: string; message: string } | null;
  ownerId: string;
}

export interface RunRepository {
  findById(id: string): Promise<RunRecord | null>;
}

export interface RunsRouterDeps {
  runs: RunRepository;
  store: ArtifactStore;
  /** 404/500 helper kept explicit for testability. */
  logger?: { error: (msg: string, meta?: unknown) => void };
}

class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'ERROR') {
    super(message);
  }
}

export function createRunsRouter(deps: RunsRouterDeps): Router {
  const router = Router();
  const { runs, store, logger } = deps;

  async function loadRun(req: Request, res: Response): Promise<RunRecord | null> {
    const { id } = req.params;
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) {
      res.status(400).json({ error: { code: 'INVALID_RUN_ID', message: 'Bad run id.' } });
      return null;
    }
    const run = await runs.findById(id);
    if (!run) {
      res.status(404).json({ error: { code: 'RUN_NOT_FOUND', message: `Run ${id} not found.` } });
      return null;
    }
    if (!req.auth?.userId || req.auth.userId !== run.ownerId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not your run.' } });
      return null;
    }
    return run;
  }

  /* ------------------------------ GET /output ------------------------------ */

  router.get('/:id/output', async (req, res, next) => {
    try {
      const run = await loadRun(req, res);
      if (!run) return;

      const keys = artifactKeys(run.id, run.slug);
      const [docx, pdf] = await Promise.all([
        run.artifacts.docxKey
          ? store.ref(run.artifacts.docxKey, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', run.artifacts.docxSize ?? 0)
          : null,
        run.artifacts.pdfKey
          ? store.ref(run.artifacts.pdfKey, 'application/pdf', run.artifacts.pdfSize ?? 0)
          : null,
      ]);

      res.json({
        runId: run.id,
        status: run.status,
        attempts: run.attempts,
        fileName: run.fileName,
        targetRole: run.targetRole,
        generatedAt: run.artifacts.generatedAt ?? run.updatedAt,
        pageCount: run.artifacts.pageCount ?? null,
        validationSummary: run.validation
          ? {
              passed: run.validation.passed,
              blocking: run.validation.blockingFailures.length,
              warnings: run.validation.warnings.length,
              attempts: run.validation.attempt,
            }
          : null,
        artifacts: {
          docx: docx ?? null,
          pdf: pdf ?? null,
          validation: `${req.baseUrl}/${run.id}/validation`,
        },
        keys,
        error: run.error ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  /* ---------------------------- GET /validation ---------------------------- */

  router.get('/:id/validation', async (req, res, next) => {
    try {
      const run = await loadRun(req, res);
      if (!run) return;

      if (!run.validation) {
        res.status(409).json({
          error: {
            code: 'VALIDATION_NOT_READY',
            message: 'Validation has not completed for this run yet.',
          },
          status: run.status,
        });
        return;
      }

      const v = run.validation;
      const includeRules = req.query.rules === '1' || req.query.rules === 'true';
      const severity = String(req.query.severity ?? '').toLowerCase();

      let flags = v.flags;
      if (['error', 'warn', 'info'].includes(severity)) {
        flags = flags.filter((f) => f.severity === severity);
      }
      if (req.query.rule) {
        const rid = String(req.query.rule).toUpperCase();
        flags = flags.filter((f) => f.ruleId === rid);
      }

      res.json({
        runId: run.id,
        attempt: v.attempt,
        passed: v.passed,
        requiresRetry: v.requiresRetry,
        evaluatedAt: v.evaluatedAt,
        counts: {
          total: v.flags.length,
          blocking: v.blockingFailures.length,
          warnings: v.warnings.length,
          infos: v.infos.length,
        },
        blockingFailures: v.blockingFailures,
        warnings: v.warnings,
        infos: v.infos,
        flags,
        ...(includeRules ? { ruleResults: v.ruleResults } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  /* ------------------------------ GET /docx -------------------------------- */

  router.get('/:id/docx', async (req, res, next) => {
    try {
      const run = await loadRun(req, res);
      if (!run) return;

      if (!run.artifacts.docxKey) {
        res.status(409).json({
          error: { code: 'DOCX_NOT_READY', message: 'DOCX artifact is not available.' },
          status: run.status,
        });
        return;
      }

      const ref = await store.ref(
        run.artifacts.docxKey,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        run.artifacts.docxSize ?? 0,
      );

      if (req.query.redirect === '1') {
        res.redirect(302, ref.url);
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(ref);
    } catch (err) {
      next(err);
    }
  });

  /* ------------------------------- GET /pdf -------------------------------- */

  router.get('/:id/pdf', async (req, res, next) => {
    try {
      const run = await loadRun(req, res);
      if (!run) return;

      if (!run.artifacts.pdfKey) {
        res.status(409).json({
          error: { code: 'PDF_NOT_READY', message: 'PDF artifact is not available.' },
          status: run.status,
        });
        return;
      }

      const ref = await store.ref(
        run.artifacts.pdfKey, 'application/pdf', run.artifacts.pdfSize ?? 0,
      );

      if (req.query.redirect === '1') {
        res.redirect(302, ref.url);
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(ref);
    } catch (err) {
      next(err);
    }
  });

  /* ------------------------------- error sink ------------------------------ */

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    logger?.error('runs route failure', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected error.' },
    });
  });

  return router;
}
