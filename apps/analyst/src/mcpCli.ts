import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "./mcp.js";
import { loadTissueSlipConfig, TissueSlipConsumer } from "@tissue/slip";

async function main(): Promise<void> {
  const slipConfig = loadTissueSlipConfig();
  const { server } = buildMcpServer(undefined, slipConfig ? new TissueSlipConsumer(slipConfig) : null);
  await server.connect(new StdioServerTransport());
  console.error("[analyst-mcp] tissue-analyst MCP server on stdio (read-only)");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
