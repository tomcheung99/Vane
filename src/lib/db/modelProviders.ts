import { eq } from 'drizzle-orm';
import db from './index';
import { modelProviders } from './schema';
import type { ConfigModelProvider } from '../config/types';

export async function getAllModelProviders(): Promise<ConfigModelProvider[]> {
  const rows = await db.select().from(modelProviders);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    config: row.config as ConfigModelProvider['config'],
    chatModels: row.chatModels ?? [],
    embeddingModels: row.embeddingModels ?? [],
    hash: row.hash,
  }));
}

export async function upsertModelProvider(
  provider: ConfigModelProvider,
): Promise<void> {
  await db
    .insert(modelProviders)
    .values({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      config: provider.config,
      chatModels: provider.chatModels,
      embeddingModels: provider.embeddingModels,
      hash: provider.hash,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: modelProviders.id,
      set: {
        name: provider.name,
        type: provider.type,
        config: provider.config,
        chatModels: provider.chatModels,
        embeddingModels: provider.embeddingModels,
        hash: provider.hash,
      },
    });
}

export async function deleteModelProvider(id: string): Promise<void> {
  await db.delete(modelProviders).where(eq(modelProviders.id, id));
}

export async function syncAllModelProvidersToDb(
  providers: ConfigModelProvider[],
): Promise<void> {
  const existing = await getAllModelProviders();
  const nextIds = new Set(providers.map((provider) => provider.id));

  for (const provider of existing) {
    if (!nextIds.has(provider.id)) {
      await deleteModelProvider(provider.id);
    }
  }

  for (const provider of providers) {
    await upsertModelProvider(provider);
  }
}

export async function seedModelProvidersFromConfig(): Promise<void> {
  const existing = await getAllModelProviders();
  if (existing.length > 0) return;

  const configManager = (await import('../config/index')).default;
  const configProviders = configManager.getConfig('modelProviders', []);

  for (const provider of configProviders as ConfigModelProvider[]) {
    await upsertModelProvider(provider);
  }

  if (configProviders.length > 0) {
    console.log(
      `[Models] Seeded ${configProviders.length} provider connection(s) from config.json to database`,
    );
  }
}
