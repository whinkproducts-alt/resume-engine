// packages/renderer/src/docx-renderer.ts
// Stage 7: deterministic DOCX rendering with the `docx` npm package.
//
// Layout contract: docs/source-parts/Resume_Engine_Spec_v3.1.txt, Section 6
// ("DOCX layout spec", taken from the working build script) and §6 of
// docs/01-SPEC-v3.md. Single column, Calibri throughout, no tables.
//
//   Page ........ US Letter 12240 x 15840 DXA
//   Margins ..... top 720, right 1008, bottom 720, left 1008 DXA
//   Name ........ 20pt bold, 1F3864, centered
//   Contact ..... 10pt, centered, " | " separated
//   Divider ..... paragraph bottom border, single, size 8, 2E74B5
//   Headline .... line 1: 11pt bold caps centered; line 2: 10pt italic centered
//   Headings .... 11pt bold 1F3864, bottom border size 6 2E74B5, before 180 after 80
//   Body ........ 10pt
//   Company ..... company bold 10.5pt, then " | dates" regular 10pt
//   Role title .. 10pt italic
//   Flagship .... bold, "▸" from the numbering config (never typed), indent 360/360
//   Bullet ...... "•" from the numbering config, indent 360/360
//   Keywords .... 9pt, one paragraph
//
// Agency white-label: BrandingConfig.primaryColor replaces 1F3864, the logo
// sits top right, and footerText becomes the page footer.

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  TextWrappingType,
  VerticalPositionRelativeFrom,
} from 'docx';
import type { ResumeDoc } from '@resume-engine/rules';

export const PAGE_WIDTH_DXA = 12240;
export const PAGE_HEIGHT_DXA = 15840;
export const MARGINS_DXA = { top: 720, right: 1008, bottom: 720, left: 1008 } as const;

export const DEFAULT_ACCENT = '1F3864';
export const RULE_COLOR = '2E74B5';

const FONT = 'Calibri';
/** docx sizes are half points. */
const SIZE = {
  name: 40,        // 20pt
  heading: 22,     // 11pt
  headline1: 22,   // 11pt
  headline2: 20,   // 10pt
  body: 20,        // 10pt
  company: 21,     // 10.5pt
  keywords: 18,    // 9pt
};

const FLAGSHIP_REF = 'resume-flagship';
const BULLET_REF = 'resume-bullet';

export interface BrandingOptions {
  /** Hex colour, with or without '#'. Replaces 1F3864. */
  primaryColor?: string | null;
  /** Shown as the page footer. */
  footerText?: string | null;
  logo?: {
    data: Buffer | Uint8Array;
    type: 'png' | 'jpg' | 'gif' | 'bmp';
    /** Pixels. */
    width: number;
    height: number;
  } | null;
}

export interface RenderOptions {
  /** Provided only when the run owner is on the AGENCY plan. */
  branding?: BrandingOptions | null;
}

export interface RenderedDocx {
  buffer: Buffer;
}

function accentFor(branding?: BrandingOptions | null): string {
  const c = branding?.primaryColor?.trim().replace(/^#/, '');
  return c && /^[0-9a-fA-F]{6}$/.test(c) ? c.toUpperCase() : DEFAULT_ACCENT;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtMonth(v?: string | null): string {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})/.exec(v);
  if (!m) return v;
  const name = MONTHS[Number(m[2]) - 1];
  return name ? `${name} ${m[1]}` : v;
}

/** "Jan 2020 to Present". Words, not dashes, so the prose style rule holds. */
export function formatDateRange(start?: string | null, end?: string | null): string {
  const left = fmtMonth(start);
  const right = !end || /^(present|current|now)$/i.test(end) ? 'Present' : fmtMonth(end);
  return [left, right].filter(Boolean).join(' to ');
}

/* --------------------------------- builders -------------------------------- */

