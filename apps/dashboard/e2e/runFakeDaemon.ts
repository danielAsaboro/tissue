import { startFakeDaemon } from "./fakeDaemon.js";

/** Standalone entrypoint — started by Playwright's webServer config on a fixed port,
 *  separate from the Next.js process. Tests reconfigure it via POST /__admin__/state. */
const port = Number(process.env.FAKE_DAEMON_PORT ?? 8799);

startFakeDaemon({ status: "quoting" }, port).then((daemon) => {
  console.log(`fake daemon listening on ${daemon.url}`);
});
