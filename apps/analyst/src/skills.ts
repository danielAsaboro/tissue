export interface AnalystSkill {
  readonly id: string;
  readonly purpose: string;
  readonly instructions: readonly string[];
  readonly tools: readonly string[];
}

/** Explicit operating skills. They constrain tool use; they do not grant new authority. */
export const ANALYST_SKILLS: readonly AnalystSkill[] = [
  {
    id: "ledger-forensics",
    purpose: "Explain what Tissue already decided and prove it from the hash-chained ledger.",
    instructions: [
      "Start with the narrowest fixture or recent-decision query that can answer the question.",
      "Cite sequence and hash for every decision claim.",
      "Never convert narration into a recommendation or new decision.",
      "'Has this pattern happened before' is a structured recall query (same class, minute, edge tolerance), never a fabricated semantic-similarity claim.",
    ],
    tools: ["get_recent_decisions", "get_signal_class_stats", "query_ledger_by_fixture", "find_similar_decisions"],
  },
  {
    id: "slip-market-intelligence",
    purpose: "Read live Slip pool state as market evidence without letting it replace Tissue fair value.",
    instructions: [
      "Treat Slip implied probabilities as pool-derived participation weights, never bookmaker truth.",
      "Use exact bigint-derived amounts and basis points returned by the SDK; never recompute with floats.",
      "Keep Tissue pricing advisory and Slip settlement state distinct in the answer.",
    ],
    tools: ["list_slip_markets", "inspect_slip_market", "list_slip_wallet_tickets"],
  },
  {
    id: "slip-settlement-audit",
    purpose: "Establish whether a room or external reference really identifies the claimed on-chain market.",
    instructions: [
      "Verify the complete reference before relying on pools, result, or receipt state.",
      "Report the exact failed boundary: network, program, mint, PDA/owner, fixture, Rulebook, or creation signature.",
      "A resolved result is evidence only after SDK verification; social copies are never authoritative.",
    ],
    tools: ["verify_slip_market_reference", "inspect_slip_market"],
  },
];

export function renderAnalystSkills(): string {
  return ANALYST_SKILLS.map((skill) => [
    `Skill: ${skill.id}`,
    `Purpose: ${skill.purpose}`,
    ...skill.instructions.map((instruction) => `- ${instruction}`),
    `Allowed tools: ${skill.tools.join(", ")}`,
  ].join("\n")).join("\n\n");
}