const run = (text: string, o: {
  size?: number; bold?: boolean; italics?: boolean; color?: string; allCaps?: boolean;
} = {}) => new TextRun({
  text,
  font: FONT,
  size: o.size ?? SIZE.body,
  ...(o.bold ? { bold: true } : {}),
  ...(o.italics ? { italics: true } : {}),
  ...(o.color ? { color: o.color } : {}),
  ...(o.allCaps ? { allCaps: true } : {}),
});

function heading(text: string, accent: string): Paragraph {
  return new Paragraph({
    spacing: { before: 180, after: 80 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE_COLOR, space: 1 },
    },
    children: [run(text, { size: SIZE.heading, bold: true, color: accent })],
  });
}

function divider(): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 60 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 8, color: RULE_COLOR, space: 1 },
    },
    children: [],
  });
}

const para = (children: TextRun[], after = 40) =>
  new Paragraph({ spacing: { after }, children });

function flagship(text: string): Paragraph {
  return new Paragraph({
    numbering: { reference: FLAGSHIP_REF, level: 0 },
    spacing: { before: 20, after: 20 },
    children: [run(text, { bold: true })],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    numbering: { reference: BULLET_REF, level: 0 },
    spacing: { after: 20 },
    children: [run(text)],
  });
}

function logoParagraph(branding: BrandingOptions): Paragraph | null {
  const logo = branding.logo;
  if (!logo) return null;
  return new Paragraph({
    spacing: { after: 0 },
    children: [
      new ImageRun({
        type: logo.type,
        data: logo.data,
        transformation: { width: logo.width, height: logo.height },
        floating: {
          horizontalPosition: {
            relative: HorizontalPositionRelativeFrom.PAGE,
            align: HorizontalPositionAlign.RIGHT,
          },
          verticalPosition: {
            relative: VerticalPositionRelativeFrom.PAGE,
            offset: 360 * 635, // 0.25 inch, in EMU
          },
          wrap: { type: TextWrappingType.NONE },
        },
      }),
    ],
  });
}

/* --------------------------------- sections -------------------------------- */

function headerBlock(doc: ResumeDoc, accent: string, branding?: BrandingOptions | null): Paragraph[] {
  const h = doc.header;
  const out: Paragraph[] = [];

  const logo = branding ? logoParagraph(branding) : null;
  if (logo) out.push(logo);

  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 20 },
    children: [run(h.fullName, { size: SIZE.name, bold: true, color: accent })],
  }));

  const contact = [h.city, ...h.phones, h.email, h.linkedIn]
    .filter((v): v is string => Boolean(v && v.trim()));
  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [run(contact.join(' | '))],
  }));

  out.push(divider());

  const [role, industry] = doc.headline;
  if (role?.trim()) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20 },
      children: [run(role.trim(), { size: SIZE.headline1, bold: true, allCaps: true })],
    }));
  }
  if (industry?.trim()) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [run(industry.trim(), { size: SIZE.headline2, italics: true })],
    }));
  }
  return out;
}

function summaryBlock(doc: ResumeDoc, accent: string): Paragraph[] {
  const paras = doc.summary.map((s) => s.trim()).filter(Boolean);
  if (!paras.length) return [];
  return [heading('Professional Summary', accent), ...paras.map((p) => para([run(p)]))];
}

function competenciesBlock(doc: ResumeDoc, accent: string): Paragraph[] {
  if (!doc.competencies.length) return [];
  return [
    heading('Core Competencies', accent),
    ...doc.competencies.map((c) => para([
      run(`${c.label}: `, { bold: true }),
      run(c.items.map((i) => i.trim()).filter(Boolean).join(', ')),
    ], 30)),
  ];
}

