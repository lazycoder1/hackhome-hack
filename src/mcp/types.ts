export type McpToolClient = {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
};
