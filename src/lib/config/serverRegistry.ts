import configManager from './index';
import { ConfigModelProvider, McpServerEntry } from './types';

export const getConfiguredModelProviders = (): ConfigModelProvider[] => {
  return configManager.getConfig('modelProviders', []);
};

export const getConfiguredModelProviderById = (
  id: string,
): ConfigModelProvider | undefined => {
  return getConfiguredModelProviders().find((p) => p.id === id) ?? undefined;
};

export const getSearxngURL = () =>
  configManager.getConfig('search.searxngURL', '');

export const getGluetunAPIURL = () =>
  configManager.getConfig('search.gluetunAPIURL', '');

export const getMcpServers = (): Record<string, McpServerEntry> =>
  configManager.getMcpServers();

export const getRerankerEnabled = (): boolean =>
  configManager.getConfig('preferences.rerankerEnabled', true);

export const getRerankerTopN = (): number =>
  parseInt(configManager.getConfig('preferences.rerankerTopN', '100'), 10);

export const getRetrievalApiUrl = (): string =>
  configManager.getConfig('preferences.retrievalApiUrl', '');

export const getRetrievalApiKey = (): string =>
  configManager.getConfig('preferences.retrievalApiKey', '');

export const getColbertEnabled = (): boolean =>
  configManager.getConfig('preferences.colbertEnabled', false);
