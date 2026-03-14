import type { ConfigModelProvider } from '@/lib/config/types';
import type { Model } from '@/lib/models/types';

const DEFAULT_MODEL_LIMIT = 5;

export const getVisibleSettingsModels = (
  provider: ConfigModelProvider,
  type: 'chat' | 'embedding',
): Model[] => {
  const models =
    type === 'chat' ? provider.chatModels : provider.embeddingModels;

  if (provider.type === 'vercelai') {
    return models.filter((model) => model.key !== 'error');
  }

  let defaultCount = 0;

  return models.filter((model) => {
    if (model.key === 'error') return false;
    if (model.isCustom) return true;
    if (defaultCount < DEFAULT_MODEL_LIMIT) {
      defaultCount += 1;
      return true;
    }
    return false;
  });
};
