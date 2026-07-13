import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "./mcp.js";

async function main(): Promise<void> {
  const { server } = buildMcpServer();
  await server.connect(new StdioServerTransport());
  console.error("[analyst-mcp] tissue-analyst MCP server on stdio (read-only)");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
