import mcpClientManager from './client';
import { getMcpServers } from '@/lib/config/serverRegistry';
import configManager from '@/lib/config';
import type { McpToolInfo } from './types';

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
  'create_memory',
  'save_memory',
  'store_memory',
];

/** Fuzzy match: find a tool whose name contains any of the keywords */
function findMemoryTool(
  tools: McpToolInfo[],
  exactNames: string[],
  keywords: string[],
): McpToolInfo | null {
  // Exact match first
  const exact = tools.find((t) => exactNames.includes(t.name));
  if (exact) return exact;
  // Fuzzy: tool name contains keyword (e.g. 'openmemory_add' matches 'add')
  const fuzzy = tools.find((t) => {
    const lower = t.name.toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
  });
  return fuzzy ?? null;
}

export type McpUsageMetadata = {
  serverName: string;
  toolName: string;
};

export async function ensureMcpConnected(): Promise<void> {
  if (initialized) return;

  // Load MCP servers from DB (source of truth), fall back to config.json
  try {
    await configManager.loadMcpServersFromDb();
  } catch {
    // DB not available yet — fall back to config.json
  }

  const servers = getMcpServers();
  if (Object.keys(servers).length === 0) return;

  try {
    await mcpClientManager.connectAll(servers);
    // Only mark initialized if at least one server actually connected
    const connected = mcpClientManager.getConnectedServers();
    if (connected.length > 0) {
      initialized = true;
      console.log(`[MCP] Initialized with ${connected.length} server(s): ${connected.join(', ')}`);
      // Log all available tools for debugging
      const allTools = mcpClientManager.listTools();
      console.log(`[MCP] Available tools: ${allTools.map(t => `${t.serverName}/${t.name}`).join(', ')}`);
    } else {
      console.warn('[MCP] No servers connected successfully — will retry on next call');
    }
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
  const memoryTool = findMemoryTool(tools, MEMORY_SEARCH_TOOL_NAMES, ['search', 'query', 'recall', 'retrieve']);

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
  const memoryTool = findMemoryTool(tools, MEMORY_ADD_TOOL_NAMES, ['add', 'create', 'save', 'store', 'insert', 'write']);

  if (!memoryTool) {
    console.warn(
      `[MCP] No memory-add tool found. Available tools: [${tools.map(t => t.name).join(', ')}]. ` +
      `Expected one of: ${MEMORY_ADD_TOOL_NAMES.join(', ')} (or name containing: add, create, save, store)`,
    );
    return false;
  }
  console.log(`[MCP] Using memory-add tool: ${memoryTool.serverName}/${memoryTool.name}`);

  try {
    // Build args based on the tool's input schema to handle different MCP servers
    const schemaProps = (memoryTool.inputSchema?.properties ?? {}) as Record<string, unknown>;
    const args: Record<string, unknown> = {};

    // Map content to whatever param the tool expects
    if ('content' in schemaProps) {
      args.content = content;
    } else if ('text' in schemaProps) {
      args.text = content;
    } else if ('memory' in schemaProps) {
      args.memory = content;
    } else if ('data' in schemaProps) {
      args.data = content;
    } else {
      // Fallback: use 'content'
      args.content = content;
    }

    // Pass optional fields if the schema accepts them
    if ('type' in schemaProps) args.type = 'contextual';
    if ('tags' in schemaProps && options?.tags?.length) args.tags = options.tags;
    if ('metadata' in schemaProps && options?.metadata) args.metadata = options.metadata;

    console.log(`[MCP] addMemory args: ${JSON.stringify(Object.keys(args))}`);

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
