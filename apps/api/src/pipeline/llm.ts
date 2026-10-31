// apps/api/src/pipeline/llm.ts
// Provider abstraction for structured (JSON schema) LLM calls.
// 01-SPEC-v3.md section 8: LLM_PROVIDER, LLM_API_KEY, LLM_MODEL_ANALYZE, LLM_MODEL_WRITE.

import OpenAI from 'openai';

export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  schema: JsonSchemaSpec;
  temperature?: number;
}

export interface LlmResponse {
  /** Parsed JSON. Not yet validated against the schema. */
  data: unknown;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export interface LlmClient {
  completeJson(req: LlmRequest): Promise<LlmResponse>;
}

export class OpenAiLlmClient implements LlmClient {
  private readonly client: OpenAI;

  constructor(opts: { apiKey: string; baseURL?: string }) {
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  }

  async completeJson(req: LlmRequest): Promise<LlmResponse> {
    const resp = await this.client.chat.completions.create({
      model: req.model,
      temperature: req.temperature ?? 0.4,
      response_format: {
        type: 'json_schema',
        json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema },
      },
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    });

    const raw = resp.choices[0]?.message?.content;
    if (!raw) throw new Error('LLM_EMPTY_RESPONSE');
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('LLM_INVALID_JSON');
    }
    return {
      data,
      tokensIn: resp.usage?.prompt_tokens ?? 0,
      tokensOut: resp.usage?.completion_tokens ?? 0,
      model: resp.model ?? req.model,
    };
  }
}

export interface LlmEnv {
  LLM_PROVIDER?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL_ANALYZE?: string;
  LLM_MODEL_WRITE?: string;
}

export function createLlmClientFromEnv(env: LlmEnv = process.env): LlmClient {
  const provider = (env.LLM_PROVIDER ?? 'openai').toLowerCase();
  if (provider !== 'openai') {
    throw new Error(`LLM_PROVIDER=${provider} is not implemented yet; only "openai" is supported.`);
  }
  if (!env.LLM_API_KEY) throw new Error('LLM_API_KEY is required');
  return new OpenAiLlmClient({
    apiKey: env.LLM_API_KEY,
    ...(env.LLM_BASE_URL ? { baseURL: env.LLM_BASE_URL } : {}),
  });
}

export function modelsFromEnv(env: LlmEnv = process.env): { analyze: string; write: string } {
  const analyze = env.LLM_MODEL_ANALYZE;
  const write = env.LLM_MODEL_WRITE;
  if (!analyze || !write) {
    throw new Error('LLM_MODEL_ANALYZE and LLM_MODEL_WRITE are required');
  }
  return { analyze, write };
}
