import configManager from '@/lib/config';
import ModelRegistry from '@/lib/models/registry';
import { NextRequest, NextResponse } from 'next/server';
import { ConfigModelProvider } from '@/lib/config/types';

type SaveConfigBody = {
  key: string;
  value: unknown;
};

export const GET = async (req: NextRequest) => {
  try {
    // Load DB-backed config sections before reading current values.
    try {
      await Promise.all([
        configManager.loadMcpServersFromDb(),
        configManager.loadModelProvidersFromDb(),
      ]);
    } catch (err) {
      console.error('Failed to load DB-backed config, using config.json:', err);
    }

    const values = configManager.getCurrentConfig();
    const fields = configManager.getUIConfigSections();

    const modelRegistry = new ModelRegistry();
    const modelProviders = await modelRegistry.getActiveProviders();

    values.modelProviders = values.modelProviders.map(
      (mp: ConfigModelProvider) => {
        const activeProvider = modelProviders.find((p) => p.id === mp.id);
        const customChatKeys = new Set(mp.chatModels.map((model) => model.key));
        const customEmbeddingKeys = new Set(
          mp.embeddingModels.map((model) => model.key),
        );

        return {
          ...mp,
          chatModels: (activeProvider?.chatModels ?? mp.chatModels).map(
            (model) => ({
              ...model,
              isCustom: customChatKeys.has(model.key),
            }),
          ),
          embeddingModels: (
            activeProvider?.embeddingModels ?? mp.embeddingModels
          ).map((model) => ({
            ...model,
            isCustom: customEmbeddingKeys.has(model.key),
          })),
        };
      },
    );

    return NextResponse.json({
      values,
      fields,
    });
  } catch (err) {
    console.error('Error in getting config: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const body: SaveConfigBody = await req.json();

    if (!body.key || body.value === undefined) {
      return Response.json(
        {
          message: 'Key and value are required.',
        },
        {
          status: 400,
        },
      );
    }

    let shouldReconnectMcp = false;
    let reconnected = false;
    let reconnectError: string | null = null;

    // Persist MCP server changes to DB alongside config.json
    if (body.key === 'mcpServers') {
      await configManager.syncMcpServersWithDb(body.value as any);
      shouldReconnectMcp = true;
    } else if (body.key.startsWith('mcpServers.')) {
      const serverName = body.key.split('.').slice(1).join('.');
      await configManager.setMcpServerWithDb(serverName, body.value as any);
      shouldReconnectMcp = true;
    } else {
      configManager.updateConfig(body.key, body.value);
    }

    if (shouldReconnectMcp) {
      try {
        const { reconnectMcp } = await import('@/lib/mcp');
        await reconnectMcp();
        reconnected = true;
      } catch (err) {
        reconnectError = err instanceof Error ? err.message : 'Unknown MCP reconnect error';
        console.error('Failed to reconnect MCP after config update:', err);
      }
    }

    return Response.json(
      {
        message: shouldReconnectMcp
          ? reconnected
            ? 'Config updated successfully and MCP reconnected.'
            : 'Config updated successfully, but MCP reconnect failed.'
          : 'Config updated successfully.',
        reconnected,
        reconnectError,
      },
      {
        status: 200,
      },
    );
  } catch (err) {
    console.error('Error in getting config: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
