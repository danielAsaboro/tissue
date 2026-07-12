/** Marks a simulated fill verbatim. A simulated fill is never presented as real. */
export function SimBadge() {
  return (
    <span className="badge badge-sim" title="Filled by the internal simulated maker book — not a real counterparty">
      SIM
    </span>
  );
}
