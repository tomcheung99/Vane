import mcpClientManager from './client';
import { getMcpServers } from '@/lib/config/serverRegistry';

let initialized = false;

const MEMORY_SEARCH_TOOL_NAMES = [
  'search_memory',
  'search_memories',
  'openmemory_query',
];

const MEMORY_ADD_TOOL_NAMES = [
  'add_memory',
  'add_memories',
  'openmemory_store',
];

export type McpUsageMetadata = {
  serverName: string;
  toolName: string;
};

export async function ensureMcpConnected(): Promise<void> {
  if (initialized) return;

  const servers = getMcpServers();
  if (Object.keys(servers).length === 0) return;

  try {
    await mcpClientManager.connectAll(servers);
    initialized = true;
  } catch (err) {
    console.error('[MCP] Failed to initialize connections:', err);
  }
}

export async function reconnectMcp(): Promise<void> {
  initialized = false;
  await mcpClientManager.disconnectAll();
  await ensureMcpConnected();
}

export async function searchMemories(query: string): Promise<string | null> {
  const result = await searchMemoriesWithMetadata(query);
  return result.content;
}

export async function searchMemoriesWithMetadata(
  query: string,
): Promise<{ content: string | null; usage: McpUsageMetadata | null }> {
  await ensureMcpConnected();

  const tools = mcpClientManager.listTools();
  const memoryTool = tools.find((t) => MEMORY_SEARCH_TOOL_NAMES.includes(t.name));

  if (!memoryTool) {
    return {
      content: null,
      usage: null,
    };
  }

  try {
    const result = await mcpClientManager.callTool(
      memoryTool.serverName,
      memoryTool.name,
      { query },
    );

    const text = result.content
      ?.filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n');

    return {
      content: text || null,
      usage: {
        serverName: memoryTool.serverName,
        toolName: memoryTool.name,
      },
    };
  } catch (err) {
    console.error('[MCP] Memory search failed:', err);
    return {
      content: null,
      usage: {
        serverName: memoryTool.serverName,
        toolName: memoryTool.name,
      },
    };
  }
}

export async function addMemory(
  content: string,
  options?: { tags?: string[]; metadata?: Record<string, unknown> },
): Promise<boolean> {
  await ensureMcpConnected();

  const tools = mcpClientManager.listTools();
  const memoryTool = tools.find((t) => MEMORY_ADD_TOOL_NAMES.includes(t.name));

  if (!memoryTool) return false;

  try {
    let args: Record<string, unknown>;

    if (memoryTool.name === 'openmemory_store') {
      args = {
        content,
        type: 'contextual',
        ...(options?.tags?.length ? { tags: options.tags } : {}),
        ...(options?.metadata ? { metadata: options.metadata } : {}),
      };
    } else {
      args = { content };
    }

    await mcpClientManager.callTool(
      memoryTool.serverName,
      memoryTool.name,
      args,
    );
    return true;
  } catch (err) {
    console.error('[MCP] Memory add failed:', err);
    return false;
  }
}

export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
) {
  await ensureMcpConnected();
  return mcpClientManager.callTool(serverName, toolName, args);
}

export async function listAvailableTools() {
  await ensureMcpConnected();
  return mcpClientManager.listTools();
}
