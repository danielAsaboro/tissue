import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createServer, type Server } from "node:http";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createMint, getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { address } from "@solana/kit";
import { Surfnet } from "@solana/surfpool";
import { TissueSlipConsumer, type TissueSlipConfig } from "@tissue/slip";
import { millis, type MarketKey, type ScoreMessage } from "@tissue/shared";
import { loadPolicy } from "../config/policy.js";
import type { QuoteProposal } from "../strategy/strategy.js";
import { deriveSlipMarketId, mapMarketKeyToSlipRulebook, signAndSend } from "./slipExec.js";
import { SlipVenueAdapter } from "./slipVenue.js";
import { executeThroughVenue } from "./venue.js";

/**
 * Real, transaction-level proof that Tissue's pricing edge lands on Slip as a signed,
 * confirmed transaction — not a claim, not a mock Connection. Deploys the vendored real Slip
 * program (vendor/slip-program-7gNEn.so — see vendor/slip-program-7gNEn.provenance.json) onto
 * a local Surfpool instance, runs Tissue's real Slip venue adapter, and independently verifies
 * the on-chain result: vault balance, ticket account, resolved payout.
 *
 * Same opt-in discipline as exec/surfpoolAnchoring.test.ts: guarded, not run in default CI,
 * because it starts an external local validator process.
 */

const SLIP_PROGRAM_ID = new PublicKey("7gNEnFMDVhxFLSrtSctaPPCX7RcPbz1Lu5vtxvzobXFt");
const TXLINE_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const FIXTURE_ID = "18209181"; // FRA 2-0 MAR — a real captured Tissue corpus fixture
const DAY_MS = 86_400_000;

const RUN_SURFPOOL_TESTS = process.env.TISSUE_RUN_SLIP_SURFPOOL_TESTS === "1";

function tempKeypairPath(secretKey: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "slip-exec-surfpool-test-"));
  const path = join(dir, "keypair.json");
  writeFileSync(path, JSON.stringify(Array.from(secretKey)));
  return path;
}

const sha = (...parts: Buffer[]) => {
  const hash = createHash("sha256");
  parts.forEach((part) => hash.update(part));
  return hash.digest();
};
const i32 = (value: number) => { const b = Buffer.alloc(4); b.writeInt32LE(value); return b; };
const u32 = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const i64 = (value: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(value); return b; };
const statLeaf = (stat: { key: number; value: number; period: number }) => sha(u32(stat.key), i32(stat.value), i32(stat.period));

/** Mirrors slip/program/tests/slip.surfpool.test.ts's proof() helper — same TxLINE score-root encoding. */
function realScoreProof(timestampMs: number, homeGoals: number, awayGoals: number) {
  const a = { key: 1, value: homeGoals, period: 100 };
  const b = { key: 2, value: awayGoals, period: 100 };
  const al = statLeaf(a);
  const bl = statLeaf(b);
  const root = sha(al, bl);
  const summary = {
    fixtureId: BigInt(FIXTURE_ID),
    updateCount: 1,
    minTimestamp: BigInt(timestampMs),
    maxTimestamp: BigInt(timestampMs),
    eventsSubTreeRoot: Uint8Array.from(root),
  };
  const fixture = sha(Buffer.of(1), i64(BigInt(FIXTURE_ID)), i32(1), i64(BigInt(timestampMs)), i64(BigInt(timestampMs)), root);
  const epoch = Math.floor(timestampMs / DAY_MS);
  const within = timestampMs - epoch * DAY_MS;
  const slot = Math.floor(within / 3_600_000) * 12 + Math.floor((within % 3_600_000) / 300_000);
  const data = Buffer.alloc(10 + 288 * 32);
  data.writeUInt16LE(epoch, 8);
  fixture.copy(data, 10 + slot * 32);
  const eb = Buffer.alloc(2);
  eb.writeUInt16LE(epoch);
  const rootsPda = PublicKey.findProgramAddressSync([Buffer.from("daily_scores_roots"), eb], TXLINE_PROGRAM_ID)[0];
  return {
    arg: {
      eventStatRoot: Uint8Array.from(root),
      statA: { stat: a, statProof: [{ hash: Uint8Array.from(bl), isRightSibling: true }] },
      statB: { stat: b, statProof: [{ hash: Uint8Array.from(al), isRightSibling: false }] },
      summary,
      subTreeProof: [],
      mainTreeProof: [],
    },
    rootsPda,
    data,
    responses: new Map([
      [1, {
        statToProve: a,
        eventStatRoot: Array.from(root),
        statProof: [{ hash: Array.from(bl), isRightSibling: true }],
        subTreeProof: [],
        mainTreeProof: [],
        summary: {
          fixtureId: FIXTURE_ID,
          updateStats: { updateCount: 1, minTimestamp: timestampMs, maxTimestamp: timestampMs },
          eventStatsSubTreeRoot: Array.from(root),
        },
      }],
      [2, {
        statToProve: b,
        eventStatRoot: Array.from(root),
        statProof: [{ hash: Array.from(al), isRightSibling: false }],
        subTreeProof: [],
        mainTreeProof: [],
        summary: {
          fixtureId: FIXTURE_ID,
          updateStats: { updateCount: 1, minTimestamp: timestampMs, maxTimestamp: timestampMs },
          eventStatsSubTreeRoot: Array.from(root),
        },
      }],
    ]),
  };
}

