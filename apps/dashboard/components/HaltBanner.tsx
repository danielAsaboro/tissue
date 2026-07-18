import type { HaltState } from "@/lib/data/types";

/**
 * FanField/Onside drama with desk discipline: unexplained movement is the edge.
 * Copy is production-facing for judges and operators — no soft placeholders.
 */
export function HaltBanner({ halt }: { halt: HaltState }) {
  if (halt.kind === "quoting") {
    return (
      <div className="halt-banner clear" role="status">
        <strong>Live quoting.</strong> Risk gates clear. No halt active.
      </div>
    );
  }
  if (halt.kind === "watching") {
    return (
      <div className="halt-banner clear" role="status">
        <strong>Watching.</strong> Live feed online. No quote currently clears policy.
      </div>
    );
  }
  if (halt.kind === "verifying") {
    return (
      <div className="halt-banner waiting" role="status">
        <strong>Verifying TxLINE proofs.</strong> New quotes stay pending until{" "}
        <code>validate_odds</code> / score stats clear.
      </div>
    );
  }
  if (halt.kind === "waiting") {
    return (
      <div className="halt-banner waiting" role="status">
        <strong>Waiting for TxLINE.</strong> No synthetic feed. Quotes remain disabled until real
        data arrives.
      </div>
    );
  }

  const reason = halt.reason ?? "";
  const edgeCopy = haltEdgeCopy(reason);

  return (
    <div className="halt-banner" role="alert">
      <div>
        <strong>{halt.kind === "error" ? "Unavailable" : "Halted"}</strong>
        {reason ? ` — ${reason}` : ""}
        {halt.sinceMsgId ? (
          <span className="muted"> · since msg {halt.sinceMsgId}</span>
        ) : null}
      </div>
      {edgeCopy ? <p className="halt-edge">{edgeCopy}</p> : null}
    </div>
  );
}

/**
 * Halt-reason-specific explanation. Each of these is a real, distinct risk gate
 * (risk/gates.ts) — one generic "unexplained movement" paragraph used to cover all of them,
 * which was accurate for the first gate this desk shipped but not for feed-gap,
 * drawdown-kill, model-divergence, or the newer informed-flow signal.
 */
function haltEdgeCopy(reason: string): string | null {
  if (/informed-flow/i.test(reason)) {
    return "Edge: this move's velocity is anomalous versus the market's own trailing distribution — a self-calibrating adverse-selection signal (Glosten-Milgrom), not a fixed magnitude threshold. The desk pulls quotes rather than trade against it.";
  }
  if (/unexplained/i.test(reason) || /no cause/i.test(reason)) {
    return "Edge: odds moved without a feed cause we can see. The desk refuses to quote against information it does not have — same discipline a real book pays for. Resume only when the radar reclassifies the move or the feed catches up.";
  }
  if (/feed-gap|feed gap/i.test(reason)) {
    return "Safety: the feed went quiet longer than the configured gap tolerance. Every open intent is cancelled — the desk will not quote blind.";
  }
  if (/drawdown/i.test(reason)) {
    return "Safety: realized drawdown crossed the kill threshold. This latch is operator-restart-only — it never auto-resumes.";
  }
  if (/model-divergence/i.test(reason)) {
    return "Safety: tissue's price disagrees with the market by more than the sanity band allows — protecting against the desk's own model failure, not the market's.";
  }
  if (/match-void|void/i.test(reason)) {
    return "The match was abandoned or cancelled. All positions are voided — nothing settles on a phantom score.";
  }
  return null;
}
