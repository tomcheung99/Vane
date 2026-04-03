import { ConfigModelProvider } from '../config/types';
import BaseModelProvider, { createProviderInstance } from './base/provider';
import { getConfiguredModelProviders, getEmbeddingModelProviderId, getEmbeddingModelKey } from '../config/serverRegistry';
import { providers } from './providers';
import { MinimalProvider, ModelList } from './types';
import configManager from '../config';

class ModelRegistry {
  private initPromise: Promise<void> | null = null;
  activeProviders: (ConfigModelProvider & {
    provider: BaseModelProvider<any>;
  })[] = [];

  private buildActiveProviders() {
    this.activeProviders = [];
    const configuredProviders = getConfiguredModelProviders();

    configuredProviders.forEach((p) => {
      try {
        const provider = providers[p.type];
        if (!provider) throw new Error('Invalid provider type');

        this.activeProviders.push({
          ...p,
          provider: createProviderInstance(provider, p.id, p.name, p.config),
        });
      } catch (err) {
        console.error(
          `Failed to initialize provider. Type: ${p.type}, ID: ${p.id}, Config: ${JSON.stringify(p.config)}, Error: ${err}`,
        );
      }
    });
  }

  private ensureInitialized() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          await configManager.loadModelProvidersFromDb();
        } catch (err) {
          console.error('Failed to load model providers from DB, using config.json:', err);
        }
        this.buildActiveProviders();
      })();
    }
    return this.initPromise;
  }

  async getActiveProviders() {
    await this.ensureInitialized();
    const providers: MinimalProvider[] = [];

    await Promise.all(
      this.activeProviders.map(async (p) => {
        let m: ModelList = { chat: [], embedding: [] };

        try {
          m = await p.provider.getModelList();
        } catch (err: any) {
          console.error(
            `Failed to get model list. Type: ${p.type}, ID: ${p.id}, Error: ${err.message}`,
          );

          m = {
            chat: [
              {
                key: 'error',
                name: err.message,
              },
            ],
            embedding: [],
          };
        }

        providers.push({
          id: p.id,
          name: p.name,
          chatModels: m.chat,
          embeddingModels: m.embedding,
        });
      }),
    );

    return providers;
  }

  async loadChatModel(providerId: string, modelName: string) {
    await this.ensureInitialized();
    const provider = this.activeProviders.find((p) => p.id === providerId);

    if (!provider) throw new Error('Invalid provider id');

    const model = await provider.provider.loadChatModel(modelName);

    return model;
  }

  async loadEmbeddingModel(providerId: string, modelName: string) {
    await this.ensureInitialized();
    const provider = this.activeProviders.find((p) => p.id === providerId);

    if (!provider) throw new Error('Invalid provider id');

    const model = await provider.provider.loadEmbeddingModel(modelName);

    return model;
  }

  async loadDefaultEmbeddingModel() {
    await this.ensureInitialized();

    // If the user has explicitly selected an embedding model, use it
    const preferredProviderId = getEmbeddingModelProviderId();
    const preferredModelKey = getEmbeddingModelKey();
    console.log(`[Embedding] Preferred config: providerId="${preferredProviderId}", modelKey="${preferredModelKey}"`);
    console.log(`[Embedding] Active providers: ${this.activeProviders.map((p) => `${p.id}(${p.type}/${p.name})`).join(', ')}`);
    if (preferredProviderId && preferredModelKey) {
      const preferred = this.activeProviders.find((p) => p.id === preferredProviderId);
      if (preferred) {
        try {
          console.log(`[Embedding] Loading preferred: ${preferredProviderId}/${preferredModelKey}`);
          return await preferred.provider.loadEmbeddingModel(preferredModelKey);
        } catch (err) {
          console.warn(`Preferred embedding model failed (${preferredProviderId}/${preferredModelKey}), falling back:`, err);
        }
      } else {
        console.warn(`[Embedding] Preferred provider "${preferredProviderId}" not found in active providers`);
      }
    }

    // Prefer API-based providers over local transformers to avoid onnxruntime dependency
    const sortedProviders = [...this.activeProviders].sort((a, b) => {
      if (a.type === 'transformers' && b.type !== 'transformers') return 1;
      if (a.type !== 'transformers' && b.type === 'transformers') return -1;
      return 0;
    });

    for (const p of sortedProviders) {
      try {
        const models = await p.provider.getModelList();
        if (models.embedding.length > 0) {
          return await p.provider.loadEmbeddingModel(models.embedding[0].key);
        }
      } catch (err) {
        console.warn(`Skipping embedding provider ${p.name} (${p.type}):`, err);
        continue;
      }
    }

    throw new Error('No embedding model available. Please configure one in Settings.');
  }

  async addProvider(
    type: string,
    name: string,
    config: Record<string, any>,
  ): Promise<ConfigModelProvider> {
    await this.ensureInitialized();
    const provider = providers[type];
    if (!provider) throw new Error('Invalid provider type');

    const newProvider = await configManager.addModelProviderWithDb(
      type,
      name,
      config,
    );

    const instance = createProviderInstance(
      provider,
      newProvider.id,
      newProvider.name,
      newProvider.config,
    );

    let m: ModelList = { chat: [], embedding: [] };

    try {
      m = await instance.getModelList();
    } catch (err: any) {
      console.error(
        `Failed to get model list for newly added provider. Type: ${type}, ID: ${newProvider.id}, Error: ${err.message}`,
      );

      m = {
        chat: [
          {
            key: 'error',
            name: err.message,
          },
        ],
        embedding: [],
      };
    }

    this.activeProviders.push({
      ...newProvider,
      provider: instance,
    });

    return {
      ...newProvider,
      chatModels: m.chat || [],
      embeddingModels: m.embedding || [],
    };
  }

  async removeProvider(providerId: string): Promise<void> {
    await this.ensureInitialized();
    await configManager.removeModelProviderWithDb(providerId);
    this.activeProviders = this.activeProviders.filter(
      (p) => p.id !== providerId,
    );

    return;
  }

  async updateProvider(
    providerId: string,
    name: string,
    config: any,
  ): Promise<ConfigModelProvider> {
    await this.ensureInitialized();
    const updated = await configManager.updateModelProviderWithDb(
      providerId,
      name,
      config,
    );
    const instance = createProviderInstance(
      providers[updated.type],
      providerId,
      name,
      config,
    );

    let m: ModelList = { chat: [], embedding: [] };

    try {
      m = await instance.getModelList();
    } catch (err: any) {
      console.error(
        `Failed to get model list for updated provider. Type: ${updated.type}, ID: ${updated.id}, Error: ${err.message}`,
      );

      m = {
        chat: [
          {
            key: 'error',
            name: err.message,
          },
        ],
        embedding: [],
      };
    }

    this.activeProviders = this.activeProviders.filter((p) => p.id !== providerId);
    this.activeProviders.push({
      ...updated,
      provider: instance,
    });

    return {
      ...updated,
      chatModels: m.chat || [],
      embeddingModels: m.embedding || [],
    };
  }

  /* Using async here because maybe in the future we might want to add some validation?? */
  async addProviderModel(
    providerId: string,
    type: 'embedding' | 'chat',
    model: any,
  ): Promise<any> {
    await this.ensureInitialized();
    const addedModel = await configManager.addProviderModelWithDb(
      providerId,
      type,
      model,
    );
    return addedModel;
  }

  async removeProviderModel(
    providerId: string,
    type: 'embedding' | 'chat',
    modelKey: string,
  ): Promise<void> {
    await this.ensureInitialized();
    await configManager.removeProviderModelWithDb(providerId, type, modelKey);
    return;
  }
}

export default ModelRegistry;