describe.runIf(RUN_SURFPOOL_TESTS)("Tissue -> Slip real execution (Surfpool)", () => {
  let surfnet: Surfnet;
  let connection: Connection;
  let payer: Keypair;
  let counterparty: Keypair;
  let mint: PublicKey;
  let keypairPath: string;
  let slipConfig: TissueSlipConfig;
  let proofServer: Server;
  let proofOrigin: string;
  let proofResponses = new Map<number, unknown>();

  beforeAll(async () => {
    surfnet = Surfnet.startWithConfig({ offline: true, blockProductionMode: "transaction" });
    const soPath = resolve(fileURLToPath(new URL("../../../../vendor/slip-program-7gNEn.so", import.meta.url)));
    const idlPath = resolve(fileURLToPath(new URL("../../../../vendor/slip-program-7gNEn.idl.json", import.meta.url)));
    surfnet.deploy({ programId: SLIP_PROGRAM_ID.toBase58(), soPath, idlPath });

    payer = Keypair.generate();
    counterparty = Keypair.generate();
    surfnet.fundSol(payer.publicKey.toBase58(), 5_000_000_000);
    surfnet.fundSol(counterparty.publicKey.toBase58(), 5_000_000_000);
    connection = new Connection(surfnet.rpcUrl, { commitment: "confirmed", wsEndpoint: surfnet.wsUrl });
    keypairPath = tempKeypairPath(payer.secretKey);

    mint = await createMint(connection, payer, payer.publicKey, null, 6);
    const payerToken = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey)).address;
    const counterpartyToken = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, counterparty.publicKey)).address;
    await mintTo(connection, payer, mint, payerToken, payer, 1_000_000_000);
    await mintTo(connection, payer, mint, counterpartyToken, payer, 1_000_000_000);

    slipConfig = {
      network: "localnet",
      rpcUrl: surfnet.rpcUrl,
      websocketUrl: surfnet.wsUrl,
      programAddress: address(SLIP_PROGRAM_ID.toBase58()),
      settlementMint: address(mint.toBase58()),
      commitment: "confirmed",
    };
    proofServer = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const payload = proofResponses.get(Number(url.searchParams.get("statKey")));
      response.writeHead(payload ? 200 : 404, { "content-type": "application/json" });
      response.end(JSON.stringify(payload ?? { error: "proof not prepared" }));
    });
    await new Promise<void>((resolveListen, reject) => {
      proofServer.once("error", reject);
      proofServer.listen(0, "127.0.0.1", resolveListen);
    });
    const proofAddress = proofServer.address();
    if (!proofAddress || typeof proofAddress === "string") throw new Error("proof fixture server did not bind");
    proofOrigin = `http://127.0.0.1:${proofAddress.port}`;
  }, 60_000);

  afterAll(async () => {
    surfnet.stop();
    await new Promise<void>((resolveClose, reject) => {
      proofServer.close((error) => error ? reject(error) : resolveClose());
    });
  });

  it("lands a real signed buyTicket transaction for a Tissue decision, then resolves and pays out", async () => {
    const marketKey: MarketKey = { market: "TOTALS", lineTimes10: 25 };
    const proposal: QuoteProposal = {
      marketKey,
      selection: "OVER",
      side: "BACK",
      priceMilliOdds: 2000,
      sizeUnits: 2_000_000,
      edgeBps: 350,
      tissueProbBps: 7500,
      radarClass: undefined,
      reason: "surfpool end-to-end proof",
    };
    const basePolicy = loadPolicy();
    const policy = {
      ...basePolicy,
      exec: {
        ...basePolicy.exec,
        slip: { ...basePolicy.exec.slip, enabled: true },
      },
    };
    let reconciliationNow = Date.now();
    const adapter = new SlipVenueAdapter({
      rpcUrl: surfnet.rpcUrl,
      keypairPath,
      slipConfig,
      minVenueEdgeBps: 250,
      policy,
      lifecycleOptions: () => ({
        rpcUrl: surfnet.rpcUrl,
        keypairPath,
        slipConfig,
        now: () => reconciliationNow,
        scoreProof: {
          origin: proofOrigin,
          rpcUrl: surfnet.rpcUrl,
          network: "devnet",
          credentials: { network: "devnet", jwt: "fixture", apiToken: "fixture" },
        },
      }),
    });

    // Market provisioning and counterparty liquidity are independent of Tissue execution.
    // The daemon refuses to create-and-buy an empty one-sided pool because Slip voids it.
    const consumer = new TissueSlipConsumer(slipConfig);
    const mapping = mapMarketKeyToSlipRulebook(FIXTURE_ID, marketKey);
    const now = Math.floor(Date.now() / 1_000);
    const created = await consumer.prepareCreateMarket({
      id: deriveSlipMarketId(FIXTURE_ID, marketKey),
      creator: payer.publicKey.toBase58(),
      rulebook: {
        version: 1,
        fixtureId: FIXTURE_ID,
        question: `Totals for fixture ${FIXTURE_ID}`,
        sentence: `Full-time total goals for fixture ${FIXTURE_ID}.`,
        expression: mapping.expression,
        outcomeLabels: [...mapping.outcomeLabels],
        bands: mapping.bands.map((band) => ({ ...band })),
        entryDeadline: now + 5,
        resolveAt: now + 15,
        voidAt: now + 60,
        feeBps: 0,
        tipBps: 0,
      },
    });
    const createResult = await signAndSend(connection, created.instructions, payer);
    expect(createResult.status, createResult.error).toBe("confirmed");
    const opposing = await consumer.prepareBuy({
      market: created.market!,
      buyer: counterparty.publicKey.toBase58(),
      outcomeIndex: 0,
      amountAtomic: 1_000_000n,
      nonce: 99n,
    });
    const opposingResult = await signAndSend(connection, opposing.instructions, counterparty);
    expect(opposingResult.status, opposingResult.error).toBe("confirmed");

    const authorization = adapter.authorize([proposal], { stakedByMarketUnits: {}, totalStakedUnits: 0 });
    expect(authorization.rejected).toEqual([]);
    expect(authorization.approved).toHaveLength(1);

    const badVenuePrice = await executeThroughVenue(adapter, {
      fixtureId: FIXTURE_ID,
      decisionSeq: 0,
      nonce: 98n,
      candidate: { ...proposal, tissueProbBps: 5000 },
    });
    expect(badVenuePrice.status).toBe("failed");
    expect(badVenuePrice.error).toContain("post-stake venue edge");
    expect(badVenuePrice.venueMarketId).toBe(created.market);
    expect(badVenuePrice.venueBreakevenProbBps).toBe(6667);
    expect(badVenuePrice.venueEdgeBps).toBe(-1667);

    const request = {
      fixtureId: FIXTURE_ID,
      decisionSeq: 0,
      nonce: 1n,
      candidate: proposal,
    };
    const discovery = await adapter.discover(request);
    expect(discovery.venue).toBe("slip");
    expect(discovery.identity).toBe(created.market);
    expect(discovery.liquidity.map((outcome) => outcome.amountAtomic)).toEqual(["1000000", "0"]);
    const comparison = adapter.compare(request, discovery);
    expect(comparison.clearsVenueEconomics).toBe(true);
    expect(comparison.breakevenProbabilityBps).toBe(6667);

    const evidence = await executeThroughVenue(adapter, request);
    expect(evidence.venue).toBe("slip");
    expect(evidence.venueMarketId).toBe(created.market);
    expect(evidence.submissionTxSig).toBeDefined();

    const slipEvidence = evidence as typeof evidence & {
      market?: string;
      ticket?: string;
      buyTxSig?: string;
      resolveTxSig?: string;
    };
    expect(slipEvidence.status).toBe("confirmed");
    expect(slipEvidence.market).toBeDefined();
    expect(slipEvidence.ticket).toBeDefined();
    expect(slipEvidence.buyTxSig).toBeDefined();
    expect(evidence.venueBreakevenProbBps).toBe(6667);
    expect(evidence.venueEdgeBps).toBe(833);
    expect(evidence.projectedPayoutAtomic).toBe("3000000");

    // Independent verification: the market vault really holds the staked amount on-chain.
    const vault = getAssociatedTokenAddressSync(mint, new PublicKey(slipEvidence.market!), true);
    const vaultAccount = await getAccount(connection, vault);
    expect(vaultAccount.amount).toBe(3_000_000n); // 1 opposing + exact 2-token Tissue stake

    // Resolve from a real (constructed) TxLINE score proof: 3-1 -> total 4 goals -> Over 2.5 wins.
    // Surfpool's cheatcode accepts a Unix timestamp in milliseconds and updates Solana's Clock.
    const terminalTimestamp = Date.now() + 30_000;
    reconciliationNow = terminalTimestamp;
    surfnet.timeTravelToTimestamp(terminalTimestamp);
    const terminal: ScoreMessage = {
      kind: "score",
      msgId: "surfpool-final",
      fixtureId: FIXTURE_ID,
      sourceSeq: 1,
      ts: millis(terminalTimestamp),
      network: "devnet",
      minute: 90,
      homeScore: 3,
      awayScore: 1,
      homeReds: 0,
      awayReds: 0,
      possession: { home: "none", away: "none" },
      phase: "100",
      isFinal: true,
      isVoid: false,
    };
    // Rebuild the proof at the exact feed timestamp used by the terminal message.
    const terminalProof = realScoreProof(terminal.ts, terminal.homeScore, terminal.awayScore);
    proofResponses = terminalProof.responses;
    surfnet.setAccount(terminalProof.rootsPda.toBase58(), 10_000_000, terminalProof.data, TXLINE_PROGRAM_ID.toBase58());

    // The production reconciler performs resolve + claim and is safe to rerun after restart.
    const payerToken = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey)).address;
    const before = (await getAccount(connection, payerToken)).amount;
    const completed = await adapter.reconcile(evidence, terminal);
    expect(completed.lifecycleStatus, completed.lifecycleError).toBe("claimed");
    expect(completed.resolveTxSig).toBeDefined();
    expect(completed.settlementTxSig).toBe(completed.resolveTxSig);
    expect(completed.claimTxSig).toBeDefined();

    const after = (await getAccount(connection, payerToken)).amount;
    expect(after).toBeGreaterThan(before); // real payout landed, not just a claimed status flag

    const replayed = await adapter.reconcile(completed, terminal);
    expect(replayed.lifecycleStatus).toBe("claimed");
  }, 60_000);
});
