export interface McpServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
  toolTimeout?: number;
}

export interface McpServersConfig {
  [serverName: string]: McpServerConfig;
}

export interface McpToolInfo {
  serverName: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}
