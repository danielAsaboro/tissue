import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AnalystExport } from "@tissue/shared";
import { TissueSlipConsumer } from "@tissue/slip";
import { address } from "@solana/kit";
import { materializeExports } from "./materialize.js";
import { connectInMemory } from "./mcpBridge.js";
import { FallbackLlmClient, type ProviderConfig } from "./llm.js";
import { runAnalystQuery } from "./agent.js";

const MODEL_BASE_URL = process.env.TISSUE_LIVE_MODEL_BASE_URL;
const MODEL_ID = process.env.TISSUE_LIVE_MODEL_ID;

const PROGRAM = address("8VNZ5VseAcFaYhAZxetgE5N8eiD17ZZNchGhoatYUUXw");
const MINT = address("ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh");
const MARKET = "12jinNgukigVtRi71gnkugdQwtE5e7SqbbCsABcgZRom";
const MARKET_DATA = "277VNwDjxpoHAAAAAAAAALq2OhTFw+xxZ8+lukO18L54Nb8gl0J9u0Q+s7dkYGpoxidE3zwvd9odzoYhgrYokcj1iu/xgvGIBSKn2ZdKk3Cd2RUBAAAAAGQAAQAAAAABAgAAAAEBAQEDAAAACAAAAEF3YXkgd2luBAAAAERyYXcIAAAASG9tZSB3aW4DAAAAAAEAAAAAAAAAAAABAAAAAAAAAAABAQAAAAAAAAABAQEAAAAAAAAAAAKAhB4AAAAAAMDGLQAAAAAAQEtMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJQ1dwAAAABszTV3AAAAAAA3OHcAAAAAMgAUAAAAwFEmdwAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAP8=";

let rpcServer: Server;
let rpcOrigin: string;
let databasePath: string;
let tempDirectory: string;

beforeAll(async () => {
  rpcServer = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += String(chunk); });
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id: number; method: string; params: unknown[] };
      if (rpc.method !== "getAccountInfo") {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "method not found" } }));
        return;
      }
      const requested = String(rpc.params[0]);
      const value = requested === MARKET
        ? { data: [MARKET_DATA, "base64"], executable: false, lamports: 1_000_000, owner: PROGRAM }
        : null;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { value } }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    rpcServer.once("error", reject);
    rpcServer.listen(0, "127.0.0.1", resolve);
  });
  const bound = rpcServer.address();
  if (!bound || typeof bound === "string") throw new Error("live-test RPC did not bind TCP");
  rpcOrigin = `http://127.0.0.1:${bound.port}`;

  tempDirectory = mkdtempSync(join(tmpdir(), "tissue-live-agent-"));
  databasePath = join(tempDirectory, "analyst.db");
  materializeExports(databasePath, [minimalAnalystExport()]);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => rpcServer.close((error) => error ? reject(error) : resolve()));
  rmSync(tempDirectory, { recursive: true, force: true });
});

describe.runIf(Boolean(MODEL_BASE_URL && MODEL_ID))("live analyst skill and MCP loop", () => {
  it("uses a real model to inspect a canonical Slip market through the packed SDK", async () => {
    if (!MODEL_BASE_URL || !MODEL_ID) throw new Error("live model configuration disappeared during the test");
    const slip = new TissueSlipConsumer({
      network: "devnet",
      rpcUrl: rpcOrigin,
      programAddress: PROGRAM,
      settlementMint: MINT,
      commitment: "confirmed",
    });
    const bridge = await connectInMemory(databasePath, slip);
    const provider: ProviderConfig = {
      name: "ollama",
      baseUrl: MODEL_BASE_URL,
      apiKey: "ollama-local",
      model: MODEL_ID,
    };
    try {
      const answer = await runAnalystQuery(
        `Use inspect_slip_market to inspect market ${MARKET} with a stake of 2.5. Report the leading pool-derived outcome, its probability in basis points, and projected payout. Do not give trading advice.`,
        new FallbackLlmClient(provider, null, 180_000),
        bridge,
      );
      expect(answer.toolCalls.map((call) => call.name)).toContain("inspect_slip_market");
      expect(answer.providers.every((entry) => entry.provider === "ollama")).toBe(true);
      expect(answer.answer).toMatch(/Home win/i);
      expect(answer.answer).toMatch(/5000|50%/i);
      expect(answer.answer).toMatch(/4\.965/);
      expect(answer.answer).not.toMatch(/recommend|should buy|place a trade/i);
    } finally {
      await bridge.close();
    }
  }, 240_000);
});

function minimalAnalystExport(): AnalystExport {
  return {
    fixtureId: "18209181",
    generatedAtMsgId: "fixture",
    decisions: [],
    radarEvents: [],
    grade: {
      generatedAtMsgId: "fixture",
      clv: { n: 0, meanClvBps: 0, medianClvBps: 0, p25Bps: 0, p75Bps: 0, pctPositive: 0 },
      brier: { brier: 0, reliability: 0, resolution: 0, uncertainty: 0, bins: [] },
      latency: [],
      perClass: [],
      pnl: { realizedUnits: 0, matchedIntents: 0, settlementTxSigs: [], simulated: false },
    },
    finalScore: { home: 0, away: 0 },
  };
}
