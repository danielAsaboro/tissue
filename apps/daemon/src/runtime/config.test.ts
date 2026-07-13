import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LiveConfig } from "./config.js";
import { loadCredentials } from "./config.js";

const dirs: string[] = [];

function config(credentialsPath: string): LiveConfig {
  return {
    mode: "live",
    network: "devnet",
    origin: "https://txline-dev.txodds.com",
    port: 8788,
    credentialsPath,
    allowedOrigins: [],
    rpcUrl: "https://api.devnet.solana.com",
    anchorMode: "view",
  };
}

function credentialFile(mode: number): string {
  const dir = mkdtempSync(join(tmpdir(), "tissue-config-"));
  dirs.push(dir);
  const path = join(dir, "credentials.json");
  writeFileSync(path, JSON.stringify({ network: "devnet", jwt: "jwt", apiToken: "txoracle_api_test" }), { mode });
  chmodSync(path, mode);
  return path;
}

afterEach(() => {
  delete process.env.TXLINE_JWT;
  delete process.env.TXLINE_API_TOKEN;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("live credential loading", () => {
  it("loads a private credential file", () => {
    expect(loadCredentials(config(credentialFile(0o600)))).toEqual({
      network: "devnet",
      jwt: "jwt",
      apiToken: "txoracle_api_test",
    });
  });

  it.runIf(process.platform !== "win32")("rejects a credential file readable by group or other", () => {
    expect(() => loadCredentials(config(credentialFile(0o644)))).toThrow(/require chmod 600/);
  });
});
