// apps/api/src/runs/storage.service.ts
import { Injectable } from '@nestjs/common';
import type { ArtifactRef, ArtifactStore } from '@resume-engine/storage';
import { storeFromEnv } from '../pipeline/env';
import { AppError } from '../common/errors/app-error';

@Injectable()
export class StorageService {
  private store: ArtifactStore | null = null;

  private get(): ArtifactStore {
    if (!this.store) {
      try {
        this.store = storeFromEnv();
      } catch (e) {
        throw new AppError('STORAGE_NOT_CONFIGURED', 503, e instanceof Error ? e.message : 'Storage is not configured.');
      }
    }
    return this.store;
  }

  /** Short lived signed URL (15 minutes by default). */
  ref(key: string, contentType: string, size = 0): Promise<ArtifactRef> {
    return this.get().ref(key, contentType, size);
  }
}
