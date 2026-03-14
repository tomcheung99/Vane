import path from 'node:path';
import fs from 'fs';
import { Config, ConfigModelProvider, UIConfigSections } from './types';
import { hashObj } from '../serverUtils';
import { getModelProvidersUIConfigSection } from '../models/providers';

class ConfigManager {
  configPath: string = path.join(
    process.env.DATA_DIR || process.cwd(),
    '/data/config.json',
  );
  configVersion = 1;
  currentConfig: Config = {
    version: this.configVersion,
    setupComplete: false,
    preferences: {},
    personalization: {},
    modelProviders: [],
    search: {
      searxngURL: '',
    },
    mcpServers: {},
  };
  uiConfigSections: UIConfigSections = {
    preferences: [
      {
        name: 'Theme',
        key: 'theme',
        type: 'select',
        options: [
          {
            name: 'Light',
            value: 'light',
          },
          {
            name: 'Dark',
            value: 'dark',
          },
        ],
        required: false,
        description: 'Choose between light and dark layouts for the app.',
        default: 'dark',
        scope: 'client',
      },
      {
        name: 'Measurement Unit',
        key: 'measureUnit',
        type: 'select',
        options: [
          {
            name: 'Imperial',
            value: 'Imperial',
          },
          {
            name: 'Metric',
            value: 'Metric',
          },
        ],
        required: false,
        description: 'Choose between Metric  and Imperial measurement unit.',
        default: 'Metric',
        scope: 'client',
      },
      {
        name: 'Auto video & image search',
        key: 'autoMediaSearch',
        type: 'switch',
        required: false,
        description: 'Automatically search for relevant images and videos.',
        default: true,
        scope: 'client',
      },
      {
        name: 'Show weather widget',
        key: 'showWeatherWidget',
        type: 'switch',
        required: false,
        description: 'Display the weather card on the home screen.',
        default: true,
        scope: 'client',
      },
      {
        name: 'Show news widget',
        key: 'showNewsWidget',
        type: 'switch',
        required: false,
        description: 'Display the recent news card on the home screen.',
        default: true,
        scope: 'client',
      },
      {
        name: 'Reranker',
        key: 'rerankerEnabled',
        type: 'switch',
        required: false,
        description: 'Enable bge-reranker-v2-m3 to rerank search results for better relevance.',
        default: true,
        scope: 'server',
      },
      {
        name: 'Reranker Top N Candidates',
        key: 'rerankerTopN',
        type: 'select',
        options: [
          { name: '20', value: '20' },
          { name: '50', value: '50' },
          { name: '100', value: '100' },
          { name: '200', value: '200' },
        ],
        required: false,
        description: 'Number of candidates to pass to the reranker. Higher values improve quality but are slower.',
        default: '100',
        scope: 'server',
      },
    ],
    personalization: [
      {
        name: 'System Instructions',
        key: 'systemInstructions',
        type: 'textarea',
        required: false,
        description: 'Add custom behavior or tone for the model.',
        placeholder:
          'e.g., "Respond in a friendly and concise tone" or "Use British English and format answers as bullet points."',
        scope: 'client',
      },
    ],
    modelProviders: [],
    search: [
      {
        name: 'SearXNG URL',
        key: 'searxngURL',
        type: 'string',
        required: false,
        description: 'The URL of your SearXNG instance',
        placeholder: 'http://localhost:4000',
        default: '',
        scope: 'server',
        env: 'SEARXNG_API_URL',
      },
    ],
  };

  constructor() {
    this.initialize();
  }

  private initialize() {
    this.initializeConfig();
    this.initializeFromEnv();
  }

  private saveConfig() {
    fs.writeFileSync(
      this.configPath,
      JSON.stringify(this.currentConfig, null, 2),
    );
  }

