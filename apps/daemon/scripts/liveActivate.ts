import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import { fetchOddsSnapshot, fetchScoresSnapshot, orderByFeed } from "../src/ingest/snapshots.js";
import { writeCorpus } from "../src/ingest/corpus.js";
import type { AuthCredentials } from "../src/ingest/txlineAuth.js";

/**
 * LIVE devnet activation (V2). Runs the real auth chain against TxLINE with a funded wallet:
 *   guest JWT → on-chain subscribe(level 1, 4 weeks) → wallet-signed /token/activate → seed a
 *   REAL completed-fixture corpus. Follows resources/tx-on-chain/examples/devnet/common/users.ts.
 *
 * Usage: TISSUE_KEYPAIR_PATH=~/keys/tissue-dev.json tsx scripts/liveActivate.ts [fixtureId]
 * Devnet-only. Prints tx signatures; caches the API token to a gitignored .keys/ file.
 */

const DEVNET_ORIGIN = process.env.TXLINE_DEVNET_ORIGIN ?? "https://txline-dev.txodds.com";
const API_BASE = `${DEVNET_ORIGIN}/api`;
const RPC = process.env.SOLANA_RPC_DEVNET ?? "https://api.devnet.solana.com";
const DEVNET_PROGRAM = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
const TXL_MINT_DEVNET = "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG";
const IDL_PATH = fileURLToPath(new URL("../idls/txoracle.json", import.meta.url));
const KEYS_DIR = fileURLToPath(new URL("../.keys/", import.meta.url));

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadKeypair(): Keypair {
  const raw = (process.env.TISSUE_KEYPAIR_PATH ?? `${homedir()}/keys/tissue-dev.json`).replace(/^~/, homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(raw, "utf8"))));
}

