// apps/api/src/pipeline/llm.ts
// Provider abstraction for structured (JSON schema) LLM calls.
// 01-SPEC-v3.md section 8: LLM_PROVIDER, LLM_API_KEY, LLM_MODEL_ANALYZE, LLM_MODEL_WRITE.

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { z } from 'zod';

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
  maxTokens?: number;
}

export interface LlmResponse {
  /** Parsed JSON. Not yet validated against the schema. */
  data: unknown;
  tokensIn: number;
  tokensOut: number;
  model: string;
  provider: string;
}

export interface LlmClient {
  completeJson(req: LlmRequest): Promise<LlmResponse>;
}

export type ProviderType = 'openai' | 'anthropic' | 'openrouter' | 'omniroute' | 'ollama' | 'azure' | 'vertex';

// ============================================================================
// Base class with shared JSON schema validation logic
// ============================================================================

abstract class BaseLlmClient implements LlmClient {
  protected readonly defaultTemp = 0.4;
  protected readonly defaultMaxTokens = 4000;

  abstract completeJson(req: LlmRequest): Promise<LlmResponse>;

  protected validateJson<T>(raw: string, schema: JsonSchemaSpec): T {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('LLM_INVALID_JSON');
    }
    // Validate against Zod schema derived from JSON Schema
    const zodSchema = this.jsonSchemaToZod(schema.schema);
    const result = zodSchema.safeParse(data);
    if (!result.success) {
      throw new Error(`LLM_SCHEMA_VALIDATION_FAILED: ${result.error.message}`);
    }
    return result.data as T;
  }

  protected jsonSchemaToZod(jsonSchema: Record<string, unknown>): z.ZodTypeAny {
    const type = jsonSchema.type as string;
    switch (type) {
      case 'object': {
        const props = (jsonSchema.properties as Record<string, Record<string, unknown>>) ?? {};
        const required = (jsonSchema.required as string[]) ?? [];
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, prop] of Object.entries(props)) {
          shape[key] = this.jsonSchemaToZod(prop);
        }
        let obj = z.object(shape);
        if (required.length < Object.keys(props).length) {
          obj = obj.partial();
        }
        return obj;
      }
      case 'array': {
        const items = jsonSchema.items as Record<string, unknown>;
        return z.array(this.jsonSchemaToZod(items));
      }
      case 'string': return z.string();
      case 'number': return z.number();
      case 'integer': return z.number().int();
      case 'boolean': return z.boolean();
      default: return z.unknown();
    }
  }
}

// ============================================================================
// OpenAI & OpenAI-Compatible Providers (OpenRouter, Omniroute, Ollama, Azure)
// ============================================================================

class OpenAiCompatibleClient extends BaseLlmClient {
  private readonly client: OpenAI;
  private readonly providerName: ProviderType;

  constructor(opts: { apiKey: string; baseURL?: string; provider: ProviderType }) {
    super();
    this.providerName = opts.provider;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  }

  async completeJson(req: LlmRequest): Promise<LlmResponse> {
    const resp = await this.client.chat.completions.create({
      model: req.model,
      temperature: req.temperature ?? this.defaultTemp,
      max_tokens: req.maxTokens ?? this.defaultMaxTokens,
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

    this.validateJson(raw, req.schema); // throws if invalid

    return {
      data: JSON.parse(raw),
      tokensIn: resp.usage?.prompt_tokens ?? 0,
      tokensOut: resp.usage?.completion_tokens ?? 0,
      model: resp.model ?? req.model,
      provider: this.providerName,
    };
  }
}

// ============================================================================
// Anthropic Claude (uses native JSON schema output via .parse())
// ============================================================================

class AnthropicClient extends BaseLlmClient {
  private readonly client: Anthropic;

  constructor(opts: { apiKey: string; baseURL?: string }) {
    super();
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  }

  async completeJson(req: LlmRequest): Promise<LlmResponse> {
    // Use Anthropic's native JSON schema output format for strict validation
    const resp = await this.client.messages.parse({
      model: req.model,
      temperature: req.temperature ?? this.defaultTemp,
      max_tokens: req.maxTokens ?? this.defaultMaxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      output_config: {
        format: jsonSchemaOutputFormat(req.schema.schema as any),
      },
    });

    const parsed = resp.parsed_output;
    if (!parsed) throw new Error('LLM_EMPTY_PARSED_OUTPUT');

    return {
      data: parsed,
      tokensIn: resp.usage?.input_tokens ?? 0,
      tokensOut: resp.usage?.output_tokens ?? 0,
      model: resp.model ?? req.model,
      provider: 'anthropic',
    };
  }
}

// ============================================================================
// Google Vertex AI (Gemini via OpenAI-compatible endpoint)
// ============================================================================

class VertexAiClient extends BaseLlmClient {
  private readonly client: OpenAI;

  constructor(opts: { apiKey: string; baseURL: string }) {
    super();
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
    });
  }

