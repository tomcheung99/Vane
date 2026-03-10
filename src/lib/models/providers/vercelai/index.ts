import { UIConfigField } from '@/lib/config/types';
import { getConfiguredModelProviderById } from '@/lib/config/serverRegistry';
import { Model, ModelList, ProviderMetadata } from '../../types';
import BaseEmbedding from '../../base/embedding';
import BaseModelProvider from '../../base/provider';
import BaseLLM from '../../base/llm';
import VercelAILLM from './vercelaiLLM';

interface VercelAIConfig {
  apiKey: string;
  baseURL: string;
}

const defaultChatModels: Model[] = [
  {
    name: 'Google: Gemini 2.5 Flash Preview',
    key: 'google/gemini-2.5-flash-preview',
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

  async getDefaultModels(): Promise<ModelList> {
    return {
      embedding: [],
      chat: defaultChatModels,
    };
  }

  async getModelList(): Promise<ModelList> {
    const defaultModels = await this.getDefaultModels();
    const configProvider = getConfiguredModelProviderById(this.id)!;

    return {
      embedding: [
        ...defaultModels.embedding,
        ...configProvider.embeddingModels,
      ],
      chat: [...defaultModels.chat, ...configProvider.chatModels],
    };
  }

  async loadChatModel(key: string): Promise<BaseLLM<any>> {
    const modelList = await this.getModelList();

    const exists = modelList.chat.find((m) => m.key === key);

    if (!exists) {
      throw new Error(
        'Error Loading Vercel AI Gateway Chat Model. Invalid Model Selected',
      );
    }

    return new VercelAILLM({
      apiKey: this.config.apiKey,
      model: key,
      baseURL: this.config.baseURL,
    });
  }

  async loadEmbeddingModel(key: string): Promise<BaseEmbedding<any>> {
    throw new Error(
      'Vercel AI Gateway Provider does not support embedding models.',
    );
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
