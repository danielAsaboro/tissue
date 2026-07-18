"use client";

// Real, independent, in-browser verification of one decision. Every computation here runs
// in the visitor's own browser: the hash recompute (WebCrypto), the Ed25519 signature check
// (@noble/curves), the Merkle proof walk, and — the decisive step — fetching the anchoring
// transaction directly from a public Solana RPC. Tissue's own server assembles the record
// and proof data (so this needs same-origin fetches for those), but it is NEVER the source
// of truth for whether the on-chain transaction actually contains what's claimed. A
// compromised or lying daemon cannot pass this check by returning `{ ok: true }` — every
// step here is independently recomputable and the final comparison happens against real
// chain bytes fetched outside Tissue's control.

import { useState } from "react";
import { recomputeDecisionHash, verifyDecisionSignature, verifyMerkleProof, canonicalize, sha256Hex } from "@/lib/verify/hash";

type StepState = "pending" | "running" | "ok" | "fail" | "skip";
interface Step {
  label: string;
  state: StepState;
  detail?: string;
}

const PUBLIC_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

interface CheckpointProofResponse {
  available: boolean;
  reason?: string;
  fixtureId?: string;
  seq?: number;
  leafHash?: string;
  root?: string;
  proof?: { hash: string; isRightSibling: boolean }[];
  checkpoint?: { seq: number; txSig?: string; submittedAt: number };
}

async function fetchOnChainMemo(txSig: string): Promise<string | null> {
  const res = await fetch(PUBLIC_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [txSig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }],
    }),
  });
  const body = await res.json() as { result?: { transaction: { message: { instructions: { program?: string; parsed?: unknown }[] } } } };
  if (!body.result) return null;
  const memoIx = body.result.transaction.message.instructions.find((ix) => ix.program === "spl-memo");
  return typeof memoIx?.parsed === "string" ? memoIx.parsed : null;
}

export function VerifyPanel({ fixtureId, seq }: { fixtureId: string; seq: number }) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const s: Step[] = [
      { label: "Fetch the public record export", state: "running" },
      { label: "Recompute the decision hash with WebCrypto in this browser", state: "pending" },
      { label: "Verify the Ed25519 signature (if present)", state: "pending" },
      { label: "Fetch the Merkle inclusion proof and verify it locally", state: "pending" },
      { label: "Fetch the anchoring transaction directly from a public Solana RPC", state: "pending" },
      { label: "Confirm the on-chain memo really commits to this root", state: "pending" },
    ];
    const push = () => setSteps([...s]);
    push();
    try {
      const recordRes = await fetch("/api/desk/record");
      const record = await recordRes.json() as {
        fixtures: { fixtureId: string; decisions: Record<string, unknown>[] }[];
      };
      const fixture = record.fixtures.find((f) => f.fixtureId === fixtureId);
      const decision = fixture?.decisions.find((d) => d.seq === seq);
      if (!decision) throw new Error(`decision seq ${seq} not found in the public record for ${fixtureId}`);
      s[0] = { ...s[0]!, state: "ok", detail: `fixture ${fixtureId}, seq ${seq} found` };
      s[1] = { ...s[1]!, state: "running" };
      push();

      const recomputed = await recomputeDecisionHash(decision);
      const hashMatches = recomputed === decision.hash;
      s[1] = {
        ...s[1]!,
        state: hashMatches ? "ok" : "fail",
        detail: `${recomputed.slice(0, 16)}… ${hashMatches ? "matches the recorded hash" : "DOES NOT match"}`,
      };
      push();

      if (decision.signature && decision.signerPubkey) {
        s[2] = { ...s[2]!, state: "running" };
        push();
        const sigOk = verifyDecisionSignature(String(decision.hash), String(decision.signature), String(decision.signerPubkey));
        s[2] = { ...s[2]!, state: sigOk ? "ok" : "fail", detail: sigOk ? `signed by ${String(decision.signerPubkey).slice(0, 12)}…` : "signature does not verify" };
      } else {
        s[2] = { ...s[2]!, state: "skip", detail: "no signature on this record (no keypair was configured when it was produced)" };
      }
      push();

      s[3] = { ...s[3]!, state: "running" };
      push();
      const proofRes = await fetch(`/api/desk/ledger-proof?fixtureId=${encodeURIComponent(fixtureId)}&seq=${seq}`);
      const proofBody = await proofRes.json() as CheckpointProofResponse;
      if (!proofBody.available || !proofBody.proof || !proofBody.root || !proofBody.checkpoint?.txSig) {
        s[3] = { ...s[3]!, state: "fail", detail: proofBody.reason ?? "no confirmed checkpoint covers this decision yet" };
        push();
        s[4] = { ...s[4]!, state: "skip", detail: "no anchoring transaction to check" };
        s[5] = { ...s[5]!, state: "skip" };
        push();
        return;
      }
      const merkleOk = await verifyMerkleProof(proofBody.leafHash ?? String(decision.hash), proofBody.proof, proofBody.root);
      s[3] = { ...s[3]!, state: merkleOk ? "ok" : "fail", detail: merkleOk ? `included under root ${proofBody.root.slice(0, 16)}…` : "proof does not reconstruct the claimed root" };
      push();

      s[4] = { ...s[4]!, state: "running" };
      push();
      const memo = await fetchOnChainMemo(proofBody.checkpoint.txSig);
      if (!memo) {
        s[4] = { ...s[4]!, state: "fail", detail: `transaction ${proofBody.checkpoint.txSig.slice(0, 12)}… not found on ${new URL(PUBLIC_RPC_URL).host}` };
        push();
        s[5] = { ...s[5]!, state: "skip" };
        push();
        return;
      }
      s[4] = { ...s[4]!, state: "ok", detail: `confirmed on-chain, memo: "${memo.slice(0, 40)}${memo.length > 40 ? "…" : ""}"` };
      push();

      s[5] = { ...s[5]!, state: "running" };
      push();
      const commitmentHash = await sha256Hex(canonicalize({ fixtureId, seq: proofBody.checkpoint.seq, merkleRoot: proofBody.root }));
      const memoMatches = memo.includes(commitmentHash);
      s[5] = {
        ...s[5]!,
        state: memoMatches ? "ok" : "fail",
        detail: memoMatches
          ? "on-chain memo commits to exactly this Merkle root — independently confirmed, not asserted"
          : "on-chain memo does not contain the recomputed commitment hash",
      };
      push();
    } catch (e) {
      const idx = s.findIndex((step) => step.state === "running" || step.state === "pending");
      if (idx >= 0) s[idx] = { ...s[idx]!, state: "fail", detail: e instanceof Error ? e.message : String(e) };
      push();
    } finally {
      setRunning(false);
    }
  };

  const icon = (st: StepState) => (st === "ok" ? "✓" : st === "fail" ? "✗" : st === "skip" ? "–" : st === "running" ? "…" : "·");
  const tone = (st: StepState) => (st === "ok" ? "badge-positive" : st === "fail" ? "badge-danger" : "");

  return (
    <div>
      <button onClick={() => void run()} disabled={running}>
        {steps ? "Verify again" : "Verify independently"}
      </button>
      {steps ? (
        <ul style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, listStyle: "none", padding: 0 }}>
          {steps.map((step) => (
            <li key={step.label} style={{ fontSize: 12 }}>
              <span className={`badge ${tone(step.state)}`} aria-hidden style={{ marginRight: 6 }}>
                {icon(step.state)}
              </span>
              <span className="muted">{step.label}</span>
              {step.detail ? <div style={{ paddingLeft: 20 }}>{step.detail}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