function experienceBlock(doc: ResumeDoc, accent: string): Paragraph[] {
  if (!doc.experience.length) return [];
  const out: Paragraph[] = [heading('Professional Experience', accent)];

  for (const exp of doc.experience) {
    const dates = formatDateRange(exp.startDate, exp.endDate);
    out.push(new Paragraph({
      keepNext: true,
      spacing: { before: 100, after: 0 },
      children: [
        run(exp.company, { size: SIZE.company, bold: true }),
        ...(dates ? [run(` | ${dates}`)] : []),
      ],
    }));
    out.push(new Paragraph({
      keepNext: true,
      spacing: { after: 20 },
      children: [run(exp.title, { italics: true })],
    }));
    if (exp.flagship.trim()) out.push(flagship(exp.flagship.trim()));
    for (const b of exp.bullets) {
      if (b.trim()) out.push(bullet(b.trim()));
    }
  }
  return out;
}

function educationBlock(doc: ResumeDoc, accent: string): Paragraph[] {
  if (!doc.education.length) return [];
  return [
    heading('Education', accent),
    ...doc.education.map((e) => {
      const degree = [e.degree, e.field].filter(Boolean).join(', ');
      const years = [e.startYear, e.endYear].filter((y) => y != null).join(' to ');
      return para([run([degree, e.institution, years].filter(Boolean).join(' | '))], 30);
    }),
  ];
}

function certificationsBlock(doc: ResumeDoc, accent: string): Paragraph[] {
  if (!doc.certifications.length) return [];
  return [
    heading('Certifications', accent),
    ...doc.certifications.map((c) =>
      para([run([c.name, c.issuer, c.year].filter(Boolean).join(' | '))], 30)),
  ];
}

function keywordsBlock(doc: ResumeDoc, accent: string): Paragraph[] {
  const terms = doc.keywords.map((k) => k.trim()).filter(Boolean);
  if (!terms.length) return [];
  return [
    heading('Keywords', accent),
    para([run(terms.join(', '), { size: SIZE.keywords })]),
  ];
}

function targetsBlock(doc: ResumeDoc, accent: string): Paragraph[] {
  if (!doc.targetCompanies.length) return [];
  return [
    heading('Target companies and similar roles', accent),
    ...doc.targetCompanies.map((t) =>
      para([run(`${t.name} | ${t.department} | ${t.exampleRole}`)], 20)),
  ];
}

/* --------------------------------- renderer -------------------------------- */

export async function renderResumeDocx(
  doc: ResumeDoc,
  opts: RenderOptions = {},
): Promise<RenderedDocx> {
  const branding = opts.branding ?? null;
  const accent = accentFor(branding);

  const children: Paragraph[] = [
    ...headerBlock(doc, accent, branding),
    ...summaryBlock(doc, accent),
    ...competenciesBlock(doc, accent),
    ...experienceBlock(doc, accent),
    ...educationBlock(doc, accent),
    ...certificationsBlock(doc, accent),
    ...keywordsBlock(doc, accent),
    ...targetsBlock(doc, accent),
  ];

  const footerText = branding?.footerText?.trim();

  const document = new Document({
    creator: 'Resume Engine',
    title: `${doc.header.fullName} ${doc.meta.targetRole}`,
    description: `Generated for run ${doc.meta.runId}`,
    styles: {
      default: { document: { run: { font: FONT, size: SIZE.body } } },
    },
    numbering: {
      config: [
        {
          reference: FLAGSHIP_REF,
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '▸',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 360, hanging: 360 } },
              run: { bold: true },
            },
          }],
        },
        {
          reference: BULLET_REF,
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 360 } } },
          }],
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH_DXA, height: PAGE_HEIGHT_DXA },
          margin: { ...MARGINS_DXA },
        },
      },
      ...(footerText
        ? {
            footers: {
              default: new Footer({
                children: [new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [run(footerText, { size: SIZE.keywords })],
                })],
              }),
            },
          }
        : {}),
      children,
    }],
  });

  const buffer = await Packer.toBuffer(document);
  return { buffer };
}

/** Convenience: renders to a Buffer only. */
export async function renderResumeDocxBuffer(
  doc: ResumeDoc,
  opts: RenderOptions = {},
): Promise<Buffer> {
  return (await renderResumeDocx(doc, opts)).buffer;
}
