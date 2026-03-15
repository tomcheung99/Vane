import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServerConfig, McpServersConfig, McpToolInfo, McpToolResult } from './types';

interface ConnectedServer {
  client: Client;
  transport: SSEClientTransport | StreamableHTTPClientTransport;
  tools: McpToolInfo[];
}

/** Strip non-Latin1 chars (>255) from header values to prevent ByteString errors */
function sanitizeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[^\x00-\xFF]/g, '');
}

function sanitizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[sanitizeHeaderValue(k)] = sanitizeHeaderValue(v);
  }
  return out;
}

function createTransport(config: McpServerConfig) {
  const url = new URL(config.url);
  const headers: Record<string, string> = sanitizeHeaders(config.headers || {});

  if (config.type === 'http' || config.type === 'streamableHttp') {
    return new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers,
      },
    });
  }

  return new SSEClientTransport(url, {
    eventSourceInit: {
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        const newInit = { ...init };
        newInit.headers = {
          ...(newInit.headers as Record<string, string> || {}),
          ...headers,
        };
        return fetch(input, newInit);
      },
    },
    requestInit: {
      headers,
    },
  });
}

class McpClientManager {
  private servers: Map<string, ConnectedServer> = new Map();
  private connecting: Map<string, Promise<void>> = new Map();

  async connectAll(config: McpServersConfig): Promise<void> {
    // Disconnect servers that are no longer in config
    for (const name of this.servers.keys()) {
      if (!config[name]) {
        await this.disconnect(name);
      }
    }

    // Connect new/updated servers
    const promises = Object.entries(config).map(([name, serverConfig]) =>
      this.connect(name, serverConfig),
    );
    await Promise.allSettled(promises);
  }

  async connect(name: string, config: McpServerConfig): Promise<void> {
    // Avoid duplicate connections
    if (this.servers.has(name)) return;
    if (this.connecting.has(name)) {
      await this.connecting.get(name);
      return;
    }

    const connectPromise = this._connect(name, config);
    this.connecting.set(name, connectPromise);

    try {
      await connectPromise;
    } finally {
      this.connecting.delete(name);
    }
  }

  private async _connect(name: string, config: McpServerConfig): Promise<void> {
    const transport = createTransport(config);

    const client = new Client(
      { name: `vane-mcp-client/${name}`, version: '1.0.0' },
    );

    const timeout = (config.toolTimeout || 30) * 1000;

    try {
      await client.connect(transport, { timeout });

      const { tools } = await client.listTools(undefined, { timeout });

      const toolInfos: McpToolInfo[] = tools.map((t) => ({
        serverName: name,
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }));

      this.servers.set(name, { client, transport, tools: toolInfos });
      console.log(`[MCP] Connected to "${name}" via ${config.type} — ${toolInfos.length} tools available`);
    } catch (err) {
      console.error(`[MCP] Failed to connect to "${name}":`, err);
      try { await transport.close(); } catch { /* ignore */ }
      throw err;
    }
  }

  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;

    try {
      await server.transport.close();
    } catch { /* ignore */ }

    this.servers.delete(name);
    console.log(`[MCP] Disconnected from "${name}"`);
  }

  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.servers.keys()).map((name) =>
      this.disconnect(name),
    );
    await Promise.allSettled(promises);
  }

  listTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = [];
    for (const server of this.servers.values()) {
      tools.push(...server.tools);
    }
    return tools;
  }

  getToolsByServer(serverName: string): McpToolInfo[] {
    return this.servers.get(serverName)?.tools || [];
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server "${serverName}" is not connected`);
    }

    const result = await server.client.callTool(
      { name: toolName, arguments: args },
    );

    return result as McpToolResult;
  }

  isConnected(name: string): boolean {
    return this.servers.has(name);
  }

  getConnectedServers(): string[] {
    return Array.from(this.servers.keys());
  }
}

// Singleton
const mcpClientManager = new McpClientManager();
export default mcpClientManager;
