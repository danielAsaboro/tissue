import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { address } from "@solana/kit";
import {
  BinaryOp,
  CREATE_MARKET_DISCRIMINATOR,
  MarketState,
  SettlementMode,
  SideSelector,
  getMarketEncoder,
} from "@slip/sdk/generated";
import { createSlipClient } from "@slip/sdk";
import { loadTissueSlipConfig } from "./config.js";
import { TissueSlipConsumer } from "./consumer.js";

const PROGRAM = address("8VNZ5VseAcFaYhAZxetgE5N8eiD17ZZNchGhoatYUUXw");
const MINT = address("ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh");
const CREATOR = address("DZqzfMTmFyDvhLWamA4qjiEUUzS8LoTZ6d2KMkXwsiXh");
const BUYER = address("DK2H6r7djsYd4KJQywCgnPjn94552QNJUVFmtJWyzLpJ");

let server: Server;
let origin: string;
let marketAddress: string;
let marketData: string;
let websocketServer: WebSocketServer;
let websocketOrigin: string;
const websocketMethods: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += String(chunk); });
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id: number; method: string; params: unknown[] };
      const account = {
        data: [marketData, "base64"],
        executable: false,
        lamports: 1_000_000,
        owner: PROGRAM,
      };
      let result: unknown;
      if (rpc.method === "getProgramAccounts") {
        result = [{ pubkey: marketAddress, account }];
      } else if (rpc.method === "getAccountInfo") {
        const requested = String(rpc.params[0]);
        result = {
          value: requested === PROGRAM
            ? { data: [Buffer.from(CREATE_MARKET_DISCRIMINATOR).toString("base64"), "base64"], executable: true, lamports: 1, owner: "BPFLoaderUpgradeab1e11111111111111111111111" }
            : requested === marketAddress ? account : null,
        };
      } else {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "method not found" } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const bound = server.address();
  if (!bound || typeof bound === "string") throw new Error("fixture RPC did not bind");
  origin = `http://127.0.0.1:${bound.port}`;
  const sdk = createSlipClient({ network: "devnet", rpcUrl: origin, programAddress: PROGRAM, settlementMint: MINT });
  marketAddress = await sdk.marketAddress(CREATOR, 7n);
  marketData = Buffer.from(getMarketEncoder().encode({
    id: 7n,
    creator: CREATOR,
    mint: MINT,
    expression: {
      fixtureId: 18_209_181n,
      settlementMode: SettlementMode.Terminal,
      period: 100,
      statAKey: 1,
      statASide: SideSelector.Home,
      statBKey: 2,
      statBSide: SideSelector.Away,
      op: BinaryOp.Sub,
    },
    outcomeLabels: ["Away win", "Draw", "Home win"],
    bands: [
      { lowerInclusive: null, upperExclusive: 0n, outcomeIndex: 0 },
      { lowerInclusive: 0n, upperExclusive: 1n, outcomeIndex: 1 },
      { lowerInclusive: 1n, upperExclusive: null, outcomeIndex: 2 },
    ],
    pools: [2_000_000n, 3_000_000n, 5_000_000n, 0n, 0n],
    entryDeadline: 2_000_000_000n,
    resolveAt: 2_000_014_700n,
    voidAt: 2_000_172_800n,
    feeBps: 50,
    tipBps: 20,
    state: MarketState.Open,
    winningOutcome: null,
    resolutionCandidate: null,
    createdAt: 1_999_000_000n,
    resolvedTs: 0n,
    ticketCount: 2,
    claimedWinningStake: 0n,
    bump: 255,
  })).toString("base64");

  websocketServer = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve, reject) => {
    websocketServer.once("listening", resolve);
    websocketServer.once("error", reject);
  });
  const websocketAddress = websocketServer.address();
  if (!websocketAddress || typeof websocketAddress === "string") throw new Error("fixture WebSocket did not bind TCP");
  websocketOrigin = `ws://127.0.0.1:${websocketAddress.port}`;
  websocketServer.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const rpc = JSON.parse(String(raw)) as { id: number; method: string };
      websocketMethods.push(rpc.method);
      if (rpc.method === "accountSubscribe") {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: 41 }));
        socket.send(JSON.stringify({ jsonrpc: "2.0", method: "accountNotification", params: { subscription: 41, result: { context: { slot: 1 }, value: {} } } }));
      } else if (rpc.method === "accountUnsubscribe") {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: true }));
      }
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const client of websocketServer.clients) client.terminate();
  await new Promise<void>((resolve, reject) => websocketServer.close((error) => error ? reject(error) : resolve()));
});

describe("Tissue packed Slip consumer", () => {
  it("requires an explicit complete cluster contract", () => {
    expect(loadTissueSlipConfig({})).toBeNull();
    expect(() => loadTissueSlipConfig({ TISSUE_SLIP_RPC_URL: origin })).toThrow(/requires/);
    expect(loadTissueSlipConfig({
      TISSUE_NETWORK: "devnet",
      TISSUE_SLIP_RPC_URL: origin,
      TISSUE_SLIP_PROGRAM_ID: PROGRAM,
      TISSUE_SLIP_SETTLEMENT_MINT: MINT,
    })?.network).toBe("devnet");
  });

  it("uses the real SDK RPC decoder, PDA checks, bigint math, and transaction builder", async () => {
    const consumer = new TissueSlipConsumer({
      network: "devnet",
      rpcUrl: origin,
      programAddress: PROGRAM,
      settlementMint: MINT,
      commitment: "confirmed",
    });
    await expect(consumer.supportsUnifiedMarkets()).resolves.toBe(true);
    const markets = await consumer.listMarkets({ fixtureId: "18209181", stake: "2.5" });
    expect(markets).toHaveLength(1);
    expect(markets[0]).toMatchObject({
      address: marketAddress,
      totalPool: "10",
      protocolFee: "0.05",
      resolverTip: "0.02",
    });
    expect(markets[0]!.outcomes.map((outcome) => outcome.probabilityBps)).toEqual([2000, 3000, 5000]);
    expect(markets[0]!.outcomes[2]!.projectedPayout).toBe("4.965");

    const buy = await consumer.prepareBuy({
      market: marketAddress,
      buyer: BUYER,
      outcomeIndex: 2,
      amount: "2.5",
      nonce: 9n,
    });
    expect(buy.kind).toBe("buy");
    expect(buy.instructions).toHaveLength(2);
    expect(buy.ticket).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("refreshes from a real WebSocket notification and tears the subscription down", async () => {
    const consumer = new TissueSlipConsumer({
      network: "devnet",
      rpcUrl: origin,
      websocketUrl: websocketOrigin,
      programAddress: PROGRAM,
      settlementMint: MINT,
      commitment: "confirmed",
    });
    const update = new Promise<string>((resolve, reject) => {
      const close = consumer.watchMarket(marketAddress, (market) => {
        close();
        resolve(market.address);
      }, reject);
    });
    await expect(update).resolves.toBe(marketAddress);
    await vi.waitFor(() => expect(websocketMethods).toContain("accountUnsubscribe"));
    expect(websocketMethods).toContain("accountSubscribe");
  });
});
