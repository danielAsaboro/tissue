import type { RadarClass } from "@tissue/shared";

export function ClassBadge({ signalClass }: { signalClass: RadarClass }) {
  return <span className="badge">{signalClass}</span>;
}
