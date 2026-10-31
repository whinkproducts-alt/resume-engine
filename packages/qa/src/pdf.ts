// packages/qa/src/pdf.ts
// Stage 8 — LibreOffice headless DOCX -> PDF conversion, page counting, QA.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, parse } from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import type { ValidationFlag } from '@resume-engine/rules';

const execFileAsync = promisify(execFile);

export interface PdfQaResult {
  pdf: Buffer;
  pageCount: number;
  overflow: boolean;
  flags: ValidationFlag[];
  conversionMs: number;
}

export interface ConvertOptions {
  /** Path to soffice binary. */
  sofficePath?: string;
  timeoutMs?: number;
  maxPages?: number;
  runId?: string;
}

/** Locates soffice across common Linux/macOS install locations. */
export async function resolveSoffice(explicit?: string): Promise<string> {
  const candidates = [
    explicit,
    process.env.SOFFICE_PATH,
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/opt/libreoffice/program/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  ].filter((c): c is string => Boolean(c));

  for (const c of candidates) {
    try {
      await access(c, FS.X_OK);
      return c;
    } catch { /* try next */ }
  }
  throw new Error(
    'LibreOffice (soffice) not found. Set SOFFICE_PATH or install libreoffice-core.',
  );
}

/**
 * Converts a DOCX buffer to PDF in an isolated temp directory.
 * `--headless --norestore` keeps it safe inside containers.
 */
export async function convertDocxToPdf(
  docx: Buffer,
  opts: ConvertOptions = {},
): Promise<{ pdf: Buffer; conversionMs: number }> {
  const soffice = await resolveSoffice(opts.sofficePath);
  const timeout = opts.timeoutMs ?? 120_000;
  const dir = await mkdtemp(join(tmpdir(), 'resume-qa-'));

  try {
    const docxPath = join(dir, 'input.docx');
    await writeFile(docxPath, docx);

    const started = Date.now();
    await execFileAsync(
      soffice,
      [
        '--headless',
        '--norestore',
        '--nologo',
        '--nolockcheck',
        '--nodefault',
        '--nofirststartwizard',
        `-env:UserInstallation=file://${join(dir, 'lo-profile')}`,
        '--convert-to', 'pdf:writer_pdf_Export',
        '--outdir', dir,
        docxPath,
      ],
      { timeout, maxBuffer: 16 * 1024 * 1024 },
    );
    const conversionMs = Date.now() - started;

    const pdfPath = join(dir, `${parse(basename(docxPath)).name}.pdf`);
    const pdf = await readFile(pdfPath);
    return { pdf, conversionMs };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* noop */ });
  }
}

export async function countPdfPages(pdf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * Full Stage 8 QA: convert, count pages, emit PAGE_OVERFLOW when over budget.
 * PAGE_OVERFLOW is a warning by design (never blocks the run).
 */
export async function runPdfQa(
  docx: Buffer,
  opts: ConvertOptions = {},
): Promise<PdfQaResult> {
  const maxPages = opts.maxPages ?? 3;
  const { pdf, conversionMs } = await convertDocxToPdf(docx, opts);
  const pageCount = await countPdfPages(pdf);
  const overflow = pageCount > maxPages;

  const flags: ValidationFlag[] = [];
  if (overflow) {
    flags.push({
      ruleId: 'R15',
      code: 'PAGE_OVERFLOW',
      severity: 'warn',
      blocking: false,
      message: `Rendered PDF is ${pageCount} pages; limit is ${maxPages}.`,
      path: undefined,
      meta: { pageCount, maxPages, runId: opts.runId, conversionMs },
    });
  }

  return { pdf, pageCount, overflow, flags, conversionMs };
}
