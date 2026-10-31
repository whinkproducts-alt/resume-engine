// Test doubles for the pipeline: in-memory repo, scripted LLM, fake artifact store.

import type { ValidationFlag } from '@resume-engine/rules';
import type { ArtifactRef } from '@resume-engine/storage';
import type { LlmClient, LlmRequest, LlmResponse } from '../src/pipeline/llm';
import type { ArtifactSink } from '../src/pipeline/stage-6-7-8';
import type {
  AnalysisResult, CompletionRecord, PipelineRepo, RunContext, RunStatusName, StepLog,
} from '../src/pipeline/types';

export const JD_TEXT = 'We are hiring a Senior Product Manager to own the roadmap. '.repeat(6);

export function fixtureContext(over: Partial<RunContext> = {}): RunContext {
  return {
    run: {
      id: 'run_test_1', userId: 'user_1', status: 'QUEUED', companyConfirmed: false,
      contactLocationOverride: null, startedAt: null, outputJson: null, ruleSetVersion: 'v3.1',
    },
    jd: {
      id: 'jd_1', rawText: JD_TEXT, company: null, roleTitle: null, location: null, seniority: null,
      industryTags: [], responsibilities: [], requirements: [], keywords: [],
      companyInferred: false, companyConfidence: null,
    },
    profile: {
      id: 'profile_1',
      fullName: 'Jane Doe',
      city: 'Lagos, Nigeria',
      phones: ['+234 800 000 0000'],
      email: 'jane@example.com',
      linkedIn: 'linkedin.com/in/janedoe',
      roles: [
        { company: 'Acme', baseTitle: 'Engineering Manager', startDate: '2020-01', endDate: null,
          location: 'Lagos', baseFlagship: 'Led the platform team', baseBullets: ['Built the billing service'] },
        { company: 'Globex', baseTitle: 'Software Engineer', startDate: '2016-03', endDate: '2019-12',
          location: 'Abuja', baseFlagship: 'Shipped the payments gateway', baseBullets: ['Wrote settlement jobs'] },
      ],
      education: [{ institution: 'University of Lagos', degree: 'BSc', field: 'Computer Science',
        startYear: 2008, endYear: 2012 }],
      certifications: [{ name: 'PMP', issuer: 'PMI', year: 2018 }],
      facts: [],
    },
    base: { id: 'base_1', version: 1, text: 'Jane Doe resume text. '.repeat(20), keywords: ['legacy1', 'legacy2'] },
    snapshot: {
      toggles: { banHyphensInProse: true, whinkGroupFraming: false, strictFactsMode: true },
      userSettings: {}, profileOverrides: null,
    },
    branding: null,
    ...over,
  };
}

export class MemoryRepo implements PipelineRepo {
  statuses: RunStatusName[] = [];
  logs: StepLog[] = [];
  flags: ValidationFlag[] = [];
  completion: CompletionRecord | null = null;
  analysis: AnalysisResult | null = null;
  errorCode: string | null = null;
  cancelled = false;

  constructor(public ctx: RunContext) {}

  async loadContext() {
    return { ...this.ctx, run: { ...this.ctx.run, status: this.cancelled ? 'CANCELLED' as const : this.ctx.run.status } };
  }
  async setStatus(_id: string, status: RunStatusName, patch: { errorCode?: string | null } = {}) {
    this.statuses.push(status);
    this.ctx.run.status = status;
    if (patch.errorCode !== undefined) this.errorCode = patch.errorCode;
  }
  async isCancelled() { return this.cancelled; }
  async logStep(_id: string, e: StepLog) { this.logs.push(e); }
  async saveAnalysis(_id: string, a: AnalysisResult) {
    this.analysis = a;
    // mirror what PrismaPipelineRepo persists, so a resumed job sees it
    this.ctx.jd = {
      ...this.ctx.jd, company: a.company, roleTitle: a.roleTitle, keywords: a.topKeywords,
      industryTags: a.industryTags, responsibilities: a.responsibilities,
      requirements: a.requirements, seniority: a.seniority, location: a.location,
      companyInferred: a.companyInferred, companyConfidence: a.companyConfidence,
    };
  }
  async saveOutput() { /* not asserted */ }
  async replaceFlags(_id: string, flags: ValidationFlag[]) { this.flags = flags; }
  async saveCompletion(_id: string, rec: CompletionRecord) {
    this.completion = rec;
    this.statuses.push(rec.status);
    this.ctx.run.status = rec.status;
    this.errorCode = rec.errorCode ?? null;
  }
}

