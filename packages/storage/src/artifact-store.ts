// packages/storage/src/artifact-store.ts
// S3 / Cloudflare R2 artifact storage with presigned GET URLs.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface ArtifactStoreConfig {
  bucket: string;
  region?: string;
  endpoint?: string;        // R2: https://<account>.r2.cloudflarestorage.com
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  signedUrlTtlSeconds?: number;
}

export interface ArtifactRef {
  key: string;
  bucket: string;
  contentType: string;
  size: number;
  url: string;              // presigned
  expiresAt: string;
}

export class ArtifactStore {
  private readonly client: S3Client;
  private readonly ttl: number;

  constructor(private readonly cfg: ArtifactStoreConfig) {
    this.client = new S3Client({
      region: cfg.region ?? 'auto',
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle ?? Boolean(cfg.endpoint),
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
    this.ttl = cfg.signedUrlTtlSeconds ?? 900; // 15 min
  }

  async put(
    key: string,
    body: Buffer,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<ArtifactRef> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
    }));
    return this.ref(key, contentType, body.byteLength);
  }

  async signedGetUrl(key: string, ttlSeconds?: number): Promise<string> {
    const ttl = ttlSeconds ?? this.ttl;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      { expiresIn: ttl },
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async ref(key: string, contentType: string, size = 0): Promise<ArtifactRef> {
    const url = await this.signedGetUrl(key);
    return {
      key,
      bucket: this.cfg.bucket,
      contentType,
      size,
      url,
      expiresAt: new Date(Date.now() + this.ttl * 1000).toISOString(),
    };
  }
}

/* --------------------------------- Key scheme ------------------------------ */

export function artifactKeys(runId: string, slug: string) {
  const base = `runs/${runId}`;
  return {
    docx: `${base}/${slug}.docx`,
    pdf: `${base}/${slug}.pdf`,
    validation: `${base}/validation.json`,
    output: `${base}/output.json`,
  };
}

/** 'Jane Doe_CTO_Acme.docx' -> 'Jane-Doe_CTO_Acme' */
export function slugifyFileName(fileName: string): string {
  return fileName.replace(/\.docx$/i, '').replace(/\s+/g, '-');
}
