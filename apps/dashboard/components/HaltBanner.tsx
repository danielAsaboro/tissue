import type { HaltState } from "@/lib/data/types";

export function HaltBanner({ halt }: { halt: HaltState }) {
  if (halt.kind === "quoting") {
    return <div className="halt-banner clear">Publishing live quotes. No halt active.</div>;
  }
  if (halt.kind === "watching") {
    return <div className="halt-banner clear">Watching the live feed. No quote currently clears policy.</div>;
  }
  if (halt.kind === "verifying") {
    return (
      <div className="halt-banner waiting" role="status">
        Verifying TxLINE odds proofs. New quotes remain pending until verification completes.
      </div>
    );
  }
  if (halt.kind === "waiting") {
    return (
      <div className="halt-banner waiting" role="status">
        Waiting for real TxLINE data. Quotes remain disabled.
      </div>
    );
  }
  return (
    <div className="halt-banner" role="alert">
      {halt.kind === "error" ? "Unavailable" : "Halted"}{halt.reason ? `, ${halt.reason}` : ""}
      {halt.sinceMsgId ? ` (since ${halt.sinceMsgId})` : ""}
    </div>
  );
}
