import { describe, it, expect, vi } from 'vitest';
import { createLlmClientFromEnv, modelsFromEnv } from '../src/pipeline/llm';

describe('LLM Factory', () => {
  const providers = ['openai', 'anthropic', 'openrouter', 'omniroute', 'ollama', 'azure', 'vertex'] as const;

  it('creates client for each provider', () => {
    for (const provider of providers) {
      const client = createLlmClientFromEnv({
        LLM_PROVIDER: provider,
        LLM_API_KEY: 'test-key',
        LLM_BASE_URL: provider === 'vertex' ? 'https://test.vertex.com' : undefined,
      });
      expect(client).toBeDefined();
      expect(typeof client.completeJson).toBe('function');
    }
  });

  it('returns correct model defaults per provider', () => {
    for (const provider of providers) {
      const models = modelsFromEnv({ LLM_PROVIDER: provider });
      expect(models.analyze).toBeDefined();
      expect(models.write).toBeDefined();
      console.log(`${provider}: analyze=${models.analyze}, write=${models.write}`);
    }
  });

  it('allows custom model override', () => {
    const models = modelsFromEnv({
      LLM_PROVIDER: 'openai',
      LLM_MODEL_ANALYZE: 'gpt-4o',
      LLM_MODEL_WRITE: 'gpt-4o',
    });
    expect(models.analyze).toBe('gpt-4o');
    expect(models.write).toBe('gpt-4o');
  });

  it('throws for unknown provider', () => {
    expect(() => createLlmClientFromEnv({ LLM_PROVIDER: 'unknown', LLM_API_KEY: 'key' }))
      .toThrow('Unknown LLM_PROVIDER');
  });

  it('throws for missing API key', () => {
    expect(() => createLlmClientFromEnv({ LLM_PROVIDER: 'openai', LLM_API_KEY: undefined }))
      .toThrow('LLM_API_KEY is required');
  });

  it('throws for vertex without base URL', () => {
    expect(() => createLlmClientFromEnv({ LLM_PROVIDER: 'vertex', LLM_API_KEY: 'key' }))
      .toThrow('LLM_BASE_URL required for Vertex AI');
  });
});
