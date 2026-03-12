import mcpClientManager from './client';
import { getMcpServers } from '@/lib/config/serverRegistry';

let initialized = false;

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
  await ensureMcpConnected();

  const tools = mcpClientManager.listTools();
  const memoryTool = tools.find(
    (t) => t.name === 'search_memory' || t.name === 'search_memories',
  );

  if (!memoryTool) return null;

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

    return text || null;
  } catch (err) {
    console.error('[MCP] Memory search failed:', err);
    return null;
  }
}

export async function addMemory(
  content: string,
): Promise<boolean> {
  await ensureMcpConnected();

  const tools = mcpClientManager.listTools();
  const memoryTool = tools.find(
    (t) => t.name === 'add_memory' || t.name === 'add_memories',
  );

  if (!memoryTool) return false;

  try {
    await mcpClientManager.callTool(
      memoryTool.serverName,
      memoryTool.name,
      { content },
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
