import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createMint, getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { address, type Instruction } from "@solana/kit";
import { Surfnet } from "@solana/surfpool";
import { TissueSlipConsumer, type TissueSlipConfig } from "@tissue/slip";
import type { MarketKey } from "@tissue/shared";
import type { QuoteProposal } from "../strategy/strategy.js";
import { executeSlipBuy, signAndSend } from "./slipExec.js";

/**
 * Real, transaction-level proof that Tissue's pricing edge lands on Slip as a signed,
 * confirmed transaction — not a claim, not a mock Connection. Deploys the vendored real Slip
 * program (vendor/slip-program-8VNZ5.so — see vendor/slip-program-8VNZ5.provenance.json) onto
 * a local Surfpool instance, runs Tissue's real exec/slipExec.ts, and independently verifies
 * the on-chain result: vault balance, ticket account, resolved payout.
 *
 * Same opt-in discipline as exec/surfpoolAnchoring.test.ts: guarded, not run in default CI,
 * because it starts an external local validator process.
 */

const SLIP_PROGRAM_ID = new PublicKey("8VNZ5VseAcFaYhAZxetgE5N8eiD17ZZNchGhoatYUUXw");
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
  };
}

describe.runIf(RUN_SURFPOOL_TESTS)("Tissue -> Slip real execution (Surfpool)", () => {
  let surfnet: Surfnet;
  let connection: Connection;
  let payer: Keypair;
  let mint: PublicKey;
  let keypairPath: string;
  let slipConfig: TissueSlipConfig;

  beforeAll(async () => {
    surfnet = Surfnet.startWithConfig({ offline: true, blockProductionMode: "transaction" });
    const soPath = resolve(fileURLToPath(new URL("../../../../vendor/slip-program-8VNZ5.so", import.meta.url)));
    const idlPath = resolve(fileURLToPath(new URL("../../../../vendor/slip-program-8VNZ5.idl.json", import.meta.url)));
    surfnet.deploy({ programId: SLIP_PROGRAM_ID.toBase58(), soPath, idlPath });

    payer = Keypair.generate();
    surfnet.fundSol(payer.publicKey.toBase58(), 5_000_000_000);
    connection = new Connection(surfnet.rpcUrl, { commitment: "confirmed", wsEndpoint: surfnet.wsUrl });
    keypairPath = tempKeypairPath(payer.secretKey);

    mint = await createMint(connection, payer, payer.publicKey, null, 6);
    const payerToken = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey)).address;
    await mintTo(connection, payer, mint, payerToken, payer, 1_000_000_000);

    slipConfig = {
      network: "localnet",
      rpcUrl: surfnet.rpcUrl,
      websocketUrl: surfnet.wsUrl,
      programAddress: address(SLIP_PROGRAM_ID.toBase58()),
      settlementMint: address(mint.toBase58()),
      commitment: "confirmed",
    };
  }, 60_000);

  afterAll(() => {
    surfnet.stop();
  });

  it("lands a real signed buyTicket transaction for a Tissue decision, then resolves and pays out", async () => {
    const marketKey: MarketKey = { market: "TOTALS", lineTimes10: 25 };
    const proposal: QuoteProposal = {
      marketKey,
      selection: "OVER",
      side: "BACK",
      priceMilliOdds: 2000,
      sizeUnits: 2,
      edgeBps: 350,
      radarClass: undefined,
      reason: "surfpool end-to-end proof",
    };

    const evidence = await executeSlipBuy(proposal, FIXTURE_ID, 1n, {
      rpcUrl: surfnet.rpcUrl,
      keypairPath,
      slipConfig,
      entryWindowMs: 5_000,
      resolveWindowMs: 15_000,
      voidWindowMs: 60_000,
    });

    expect(evidence.status).toBe("confirmed");
    expect(evidence.market).toBeDefined();
    expect(evidence.ticket).toBeDefined();
    expect(evidence.buyTxSig).toBeDefined();

    // Independent verification: the market vault really holds the staked amount on-chain.
    const vault = getAssociatedTokenAddressSync(mint, new PublicKey(evidence.market!), true);
    const vaultAccount = await getAccount(connection, vault);
    expect(vaultAccount.amount).toBe(2_000_000n); // 2 units * 1e6

    // Resolve from a real (constructed) TxLINE score proof: 3-1 -> total 4 goals -> Over 2.5 wins.
    await new Promise((r) => setTimeout(r, 6_000));
    surfnet.timeTravelToTimestamp(Date.now() + 10_000);
    const proof = realScoreProof(Date.now(), 3, 1);
    surfnet.setAccount(proof.rootsPda.toBase58(), 10_000_000, proof.data, TXLINE_PROGRAM_ID.toBase58());

    const consumer = new TissueSlipConsumer(slipConfig);
    const resolvePrepared = await consumer.prepareResolve({
      market: address(evidence.market!),
      resolver: address(payer.publicKey.toBase58()),
      dailyScoresRoots: address(proof.rootsPda.toBase58()),
      proof: proof.arg,
    });
    const resolveResult = await signAndSend(connection, resolvePrepared.instructions, payer);
    expect(resolveResult.status).toBe("confirmed");

    // Claim the winning ticket and independently verify the real payout on-chain.
    const payerToken = (await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey)).address;
    const before = (await getAccount(connection, payerToken)).amount;
    const claimPrepared = await consumer.prepareClaim({
      market: evidence.market!,
      ticket: evidence.ticket!,
      caller: payer.publicKey.toBase58(),
    });
    const claimResult = await signAndSend(connection, claimPrepared.instructions, payer);
    expect(claimResult.status).toBe("confirmed");

    const after = (await getAccount(connection, payerToken)).amount;
    expect(after).toBeGreaterThan(before); // real payout landed, not just a claimed status flag
  }, 60_000);
});
