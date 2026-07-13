import { closeApiServer, createApiServer, listen } from "./api/server.js";
import { loadCredentials, loadLiveConfig } from "./runtime/config.js";
import { LiveDesk } from "./runtime/liveDesk.js";

async function main(): Promise<void> {
  const config = loadLiveConfig();
  const credentials = loadCredentials(config);
  const desk = new LiveDesk(config, credentials);
  const server = createApiServer(desk, config);
  await listen(server, config.port);
  await desk.start();
  console.log(
    JSON.stringify({
      event: "tissue.started",
      mode: config.mode,
      execution: "quote-publication",
      network: config.network,
      origin: config.origin,
      api: `http://0.0.0.0:${config.port}`,
    }),
  );
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await desk.stop();
      await closeApiServer(server);
      process.exit(0);
    } catch (error) {
      console.error(JSON.stringify({
        event: "tissue.shutdown_failed",
        error: error instanceof Error ? error.message : String(error),
      }));
      process.exit(1);
    }
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "tissue.start_failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