const VERBS = [
  'Directed', 'Launched', 'Defined', 'Negotiated', 'Reduced', 'Aligned', 'Mentored', 'Introduced',
  'Automated', 'Streamlined', 'Partnered', 'Piloted', 'Standardised', 'Expanded', 'Coached', 'Delivered',
  'Designed', 'Planned', 'Built', 'Shipped', 'Tested', 'Measured', 'Improved', 'Simplified',
  'Unified', 'Migrated', 'Scaled', 'Hired', 'Trained', 'Audited', 'Forecast', 'Prioritised',
  'Documented', 'Resolved', 'Championed', 'Facilitated', 'Rebuilt', 'Consolidated', 'Secured', 'Won',
];

export interface LlmScript {
  analysis?: Partial<AnalysisResult>;
  /** Called with the 1-based call number for the `headline` schema. */
  headline?: (n: number) => { roleLine: string; industryLine: string };
}

export class ScriptedLlm implements LlmClient {
  calls: Record<string, number> = {};
  requests: LlmRequest[] = [];
  constructor(private readonly script: LlmScript = {}) {}

  async completeJson(req: LlmRequest): Promise<LlmResponse> {
    const name = req.schema.name;
    this.calls[name] = (this.calls[name] ?? 0) + 1;
    this.requests.push(req);
    const n = this.calls[name] ?? 1;
    return { data: this.data(name, n), tokensIn: 10, tokensOut: 5, model: req.model };
  }

  private data(name: string, n: number): unknown {
    switch (name) {
      case 'jd_analysis':
        return {
          company: 'Stripe', roleTitle: 'Senior Product Manager', location: 'Remote', seniority: 'senior',
          industryTags: ['fintech'], topKeywords: ['roadmap', 'stakeholders', 'agile', 'fintech', 'analytics'],
          responsibilities: ['Own the roadmap'], requirements: ['Five years in product'],
          companyInferred: false, companyConfidence: 0.95, ...this.script.analysis,
        };
      case 'headline':
        return this.script.headline?.(n) ?? { roleLine: 'PRODUCT MANAGER', industryLine: 'Fintech platforms and payments' };
      case 'summary':
        return { paragraphs: [
          'Product leader who owns the roadmap for fintech platforms.',
          'Aligns stakeholders across engineering, risk and operations.',
          'Uses analytics to decide what to build next.',
          'Runs agile delivery with clear plans and honest updates.',
        ] };
      case 'competencies':
        return { groups: ['Soft Skills', 'Stakeholder Management', 'Technical Skills',
          'Delivery Methodologies', 'Security and Compliance', 'Business Tools']
          .map((label) => ({ label, items: ['Item one', 'Item two'] })) };
      case 'role': {
        const base = ((n - 1) * 8) % VERBS.length;
        const verb = (k: number) => VERBS[(base + k) % VERBS.length] ?? 'Owned';
        return {
          title: n === 1 ? 'Product Manager Platform' : 'Associate Product Manager',
          flagship: `${verb(0)} the product strategy for the business unit.`,
          bullets: Array.from({ length: 7 }, (_, k) => `${verb(k + 1)} a customer facing workstream end to end.`),
        };
      }
      case 'keywords':
        return { keywords: ['roadmap', 'stakeholders', 'agile', 'fintech', 'analytics',
          ...Array.from({ length: 160 }, (_, i) => `keyword${i}`)] };
      case 'targets':
        return { companies: Array.from({ length: 7 }, (_, i) => ({
          name: `Company${i}`, department: 'Product', exampleRole: 'Product Manager' })) };
      default:
        throw new Error(`unexpected schema ${name}`);
    }
  }
}

export class MemoryStore implements ArtifactSink {
  puts: { key: string; size: number; contentType: string }[] = [];
  async put(key: string, body: Buffer, contentType: string): Promise<ArtifactRef> {
    this.puts.push({ key, size: body.length, contentType });
    return { key, bucket: 'test', contentType, size: body.length, url: `https://example.test/${key}`, expiresAt: '' };
  }
}
