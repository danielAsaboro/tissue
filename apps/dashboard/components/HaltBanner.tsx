import type { HaltState } from "@/lib/data/types";

export function HaltBanner({ halt }: { halt: HaltState }) {
  if (!halt.active) {
    return <div className="halt-banner clear">Quoting. No halt active.</div>;
  }
  return (
    <div className="halt-banner" role="alert">
      Halted{halt.reason ? `, ${halt.reason}` : ""}
      {halt.sinceMsgId ? ` (since ${halt.sinceMsgId})` : ""}
    </div>
  );
}
