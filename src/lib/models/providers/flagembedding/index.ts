import { UIConfigField } from '@/lib/config/types';
import { Model, ModelList, ProviderMetadata } from '../../types';
import BaseModelProvider from '../../base/provider';
import BaseLLM from '../../base/llm';
import BaseEmbedding from '../../base/embedding';
import FlagEmbedding from './flagEmbedding';

interface FlagEmbeddingConfig {
  apiUrl: string;
  apiKey: string;
}

const defaultEmbeddingModels: Model[] = [
  {
    name: 'BGE-M3',
    key: 'BAAI/bge-m3',
  },
];

const providerConfigFields: UIConfigField[] = [
  {
    type: 'string',
    name: 'API URL',
    key: 'apiUrl',
    description: 'Base URL of the FlagEmbedding API service',
    required: true,
    placeholder: 'http://localhost:8000',
    env: 'FLAG_EMBEDDING_API_URL',
    scope: 'server',
  },
  {
    type: 'password',
    name: 'API Key',
    key: 'apiKey',
    description: 'Optional API key for the FlagEmbedding service',
    required: false,
    placeholder: 'API Key (optional)',
    default: '',
    env: 'FLAG_EMBEDDING_API_KEY',
    scope: 'server',
  },
];

class FlagEmbeddingProvider extends BaseModelProvider<FlagEmbeddingConfig> {
  constructor(id: string, name: string, config: FlagEmbeddingConfig) {
    super(id, name, config);
  }

  async getDefaultModels(): Promise<ModelList> {
    return {
      embedding: [...defaultEmbeddingModels],
      chat: [],
    };
  }

  async getModelList(): Promise<ModelList> {
    const { getConfiguredModelProviderById } = await import('@/lib/config/serverRegistry');
    const defaultModels = await this.getDefaultModels();
    const configProvider = getConfiguredModelProviderById(this.id)!;

    return {
      embedding: [
        ...defaultModels.embedding,
        ...configProvider.embeddingModels,
      ],
      chat: [],
    };
  }

  async loadChatModel(_key: string): Promise<BaseLLM<any>> {
    throw new Error('FlagEmbedding Provider does not support chat models.');
  }

  async loadEmbeddingModel(_key: string): Promise<BaseEmbedding<any>> {
    return new FlagEmbedding({
      apiUrl: this.config.apiUrl,
      apiKey: this.config.apiKey || undefined,
    });
  }

  static parseAndValidate(raw: any): FlagEmbeddingConfig {
    if (!raw || typeof raw !== 'object')
      throw new Error('Invalid config provided. Expected object');
    if (!raw.apiUrl)
      throw new Error('Invalid config provided. API URL must be provided');

    return {
      apiUrl: String(raw.apiUrl),
      apiKey: String(raw.apiKey || ''),
    };
  }

  static getProviderConfigFields(): UIConfigField[] {
    return providerConfigFields;
  }

  static getProviderMetadata(): ProviderMetadata {
    return {
      key: 'flagembedding',
      name: 'FlagEmbedding',
    };
  }
}

export default FlagEmbeddingProvider;
