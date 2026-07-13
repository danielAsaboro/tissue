/* global AbortSignal, console, fetch, process, setTimeout */
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

const daemon = spawnSync(process.execPath, ["apps/daemon/dist/main.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, TISSUE_MODE: "invalid" },
});
if (daemon.status !== 1 || !daemon.stderr.includes("TISSUE_MODE=live is required")) {
  throw new Error(`compiled daemon did not enforce live configuration: ${daemon.stderr}`);
}

const port = 20_000 + (process.pid % 20_000);
const analyst = spawn(process.execPath, ["apps/analyst/dist/server.mjs"], {
  cwd: process.cwd(),
  stdio: ["ignore", "ignore", "pipe"],
  env: {
    ...process.env,
    ANALYST_PORT: String(port),
    TISSUE_CORPUS_DIR: `${process.cwd()}/corpus`,
  },
});
let analystStderr = "";
analyst.stderr.setEncoding("utf8");
analyst.stderr.on("data", (chunk) => { analystStderr += chunk; });

try {
  let response;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!response?.ok) throw new Error(`compiled analyst did not become healthy: ${analystStderr}`);
  const health = await response.json();
  if (health.alive !== true || health.readOnlyTools !== true) {
    throw new Error(`compiled analyst returned invalid health: ${JSON.stringify(health)}`);
  }
} finally {
  analyst.kill("SIGTERM");
  if (analyst.exitCode === null) await once(analyst, "exit");
}

console.log("compiled runtime verification passed");
