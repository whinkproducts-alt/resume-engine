// packages/renderer/src/docx-renderer.ts
// Stage 7 — DOCX rendering via the `docx` npm package.
// Layout mirrors Section 6 of the master spec: single column, no tables,
// no images, no text boxes (so R13 passes by construction).
//
//   [NAME]                         16pt bold, centered
//   [contact line]                  9pt, centered, ' • ' separated
//   [HEADLINE]                     10pt italic, centered
//   ── SUMMARY ───────────────────────────────────────────────
//   ── CORE SKILLS ───────────────────────────────────────────
//   ── PROFESSIONAL EXPERIENCE ───────────────────────────────
//   ── EDUCATION ─────────────────────────────────────────────
//   ── PROJECTS / CERTIFICATIONS / LANGUAGES (conditional) ───

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
  convertInchesToTwip,
  LevelFormat,
} from 'docx';
import type {
  EducationItem,
  ExperienceItem,
  RenderNode,
  ResumeDoc,
} from '@resume-engine/rules';

export const PAGE_WIDTH_TWIPS = 12240;      // US Letter 8.5"
export const PAGE_HEIGHT_TWIPS = 15840;     // US Letter 11"
export const MARGIN_TWIPS = convertInchesToTwip(0.5);
export const CONTENT_WIDTH_TWIPS = PAGE_WIDTH_TWIPS - MARGIN_TWIPS * 2;

const FONT = 'Calibri';
const SIZE = { name: 32, contact: 18, headline: 20, heading: 20, body: 20, meta: 18 };
const COLOR = { ink: '1A1A1A', muted: '4A4A4A', rule: 'BFBFBF', accent: '1F3864' };

export interface RenderedDocx {
  buffer: Buffer;
  /** Node inventory consumed by R13 on the post-render validation pass. */
  nodes: RenderNode[];
}

const SPACING = {
  sectionBefore: 160,
  sectionAfter: 60,
  itemAfter: 40,
  bulletAfter: 30,
};

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: SPACING.sectionBefore, after: SPACING.sectionAfter },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.rule, space: 2 },
    },
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        size: SIZE.heading,
        color: COLOR.accent,
        font: FONT,
        characterSpacing: 20,
      }),
    ],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: SPACING.bulletAfter },
    children: [new TextRun({ text, size: SIZE.body, font: FONT, color: COLOR.ink })],
  });
}

function body(text: string, opts: { italic?: boolean; color?: string } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: SPACING.itemAfter },
    children: [
      new TextRun({
        text,
        size: SIZE.body,
        font: FONT,
        italics: opts.italic,
        color: opts.color ?? COLOR.ink,
      }),
    ],
  });
}

/** Left/right tab split used for "Title — Company <tab> Dates". */
function tabbedLine(left: TextRun[], right: string): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH_TWIPS }],
    spacing: { before: 60, after: 20 },
    children: [
      ...left,
      new TextRun({ text: '\t', size: SIZE.body, font: FONT }),
      new TextRun({
        text: right, size: SIZE.meta, font: FONT,
        color: COLOR.muted, italics: true,
      }),
    ],
  });
}

function formatRange(start?: string, end?: string | null, current?: boolean): string {
  const fmt = (v?: string | null) => {
    if (!v) return '';
    const m = /^(\d{4})-(\d{2})$/.exec(v);
    if (!m) return v;
    const months = ['Jan','Feb','Mar','Apr','May','Jun',
                    'Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[Number(m[2]) - 1]} ${m[1]}`;
  };
  const left = fmt(start);
  const right = current || !end ? 'Present' : fmt(end);
  if (!left && !right) return '';
  return `${left} – ${right}`.trim();
}

/* ------------------------------ Section builders --------------------------- */

function headerSection(doc: ResumeDoc, nodes: RenderNode[]): Paragraph[] {
  const out: Paragraph[] = [];

  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 20 },
    children: [new TextRun({
      text: doc.contact.name.toUpperCase(),
      bold: true, size: SIZE.name, font: FONT,
      color: COLOR.ink, characterSpacing: 30,
    })],
  }));
  nodes.push({ type: 'heading', path: 'contact.name' });

  const contactBits = [
    doc.contact.email,
    doc.contact.phone,
    doc.contact.location,
    ...(doc.contact.links ?? []),
  ].filter((v): v is string => Boolean(v && v.trim()));

  if (contactBits.length) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20 },
      children: [new TextRun({
        text: contactBits.join('  •  '),
        size: SIZE.contact, font: FONT, color: COLOR.muted,
      })],
    }));
    nodes.push({ type: 'paragraph', path: 'contact' });
  }

  if (doc.headline?.trim()) {
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [new TextRun({
        text: doc.headline.trim(),
        italics: true, size: SIZE.headline, font: FONT, color: COLOR.accent,
      })],
    }));
    nodes.push({ type: 'paragraph', path: 'headline' });
  }

  return out;
}

