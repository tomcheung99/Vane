import { UIConfigField } from '@/lib/config/types';
import { getConfiguredModelProviderById } from '@/lib/config/serverRegistry';
import { Model, ModelList, ProviderMetadata } from '../../types';
import BaseEmbedding from '../../base/embedding';
import BaseModelProvider from '../../base/provider';
import BaseLLM from '../../base/llm';
import VercelAILLM from './vercelaiLLM';
import VercelAIEmbedding from './vercelaiEmbedding';

interface VercelAIConfig {
  apiKey: string;
  baseURL: string;
}

interface VercelAIModelResponse {
  data?: Array<{
    id?: string;
  }>;
}

const deprecatedChatModelMappings: Record<string, string> = {
  'google/gemini-2.5-flash-preview':
    'google/gemini-3.1-flash-lite-preview',
};

const defaultEmbeddingModels: Model[] = [
  {
    name: 'Alibaba: Qwen3 Embedding 4B',
    key: 'alibaba/qwen3-embedding-4b',
  },
  {
    name: 'OpenAI: text-embedding-3-small',
    key: 'openai/text-embedding-3-small',
  },
  {
    name: 'OpenAI: text-embedding-3-large',
    key: 'openai/text-embedding-3-large',
  },
  {
    name: 'Google: text-embedding-004',
    key: 'google/text-embedding-004',
  },
];

const defaultChatModels: Model[] = [
  {
    name: 'Google: Gemini 3.1 Flash Lite Preview',
    key: 'google/gemini-3.1-flash-lite-preview',
  },
  {
    name: 'Google: Gemini 2.5 Pro Preview',
    key: 'google/gemini-2.5-pro-preview',
  },
  {
    name: 'Google: Gemini 2.0 Flash',
    key: 'google/gemini-2.0-flash',
  },
  {
    name: 'Google: Gemini 2.0 Flash Lite',
    key: 'google/gemini-2.0-flash-lite',
  },
  {
    name: 'Google: Gemini 1.5 Flash',
    key: 'google/gemini-1.5-flash',
  },
  {
    name: 'Google: Gemini 1.5 Pro',
    key: 'google/gemini-1.5-pro',
  },
  {
    name: 'Anthropic: Claude 3.5 Sonnet',
    key: 'anthropic/claude-3-5-sonnet',
  },
  {
    name: 'Anthropic: Claude 3.7 Sonnet',
    key: 'anthropic/claude-3-7-sonnet',
  },
  {
    name: 'Anthropic: Claude 3.5 Haiku',
    key: 'anthropic/claude-3-5-haiku',
  },
  {
    name: 'OpenAI: GPT-4o',
    key: 'openai/gpt-4o',
  },
  {
    name: 'OpenAI: GPT-4o Mini',
    key: 'openai/gpt-4o-mini',
  },
  {
    name: 'OpenAI: o1',
    key: 'openai/o1',
  },
  {
    name: 'Meta: Llama 3.3 70B',
    key: 'meta/llama-3.3-70b-instruct',
  },
  {
    name: 'Mistral: Mistral Large',
    key: 'mistral/mistral-large-latest',
  },
];

const mergeModels = (...lists: Model[][]): Model[] => {
  const modelMap = new Map<string, Model>();

  lists.flat().forEach((model) => {
    if (!model?.key) {
      return;
    }

    if (!modelMap.has(model.key)) {
      modelMap.set(model.key, model);
    }
  });

  return [...modelMap.values()];
};

const providerConfigFields: UIConfigField[] = [
  {
    type: 'password',
    name: 'API Key',
    key: 'apiKey',
    description: 'Your Vercel AI Gateway API key',
    required: true,
    placeholder: 'Vercel AI Gateway API Key',
    env: 'VERCEL_AI_GATEWAY_API_KEY',
    scope: 'server',
  },
  {
    type: 'string',
    name: 'Base URL',
    key: 'baseURL',
    description:
      'The base URL for the Vercel AI Gateway (e.g. https://ai-gateway.vercel.sh/v1/{team-slug}/{gateway-name})',
    required: true,
    placeholder: 'https://ai-gateway.vercel.sh/v1/{team-slug}/{gateway-name}',
    default: 'https://ai-gateway.vercel.sh/v1',
    env: 'VERCEL_AI_GATEWAY_BASE_URL',
    scope: 'server',
  },
];

