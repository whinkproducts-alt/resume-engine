// apps/api/src/pipeline/env.ts
// Environment-driven construction of the storage client and rule config.

import { ArtifactStore } from '@resume-engine/storage';
import { DEFAULT_RULE_CONFIG, type RuleConfig } from '@resume-engine/rules';

type Env = Record<string, string | undefined>;

/**
 * Accepts the names from 01-SPEC-v3.md section 8 (S3_ACCESS_KEY, S3_SECRET_KEY)
 * and the Stage 3 names (S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).
 */
export function storeFromEnv(env: Env = process.env): ArtifactStore {
  const bucket = env.S3_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY ?? env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_KEY ?? env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY are required');
  }
  return new ArtifactStore({
    bucket,
    accessKeyId,
    secretAccessKey,
    ...(env.S3_REGION ? { region: env.S3_REGION } : {}),
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    signedUrlTtlSeconds: Number(env.S3_SIGNED_URL_TTL_SECONDS ?? 900),
  });
}

export function ruleConfigFromEnv(env: Env = process.env): RuleConfig {
  const num = (v: string | undefined, d: number) => {
    const n = v === undefined || v === '' ? NaN : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    ...DEFAULT_RULE_CONFIG,
    maxPages: num(env.MAX_PAGES, DEFAULT_RULE_CONFIG.maxPages),
    maxRetries: num(env.RULE_MAX_RETRIES, DEFAULT_RULE_CONFIG.maxRetries),
    roleOverlapThreshold: num(env.ROLE_OVERLAP_THRESHOLD, DEFAULT_RULE_CONFIG.roleOverlapThreshold),
  };
}