function summarySection(doc: ResumeDoc, nodes: RenderNode[]): Paragraph[] {
  if (!doc.summary?.trim()) return [];
  nodes.push({ type: 'heading', path: 'summary' });
  nodes.push({ type: 'paragraph', path: 'summary' });
  return [sectionHeading('Summary'), body(doc.summary.trim())];
}

function skillsSection(doc: ResumeDoc, nodes: RenderNode[]): Paragraph[] {
  if (!doc.skills?.length) return [];
  const out: Paragraph[] = [sectionHeading('Core Skills')];
  nodes.push({ type: 'heading', path: 'skills' });

  for (const [i, group] of doc.skills.entries()) {
    const items = (group.items ?? []).filter(Boolean);
    if (!items.length) continue;

    if (group.category) {
      out.push(new Paragraph({
        spacing: { after: SPACING.bulletAfter },
        children: [
          new TextRun({
            text: `${group.category}: `, bold: true,
            size: SIZE.body, font: FONT, color: COLOR.ink,
          }),
          new TextRun({ text: items.join(', '), size: SIZE.body, font: FONT, color: COLOR.ink }),
        ],
      }));
    } else {
      out.push(new Paragraph({
        spacing: { after: SPACING.bulletAfter },
        children: [new TextRun({
          text: items.join('  •  '), size: SIZE.body, font: FONT, color: COLOR.ink,
        })],
      }));
    }
    nodes.push({ type: 'paragraph', path: `skills[${i}]` });
  }
  return out;
}

function experienceSection(doc: ResumeDoc, nodes: RenderNode[]): Paragraph[] {
  if (!doc.experience?.length) return [];
  const out: Paragraph[] = [sectionHeading('Professional Experience')];
  nodes.push({ type: 'heading', path: 'experience' });

  doc.experience.forEach((exp: ExperienceItem, i: number) => {
    out.push(tabbedLine([
      new TextRun({ text: exp.title, bold: true, size: SIZE.body, font: FONT, color: COLOR.ink }),
      new TextRun({
        text: exp.company ? `  —  ${exp.company}` : '',
        size: SIZE.body, font: FONT, color: COLOR.ink,
      }),
      ...(exp.location
        ? [new TextRun({
            text: `  ·  ${exp.location}`,
            size: SIZE.meta, font: FONT, color: COLOR.muted,
          })]
        : []),
    ], formatRange(exp.startDate, exp.endDate, exp.current)));
    nodes.push({ type: 'paragraph', path: `experience[${i}].header` });

    (exp.bullets ?? []).forEach((b, j) => {
      const text = b.trim();
      if (!text) return;
      out.push(bullet(text));
      nodes.push({ type: 'bullet', path: `experience[${i}].bullets[${j}]` });
    });
  });

  return out;
}