  private initializeConfig() {
    const exists = fs.existsSync(this.configPath);
    if (!exists) {
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.currentConfig, null, 2),
      );
    } else {
      try {
        this.currentConfig = JSON.parse(
          fs.readFileSync(this.configPath, 'utf-8'),
        );
      } catch (err) {
        if (err instanceof SyntaxError) {
          console.error(
            `Error parsing config file at ${this.configPath}:`,
            err,
          );
          console.log(
            'Loading default config and overwriting the existing file.',
          );
          fs.writeFileSync(
            this.configPath,
            JSON.stringify(this.currentConfig, null, 2),
          );
          return;
        } else {
          console.log('Unknown error reading config file:', err);
        }
      }

      this.currentConfig = this.migrateConfig(this.currentConfig);
    }
  }

  private migrateConfig(config: Config): Config {
    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    return config;
  }

  private initializeFromEnv() {
    /* providers section*/
    const providerConfigSections = getModelProvidersUIConfigSection();

    this.uiConfigSections.modelProviders = providerConfigSections;

    const newProviders: ConfigModelProvider[] = [];

    providerConfigSections.forEach((provider) => {
      const newProvider: ConfigModelProvider & { required?: string[] } = {
        id: crypto.randomUUID(),
        name: `${provider.name}`,
        type: provider.key,
        chatModels: [],
        embeddingModels: [],
        config: {},
        required: [],
        hash: '',
      };

      provider.fields.forEach((field) => {
        newProvider.config[field.key] =
          process.env[field.env!] ||
          field.default ||
          ''; /* Env var must exist for providers */

        if (field.required) newProvider.required?.push(field.key);
      });

      let configured = true;

      newProvider.required?.forEach((r) => {
        if (!newProvider.config[r]) {
          configured = false;
        }
      });

      if (configured) {
        const hash = hashObj(newProvider.config);
        newProvider.hash = hash;
        delete newProvider.required;

        const exists = this.currentConfig.modelProviders.find(
          (p) => p.hash === hash,
        );

        if (!exists) {
          newProviders.push(newProvider);
        }
      }
    });

    this.currentConfig.modelProviders.push(...newProviders);

    /* search section */
    this.uiConfigSections.search.forEach((f) => {
      if (f.env && !this.currentConfig.search[f.key]) {
        this.currentConfig.search[f.key] =
          process.env[f.env] ?? f.default ?? '';
      }
    });

    this.saveConfig();
  }

  public getConfig(key: string, defaultValue?: any): any {
    const nested = key.split('.');
    let obj: any = this.currentConfig;

    for (let i = 0; i < nested.length; i++) {
      const part = nested[i];
      if (obj == null) return defaultValue;

      obj = obj[part];
    }

    return obj === undefined ? defaultValue : obj;
  }

  public updateConfig(key: string, val: any) {
    const parts = key.split('.');
    if (parts.length === 0) return;

    let target: any = this.currentConfig;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (target[part] === null || typeof target[part] !== 'object') {
        target[part] = {};
      }

      target = target[part];
    }

    const finalKey = parts[parts.length - 1];
    target[finalKey] = val;

    this.saveConfig();
  }

  public addModelProvider(type: string, name: string, config: any) {
    const newModelProvider: ConfigModelProvider = {
      id: crypto.randomUUID(),
      name,
      type,
      config,
      chatModels: [],
      embeddingModels: [],
      hash: hashObj(config),
    };

    this.currentConfig.modelProviders.push(newModelProvider);
    this.saveConfig();

    return newModelProvider;
  }

  public async addModelProviderWithDb(type: string, name: string, config: any) {
    const newModelProvider = this.addModelProvider(type, name, config);
    const { upsertModelProvider } = await import('../db/modelProviders');
    await upsertModelProvider(newModelProvider);
    return newModelProvider;
  }

  public removeModelProvider(id: string) {
    const index = this.currentConfig.modelProviders.findIndex(
      (p) => p.id === id,
    );

    if (index === -1) return;

    this.currentConfig.modelProviders =
      this.currentConfig.modelProviders.filter((p) => p.id !== id);

    this.saveConfig();
  }

  public async removeModelProviderWithDb(id: string) {
    this.removeModelProvider(id);
    const { deleteModelProvider } = await import('../db/modelProviders');
    await deleteModelProvider(id);
  }

  public async updateModelProvider(id: string, name: string, config: any) {
    const provider = this.currentConfig.modelProviders.find((p) => {
      return p.id === id;
    });

    if (!provider) throw new Error('Provider not found');

    provider.name = name;
    provider.config = config;
    provider.hash = hashObj(config);

    this.saveConfig();

    return provider;
  }

  public async updateModelProviderWithDb(id: string, name: string, config: any) {
    const provider = await this.updateModelProvider(id, name, config);
    const { upsertModelProvider } = await import('../db/modelProviders');
    await upsertModelProvider(provider);
    return provider;
  }

  public addProviderModel(
    providerId: string,
    type: 'embedding' | 'chat',
    model: any,
  ) {
    const provider = this.currentConfig.modelProviders.find(
      (p) => p.id === providerId,
    );

    if (!provider) throw new Error('Invalid provider id');

    delete model.type;
    model.isCustom = true;

    if (type === 'chat') {
      provider.chatModels.push(model);
    } else {
      provider.embeddingModels.push(model);
    }

    this.saveConfig();

    return model;
  }

  public async addProviderModelWithDb(
    providerId: string,
    type: 'embedding' | 'chat',
    model: any,
  ) {
    const addedModel = this.addProviderModel(providerId, type, model);
    const provider = this.currentConfig.modelProviders.find((p) => {
      return p.id === providerId;
    });

    if (!provider) throw new Error('Invalid provider id');

    const { upsertModelProvider } = await import('../db/modelProviders');
    await upsertModelProvider(provider);

    return addedModel;
  }

  public removeProviderModel(
    providerId: string,
    type: 'embedding' | 'chat',
    modelKey: string,
  ) {
    const provider = this.currentConfig.modelProviders.find(
      (p) => p.id === providerId,
    );

    if (!provider) throw new Error('Invalid provider id');

    if (type === 'chat') {
      provider.chatModels = provider.chatModels.filter(
        (m) => m.key !== modelKey,
      );
    } else {
      provider.embeddingModels = provider.embeddingModels.filter(
        (m) => m.key != modelKey,
      );
    }

    this.saveConfig();
  }

  public async removeProviderModelWithDb(
    providerId: string,
    type: 'embedding' | 'chat',
    modelKey: string,
  ) {
    this.removeProviderModel(providerId, type, modelKey);
    const provider = this.currentConfig.modelProviders.find(
      (p) => p.id === providerId,
    );

    if (!provider) throw new Error('Invalid provider id');

    const { upsertModelProvider } = await import('../db/modelProviders');
    await upsertModelProvider(provider);
  }

  public isSetupComplete() {
    return this.currentConfig.setupComplete;
  }

  public markSetupComplete() {
    if (!this.currentConfig.setupComplete) {
      this.currentConfig.setupComplete = true;
    }

    this.saveConfig();
  }

  public getUIConfigSections(): UIConfigSections {
    return this.uiConfigSections;
  }

  public getCurrentConfig(): Config {
    return JSON.parse(JSON.stringify(this.currentConfig));
  }

  public getMcpServers(): Config['mcpServers'] {
    return this.currentConfig.mcpServers || {};
  }

  public setMcpServer(name: string, entry: Config['mcpServers'][string]) {
    if (!this.currentConfig.mcpServers) {
      this.currentConfig.mcpServers = {};
    }
    this.currentConfig.mcpServers[name] = entry;
    this.saveConfig();
  }

  public removeMcpServer(name: string) {
    if (this.currentConfig.mcpServers) {
      delete this.currentConfig.mcpServers[name];
      this.saveConfig();
    }
  }

  /** Load MCP servers from DB into in-memory config (DB is source of truth). */
  public async loadMcpServersFromDb(): Promise<void> {
    const { getAllMcpServers } = await import('../db/mcpServers');
    const servers = await getAllMcpServers();
    this.currentConfig.mcpServers = servers;
  }

  /** Load model providers from DB into in-memory config (DB is source of truth). */
  public async loadModelProvidersFromDb(): Promise<void> {
    const { getAllModelProviders } = await import('../db/modelProviders');
    const providers = await getAllModelProviders();
    if (providers.length > 0) {
      this.currentConfig.modelProviders = providers;
    }
  }

  /** Save a single MCP server to both config.json and DB. */
  public async setMcpServerWithDb(name: string, entry: Config['mcpServers'][string]): Promise<void> {
    this.setMcpServer(name, entry);
    const { upsertMcpServer } = await import('../db/mcpServers');
    await upsertMcpServer(name, entry);
  }

  /** Remove a single MCP server from both config.json and DB. */
  public async removeMcpServerWithDb(name: string): Promise<void> {
    this.removeMcpServer(name);
    const { deleteMcpServer } = await import('../db/mcpServers');
    await deleteMcpServer(name);
  }

  /** Replace all MCP servers in both config.json and DB. */
  public async syncMcpServersWithDb(servers: Config['mcpServers']): Promise<void> {
    this.currentConfig.mcpServers = servers;
    this.saveConfig();
    const { syncAllMcpServersToDb } = await import('../db/mcpServers');
    await syncAllMcpServersToDb(servers);
  }
}

const configManager = new ConfigManager();

export default configManager;