class VercelAIProvider extends BaseModelProvider<VercelAIConfig> {
  constructor(id: string, name: string, config: VercelAIConfig) {
    super(id, name, config);
  }

  private getModelsEndpoint(): string {
    return `${this.config.baseURL.replace(/\/+$/, '')}/models`;
  }

  private async fetchGatewayModels(): Promise<Model[]> {
    const res = await fetch(this.getModelsEndpoint(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    if (!res.ok) {
      const message = await res.text();
      throw new Error(
        `Failed to load Vercel AI Gateway models: ${res.status} ${message.slice(0, 200)}`,
      );
    }

    const contentType = res.headers.get('content-type') ?? '';

    if (!contentType.toLowerCase().includes('application/json')) {
      const body = await res.text();
      throw new Error(
        `Vercel AI Gateway returned unexpected content type \"${contentType || 'unknown'}\": ${body.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as VercelAIModelResponse;

    return (data.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => Boolean(id))
      .map((id) => ({
        key: id,
        name: id,
      }));
  }

  async getDefaultModels(): Promise<ModelList> {
    try {
      const gatewayModels = await this.fetchGatewayModels();

      return {
        embedding: defaultEmbeddingModels,
        chat: mergeModels(gatewayModels, defaultChatModels),
      };
    } catch (error) {
      console.error('Failed to fetch Vercel AI Gateway models:', error);
    }

    return {
      embedding: defaultEmbeddingModels,
      chat: defaultChatModels,
    };
  }

  async getModelList(): Promise<ModelList> {
    const defaultModels = await this.getDefaultModels();
    const configProvider = getConfiguredModelProviderById(this.id)!;

    return {
      embedding: mergeModels(
        defaultModels.embedding,
        configProvider.embeddingModels,
      ),
      chat: mergeModels(defaultModels.chat, configProvider.chatModels),
    };
  }

  async loadChatModel(key: string): Promise<BaseLLM<any>> {
    const modelList = await this.getModelList();
    const resolvedKey = deprecatedChatModelMappings[key] ?? key;

    const exists = modelList.chat.find((m) => m.key === resolvedKey);

    if (!exists) {
      throw new Error(
        'Error Loading Vercel AI Gateway Chat Model. Invalid Model Selected',
      );
    }

    return new VercelAILLM({
      apiKey: this.config.apiKey,
      model: resolvedKey,
      baseURL: this.config.baseURL,
    });
  }

  async loadEmbeddingModel(key: string): Promise<BaseEmbedding<any>> {
    const modelList = await this.getModelList();
    const exists = modelList.embedding.find((m) => m.key === key);

    if (!exists) {
      throw new Error(
        'Error Loading Vercel AI Gateway Embedding Model. Invalid Model Selected',
      );
    }

    return new VercelAIEmbedding({
      apiKey: this.config.apiKey,
      model: key,
      baseURL: this.config.baseURL,
    });
  }

  static parseAndValidate(raw: any): VercelAIConfig {
    if (!raw || typeof raw !== 'object')
      throw new Error('Invalid config provided. Expected object');
    if (!raw.apiKey || !raw.baseURL)
      throw new Error(
        'Invalid config provided. API key and base URL must be provided',
      );

    return {
      apiKey: String(raw.apiKey),
      baseURL: String(raw.baseURL),
    };
  }

  static getProviderConfigFields(): UIConfigField[] {
    return providerConfigFields;
  }

  static getProviderMetadata(): ProviderMetadata {
    return {
      key: 'vercelai',
      name: 'Vercel AI Gateway',
    };
  }
}

export default VercelAIProvider;