  async completeJson(req: LlmRequest): Promise<LlmResponse> {
    // Vertex AI supports OpenAI-compatible JSON schema
    const resp = await this.client.chat.completions.create({
      model: req.model,
      temperature: req.temperature ?? this.defaultTemp,
      max_tokens: req.maxTokens ?? this.defaultMaxTokens,
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
    this.validateJson(raw, req.schema);

    return {
      data: JSON.parse(raw),
      tokensIn: resp.usage?.prompt_tokens ?? 0,
      tokensOut: resp.usage?.completion_tokens ?? 0,
      model: resp.model ?? req.model,
      provider: 'vertex',
    };
  }
}

// ============================================================================
// Factory & Env Config
// ============================================================================

export interface LlmEnv {
  LLM_PROVIDER?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL_ANALYZE?: string;
  LLM_MODEL_WRITE?: string;
  // Provider-specific
  LLM_ORG_ID?: string;        // OpenAI org
  LLM_PROJECT_ID?: string;    // Vertex AI project
  LLM_LOCATION?: string;      // Vertex AI location
}

const PROVIDER_DEFAULTS: Record<ProviderType, { baseURL?: string; models: { analyze: string; write: string } }> = {
  openai: {
    models: { analyze: 'gpt-4o-mini', write: 'gpt-4o-mini' },
  },
  anthropic: {
    baseURL: 'https://api.anthropic.com',
    models: { analyze: 'claude-3-5-haiku-20241022', write: 'claude-3-5-sonnet-20241022' },
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    models: { analyze: 'openai/gpt-4o-mini', write: 'openai/gpt-4o-mini' },
  },
  omniroute: {
    baseURL: 'https://api.omniroute.ai/v1',
    models: { analyze: 'gpt-4o-mini', write: 'gpt-4o-mini' },
  },
  ollama: {
    baseURL: 'http://localhost:11434/v1',
    models: { analyze: 'qwen2.5:7b', write: 'qwen2.5:7b' },
  },
  azure: {
    // baseURL must be provided: https://{resource}.openai.azure.com/openai/deployments/{deployment}
    models: { analyze: 'gpt-4o-mini', write: 'gpt-4o-mini' },
  },
  vertex: {
    // baseURL: https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}
    models: { analyze: 'gemini-1.5-flash', write: 'gemini-1.5-pro' },
  },
};

export function createLlmClientFromEnv(env: LlmEnv = process.env): LlmClient {
  const provider = (env.LLM_PROVIDER ?? 'openai').toLowerCase() as ProviderType;
  const config = PROVIDER_DEFAULTS[provider];
  if (!config) {
    throw new Error(`Unknown LLM_PROVIDER: ${provider}. Supported: ${Object.keys(PROVIDER_DEFAULTS).join(', ')}`);
  }

  const apiKey = env.LLM_API_KEY;
  if (!apiKey) throw new Error('LLM_API_KEY is required');

  const baseURL = env.LLM_BASE_URL ?? config.baseURL;

  switch (provider) {
    case 'openai':
    case 'openrouter':
    case 'omniroute':
    case 'ollama':
    case 'azure':
      return new OpenAiCompatibleClient({ apiKey, baseURL, provider });

    case 'anthropic':
      return new AnthropicClient({ apiKey, baseURL });

    case 'vertex': {
      if (!baseURL) throw new Error('LLM_BASE_URL required for Vertex AI (include project/location/model)');
      return new VertexAiClient({ apiKey, baseURL });
    }

    default:
      throw new Error(`Provider ${provider} not implemented`);
  }
}

export function modelsFromEnv(env: LlmEnv = process.env): { analyze: string; write: string } {
  const provider = (env.LLM_PROVIDER ?? 'openai').toLowerCase() as ProviderType;
  const config = PROVIDER_DEFAULTS[provider];

  const analyze = env.LLM_MODEL_ANALYZE ?? config?.models.analyze;
  const write = env.LLM_MODEL_WRITE ?? config?.models.write;

  if (!analyze || !write) {
    throw new Error('LLM_MODEL_ANALYZE and LLM_MODEL_WRITE are required (or set LLM_PROVIDER for defaults)');
  }
  return { analyze, write };
}
