// apps/api/src/pipeline/rule-set.ts
// Run.ruleSetId is required. This seeds the RuleSet and PromptVersion rows that
// every run pins for reproducibility (01-SPEC-v3.md section 5).

import type { PrismaClient } from '@prisma/client';
import { DEFAULT_RULE_CONFIG } from '@resume-engine/rules';
import { MARGINS_DXA, DEFAULT_ACCENT, RULE_COLOR } from '@resume-engine/renderer';
import { PROMPT_VERSION, type SectionName } from './prompts';

export const RULESET_VERSION = 'v3.1';

const SECTIONS: SectionName[] = [
  'analyze', 'headline', 'summary', 'competencies', 'role', 'keywords', 'targets',
];

export function ruleSetPayload() {
  const c = DEFAULT_RULE_CONFIG;
  return {
    rulesJson: {
      filenamePattern: c.filenamePattern.source,
      roleOverlapThreshold: c.roleOverlapThreshold,
      roleStopWords: [...c.roleStopWords],
      headlineLines: c.headlineLines,
      summaryParagraphs: c.summaryParagraphs,
      competencyLabels: [...c.competencyLabels],
      minPointsPerRole: c.minPointsPerRole,
      minKeywords: c.minKeywords,
      targetCompanyCount: c.targetCompanyCount,
      maxPages: c.maxPages,
      maxRetries: c.maxRetries,
      llmScoreFloor: c.llmScoreFloor,
      summaryMaxParagraphWords: c.summaryMaxParagraphWords,
      summaryMinJdTerms: c.summaryMinJdTerms,
      maxSentenceWords: c.maxSentenceWords,
      nearDuplicateSimilarity: c.nearDuplicateSimilarity,
    },
    styleConfig: {
      page: 'US Letter 12240x15840 DXA',
      marginsDxa: MARGINS_DXA,
      font: 'Calibri',
      accent: DEFAULT_ACCENT,
      rule: RULE_COLOR,
    },
  };
}

export async function ensureDefaultRuleSet(
  prisma: PrismaClient,
  models: { analyze: string; write: string } = { analyze: 'unset', write: 'unset' },
): Promise<{ id: string; version: string }> {
  const payload = ruleSetPayload();
  const rs = await prisma.ruleSet.upsert({
    where: { version: RULESET_VERSION },
    create: {
      version: RULESET_VERSION,
      rulesJson: payload.rulesJson,
      styleConfig: payload.styleConfig,
      promptVersion: PROMPT_VERSION,
    },
    update: {},
  });

  for (const section of SECTIONS) {
    await prisma.promptVersion.upsert({
      where: { section_version: { section, version: PROMPT_VERSION } },
      create: {
        section,
        version: PROMPT_VERSION,
        template: `apps/api/src/pipeline/prompts.ts@${PROMPT_VERSION}#${section}`,
        modelId: section === 'analyze' ? models.analyze : models.write,
      },
      update: {},
    });
  }
  return { id: rs.id, version: rs.version };
}