async function guestJwt(): Promise<string> {
  const res = await fetch(`${DEVNET_ORIGIN}/auth/guest/start`, { method: "POST" });
  if (!res.ok) throw new Error(`guest JWT ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

async function main(): Promise<void> {
  const user = loadKeypair();
  console.log(`[live] wallet ${user.publicKey.toBase58()}`);
  const connection = new Connection(RPC, "confirmed");
  const bal = await connection.getBalance(user.publicKey);
  console.log(`[live] balance ${(bal / 1e9).toFixed(3)} SOL`);
  if (bal < 0.05e9) throw new Error("insufficient SOL for subscribe (need ~0.05)");

  const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
  const wallet = new anchor.Wallet(user);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);
  const programId = new PublicKey(DEVNET_PROGRAM);
  const tokenMint = new PublicKey(TXL_MINT_DEVNET);

  const jwt = await guestJwt();
  console.log(`[live] guest JWT acquired (${jwt.slice(0, 12)}…)`);

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], programId);
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], programId);
  const tokenTreasuryVault = getAssociatedTokenAddressSync(tokenMint, tokenTreasuryPda, true, TOKEN_2022_PROGRAM_ID);
  const userTokenAccountAddress = getAssociatedTokenAddressSync(tokenMint, user.publicKey, false, TOKEN_2022_PROGRAM_ID);

  // Create the user's Token-2022 ATA if absent (free tier: 0 TxL transferred, ATA just needs to exist).
  const accountInfo = await connection.getAccountInfo(userTokenAccountAddress);
  if (!accountInfo) {
    console.log(`[live] creating Token-2022 ATA…`);
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        user.publicKey, userTokenAccountAddress, user.publicKey, tokenMint,
        TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
    await sendAndConfirmTransaction(connection, tx, [user], { commitment: "confirmed" });
    await delay(3000);
  }
  const ata = await getAccount(connection, userTokenAccountAddress, "confirmed", TOKEN_2022_PROGRAM_ID);

  console.log(`[live] subscribe(level 1, 4 weeks)…`);
  const tx = await program.methods
    .subscribe(1, 4)
    .accounts({
      user: user.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint,
      userTokenAccount: ata.address,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  const bh = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = bh.blockhash;
  tx.feePayer = user.publicKey;
  tx.sign(user);
  const txSig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: txSig, ...bh }, "confirmed");
  console.log(`[live] subscribe tx confirmed: ${txSig}`);

  // Activate: sign `${txSig}:${leagues}:${jwt}` (leagues empty → two colons).
  const leagues: string[] = [];
  const preimage = `${txSig}:${leagues.join(",")}:${jwt}`;
  const sig = nacl.sign.detached(new TextEncoder().encode(preimage), user.secretKey);
  const res = await fetch(`${API_BASE}/token/activate`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ txSig, walletSignature: Buffer.from(sig).toString("base64"), leagues }),
  });
  if (!res.ok) throw new Error(`activate ${res.status}: ${await res.text()}`);
  // The activation endpoint returns the token as PLAIN TEXT (e.g. "txoracle_api_…"), not
  // JSON — parse defensively (real-service behavior; logged to feedback.md).
  const body = await res.text();
  let apiToken: string;
  try {
    const j = JSON.parse(body) as { token?: string } | string;
    apiToken = typeof j === "string" ? j : j.token ?? body;
  } catch {
    apiToken = body.trim();
  }
  console.log(`[live] ACTIVATED. X-Api-Token acquired (${apiToken.slice(0, 12)}…)`);

  mkdirSync(KEYS_DIR, { recursive: true });
  writeFileSync(`${KEYS_DIR}apitoken.json`, JSON.stringify({ network: "devnet", jwt, apiToken }), "utf8");
  console.log(`[live] cached creds to apps/daemon/.keys/apitoken.json (gitignored)`);

  // Seed a REAL corpus from a completed World Cup fixture.
  const fixtureId = process.argv[2] ?? "18209181"; // FRA 2-0 MAR (QF)
  const creds: AuthCredentials = { network: "devnet", jwt, apiToken };
  console.log(`[live] fetching real snapshot for fixture ${fixtureId}…`);
  const scores = await fetchScoresSnapshot(DEVNET_ORIGIN, creds, fixtureId).catch((e) => { console.error("scores:", e.message); return []; });
  // Bare odds snapshots return 0 rows post-match (market closed) — asOf into the LIVE window
  // is required. Sample odds at several instants across the in-play ts range → a real series.
  const inPlayTs = scores.filter((s) => s.kind === "score" && s.minute > 0).map((s) => s.ts).sort((a, b) => a - b);
  const odds: Awaited<ReturnType<typeof fetchOddsSnapshot>> = [];
  if (inPlayTs.length >= 2) {
    const lo = inPlayTs[0]!;
    const hi = inPlayTs[inPlayTs.length - 1]!;
    const N = 6;
    for (let i = 0; i < N; i++) {
      const asOf = Math.round(lo + ((hi - lo) * i) / (N - 1));
      const batch = await fetchOddsSnapshot(DEVNET_ORIGIN, creds, fixtureId, asOf).catch(() => []);
      odds.push(...batch);
    }
  }
  console.log(`[live] scores=${scores.length} odds=${odds.length}`);
  if (scores.length + odds.length > 0) {
    const merged = orderByFeed([...scores, ...odds]);
    const path = writeCorpus(fixtureId, merged);
    console.log(`[live] REAL corpus written: ${path} (${merged.length} msgs)`);
    const sampleOdds = odds.find((o) => o.kind === "odds");
    if (sampleOdds && sampleOdds.kind === "odds") {
      console.log(`[live] sample real odds ${JSON.stringify(sampleOdds.marketKey)}: consensus=${JSON.stringify(sampleOdds.consensus)} raw=${JSON.stringify(sampleOdds.rawOdds)}`);
    }
  }
  console.log(`[live] DONE.`);
}

main().catch((e) => {
  console.error(`[live] FAILED:`, e instanceof Error ? e.message : e);
  process.exit(1);
});
