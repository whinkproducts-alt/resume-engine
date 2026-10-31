import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { renderResumeDocx, formatDateRange, type BrandingOptions } from '../src';
import type { ResumeDoc } from '@resume-engine/rules';

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const resume = (): ResumeDoc => ({
  meta: {
    runId: 'run_abc123', fileName: 'Jane Doe_Product Manager_Acme.docx',
    candidateName: 'Jane Doe', targetRole: 'Senior Product Manager',
    generatedAt: '2026-10-31T00:00:00.000Z',
  },
  header: {
    fullName: 'Jane Doe', city: 'Lagos, Nigeria', phones: ['+234 800 000 0000'],
    email: 'jane@example.com', linkedIn: 'linkedin.com/in/janedoe',
  },
  headline: ['Product Manager', 'Fintech platforms and payments'],
  summary: ['One.', 'Two.', 'Three.', 'Four.'],
  competencies: [
    { label: 'Soft Skills', items: ['Coaching', 'Negotiation'] },
    { label: 'Technical Skills', items: ['SQL'] },
  ],
  experience: [{
    id: 'e1', company: 'Acme', title: 'Product Manager', startDate: '2020-01', endDate: null,
    flagship: 'Owned the product strategy.', bullets: ['Launched the pilot.', 'Cut churn.'],
  }],
  education: [{ institution: 'University of Lagos', degree: 'BSc', field: 'Computer Science',
    startYear: 2008, endYear: 2012 }],
  certifications: [{ name: 'PMP', issuer: 'PMI', year: 2018 }],
  keywords: ['roadmap', 'agile', 'analytics'],
  targetCompanies: [{ name: 'Stripe', department: 'Payments', exampleRole: 'Product Manager' }],
});

async function parts(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (name: string) => (await zip.file(name)?.async('string')) ?? '';
  const names = Object.keys(zip.files);
  return {
    names,
    doc: await read('word/document.xml'),
    numbering: await read('word/numbering.xml'),
    footers: (await Promise.all(names.filter((n) => /word\/footer\d*\.xml$/.test(n)).map(read))).join(''),
  };
}

describe('renderResumeDocx layout contract', () => {
  it('produces a valid zip with US Letter pages and the specified margins', async () => {
    const { buffer } = await renderResumeDocx(resume());
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const { doc } = await parts(buffer);
    expect(doc).toMatch(/<w:pgSz[^>]*w:w="12240"[^>]*w:h="15840"/);
    expect(doc).toMatch(/<w:pgMar[^>]*w:top="720"/);
    expect(doc).toMatch(/<w:pgMar[^>]*w:right="1008"/);
    expect(doc).toMatch(/<w:pgMar[^>]*w:bottom="720"/);
    expect(doc).toMatch(/<w:pgMar[^>]*w:left="1008"/);
  });

  it('uses no tables, ever', async () => {
    const { doc } = await parts((await renderResumeDocx(resume())).buffer);
    expect(doc).not.toContain('<w:tbl>');
    expect(doc).not.toContain('<w:tbl ');
  });

  it('sets the name at 20pt bold navy and uses Calibri', async () => {
    const { doc } = await parts((await renderResumeDocx(resume())).buffer);
    const nameRun = doc.slice(doc.indexOf('Jane Doe') - 400, doc.indexOf('Jane Doe') + 10);
    expect(nameRun).toContain('w:val="1F3864"');
    expect(nameRun).toContain('<w:sz w:val="40"');
    expect(nameRun).toContain('<w:b/>');
    expect(doc).toContain('w:ascii="Calibri"');
  });

  it('separates contact parts with " | "', async () => {
    const { doc } = await parts((await renderResumeDocx(resume())).buffer);
    expect(doc).toContain('Lagos, Nigeria | +234 800 000 0000 | jane@example.com | linkedin.com/in/janedoe');
  });

  it('draws the divider (size 8) and heading rules (size 6) in 2E74B5', async () => {
    const { doc } = await parts((await renderResumeDocx(resume())).buffer);
    const border = (sz: number) =>
      new RegExp(`<w:bottom(?=[^>]*w:sz="${sz}")(?=[^>]*w:color="2E74B5")(?=[^>]*w:val="single")`);
    expect(doc).toMatch(border(8));
    expect(doc).toMatch(border(6));
    expect(doc).toMatch(/w:before="180"[^>]*w:after="80"|w:after="80"[^>]*w:before="180"/);
  });

  it('takes flagship and standard bullet glyphs from the numbering config, never typed', async () => {
    const { doc, numbering } = await parts((await renderResumeDocx(resume())).buffer);
    expect(numbering).toContain('▸');
    expect(numbering).toContain('•');
    expect(numbering).toMatch(/w:left="360"[^>]*w:hanging="360"/);
    expect(doc).not.toContain('▸');
    expect(doc).not.toContain('•');
    expect(doc).toContain('<w:numPr>');
  });

  it('puts the keyword block in one 9pt paragraph', async () => {
    const { doc } = await parts((await renderResumeDocx(resume())).buffer);
    const i = doc.indexOf('roadmap, agile, analytics');
    expect(i).toBeGreaterThan(0);
    expect(doc.slice(i - 300, i)).toContain('<w:sz w:val="18"');
  });

  it('writes date ranges with words, not dashes', () => {
    expect(formatDateRange('2020-01', null)).toBe('Jan 2020 to Present');
    expect(formatDateRange('2016-03', '2019-12')).toBe('Mar 2016 to Dec 2019');
  });
});

describe('agency white-label', () => {
  const branding: BrandingOptions = {
    primaryColor: '#8B1A1A',
    footerText: 'Prepared by Acme Careers',
    logo: { data: PNG, type: 'png', width: 40, height: 40 },
  };

  it('swaps the accent colour, adds the footer and a right aligned logo', async () => {
    const out = await parts((await renderResumeDocx(resume(), { branding })).buffer);
    expect(out.doc).toContain('w:val="8B1A1A"');
    expect(out.doc).not.toContain('w:val="1F3864"');
    expect(out.footers).toContain('Prepared by Acme Careers');
    expect(out.doc).toContain('<wp:anchor');
    expect(out.doc).toMatch(/<wp:align>right<\/wp:align>/);
    expect(out.names.some((n) => n.startsWith('word/media/'))).toBe(true);
  });

  it('ignores an invalid colour and falls back to the default', async () => {
    const { doc } = await parts((await renderResumeDocx(resume(), {
      branding: { primaryColor: 'not-a-colour' },
    })).buffer);
    expect(doc).toContain('w:val="1F3864"');
  });
});
