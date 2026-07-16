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
  const unexplained =
    /unexplained/i.test(reason) || /unexplained-movement/i.test(reason) || /no cause/i.test(reason);

  return (
    <div className="halt-banner" role="alert">
      <div>
        <strong>{halt.kind === "error" ? "Unavailable" : "Halted"}</strong>
        {reason ? ` — ${reason}` : ""}
        {halt.sinceMsgId ? (
          <span className="muted"> · since msg {halt.sinceMsgId}</span>
        ) : null}
      </div>
      {unexplained || halt.kind === "halted" ? (
        <p className="halt-edge">
          Edge: odds moved without a feed cause we can see. The desk refuses to quote against
          information it does not have — same discipline a real book pays for. Resume only when
          the radar reclassifies the move or the feed catches up.
        </p>
      ) : null}
    </div>
  );
}