function educationSection(doc: ResumeDoc, nodes: RenderNode[]): Paragraph[] {
  if (!doc.education?.length) return [];
  const out: Paragraph[] = [sectionHeading('Education')];
  nodes.push({ type: 'heading', path: 'education' });

  doc.education.forEach((edu: EducationItem, i: number) => {
    const degree = [edu.degree, edu.field].filter(Boolean).join(', ');
    out.push(tabbedLine([
      new TextRun({ text: degree || edu.institution, bold: true,
        size: SIZE.body, font: FONT, color: COLOR.ink }),
      ...(degree && edu.institution
        ? [new TextRun({ text: `  —  ${edu.institution}`, size: SIZE.body,
            font: FONT, color: COLOR.ink })]
        : []),
    ], formatRange(edu.startDate, edu.endDate)));
    nodes.push({ type: 'paragraph', path: `education[${i}].header` });

    if (edu.grade?.trim()) {
      out.push(new Paragraph({
        spacing: { after: SPACING.itemAfter },
        children: [new TextRun({
          text: edu.grade.trim(), size: SIZE.meta, font: FONT, color: COLOR.muted,
        })],
      }));
      nodes.push({ type: 'paragraph', path: `education[${i}].grade` });
    }
  });

  return out;
}

function projectsSection(doc: ResumeDoc, nodes: RenderNode[]): Paragraph[] {
  if (!doc.projects?.length) return [];
  const out: Paragraph[] = [sectionHeading('Selected Projects')];
  nodes.push({ type: 'heading', path: 'projects' });

  doc.projects.forEach((p, i) => {
    out.push(tabbedLine([
      new TextRun({ text: p.name, bold: true, size: SIZE.body, font: FONT, color: COLOR.ink }),
    ], p.link ?? ''));
    nodes.push({ type: 'paragraph', path: `projects[${i}].header` });

    if (p.description?.trim()) {
      out.push(body(p.description.trim()));
      nodes.push({ type: 'paragraph', path: `projects[${i}].description` });
    }
    (p.bullets ?? []).forEach((b, j) => {
      if (!b.trim()) return;
      out.push(bullet(b.trim()));
      nodes.push({ type: 'bullet', path: `projects[${i}].bullets[${j}]` });
    });
  });

  return out;
}

function inlineListSection(
  title: string,
  items: string[] | undefined,
  path: string,
  nodes: RenderNode[],
): Paragraph[] {
  const clean = (items ?? []).map((s) => s.trim()).filter(Boolean);
  if (!clean.length) return [];
  nodes.push({ type: 'heading', path });
  nodes.push({ type: 'paragraph', path });
  return [
    sectionHeading(title),
    new Paragraph({
      spacing: { after: SPACING.itemAfter },
      children: [new TextRun({
        text: clean.join('  •  '), size: SIZE.body, font: FONT, color: COLOR.ink,
      })],
    }),
  ];
}

/* --------------------------------- Renderer -------------------------------- */

export async function renderResumeDocx(doc: ResumeDoc): Promise<RenderedDocx> {
  const nodes: RenderNode[] = [];

  const children: Paragraph[] = [
    ...headerSection(doc, nodes),
    ...summarySection(doc, nodes),
    ...skillsSection(doc, nodes),
    ...experienceSection(doc, nodes),
    ...educationSection(doc, nodes),
    ...projectsSection(doc, nodes),
    ...inlineListSection('Certifications', doc.certifications, 'certifications', nodes),
    ...inlineListSection('Languages', doc.languages, 'languages', nodes),
  ];

  const document = new Document({
    creator: 'Resume Engine',
    title: `${doc.contact.name} — ${doc.meta.targetRole}`,
    description: `Generated for run ${doc.meta.runId}`,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE.body, color: COLOR.ink },
        },
      },
    },
    numbering: {
      config: [{
        reference: 'resume-bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.22),
                                          hanging: convertInchesToTwip(0.16) } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH_TWIPS, height: PAGE_HEIGHT_TWIPS },
          margin: {
            top: MARGIN_TWIPS, right: MARGIN_TWIPS,
            bottom: MARGIN_TWIPS, left: MARGIN_TWIPS,
          },
        },
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(document);
  return { buffer, nodes };
}

/** Convenience: renders to a Buffer only. */
export async function renderResumeDocxBuffer(doc: ResumeDoc): Promise<Buffer> {
  return (await renderResumeDocx(doc)).buffer;
}
