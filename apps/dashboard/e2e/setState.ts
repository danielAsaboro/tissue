import type { FakeDeskState } from "./fakeDaemon.js";

const FAKE_DAEMON_URL = `http://127.0.0.1:${process.env.FAKE_DAEMON_PORT ?? 8799}`;

/** Reconfigures the fake daemon's desk state for the next request it serves. Call this
 *  before navigating, from within a Playwright test — the fake daemon is a separate
 *  process, so this happens over its admin HTTP endpoint. */
export async function setDeskState(cfg: FakeDeskState): Promise<void> {
  const res = await fetch(`${FAKE_DAEMON_URL}/__admin__/state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cfg),
  });
  if (!res.ok) throw new Error(`failed to set fake daemon state: HTTP ${res.status}`);
}
