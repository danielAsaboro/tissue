{
  "project": "TISSUE",
  "stack": {
    "runtime": "Node.js 24 / TypeScript / pnpm workspace",
    "frontend": "Next.js 16",
    "solana": "@coral-xyz/anchor 0.32.1 / @solana/web3.js 1.98.4",
    "services": ["daemon", "dashboard", "read-only analyst"]
  },
  "review": {
    "date": "2026-07-19",
    "security_score": "A-",
    "quality_score": "B+",
    "bounty_code_score": "93/100",
    "bounty_screening": "FAIL until demo video, public repository, and judge-accessible deployment/API exist",
    "findings": [
      {
        "severity": "critical",
        "category": "eligibility",
        "description": "The absolute demo-video, public-repository, and judge-access requirements are not satisfied by checked evidence.",
        "fix": "An authorized owner must publish the repository, deploy the application or API, record an at-most-five-minute demo, and replace every pending submission field with tested URLs."
      },
      {
        "severity": "medium",
        "category": "strategy evidence",
        "description": "The verified 100-fixture archive produces +225bps weighted CLV on both deterministic calibration and holdout. Holdout Brier beats its opening-market baseline, but calibration Brier trails its baseline; historical evaluation correctly does not fabricate fills or PnL.",
        "fix": "Tune only on the frozen 61-fixture calibration set, preserve the 39-fixture holdout untouched until policy freeze, and require non-regression across both calibration and holdout before strengthening the edge claim."
      },
      {
        "severity": "high",
        "category": "public execution evidence",
        "description": "Slip lifecycle behavior is proven with the real program under local Surfpool, but buyTicket has no atomic minimum-payout guard and Tissue therefore refuses mainnet-beta.",
        "fix": "Add an atomic venue-level minimum-payout/slippage constraint, then provision a two-sided public market and rerun buy, proof resolution, claim, restart reconciliation, and explorer-link capture."
      }
    ],
    "ready_for_mainnet": false
  },
  "verification": {
    "unit_integration": "360 passing, 10 explicitly gated/skipped in the latest full run",
    "browser_e2e": "20 passing in Chromium",
    "slip_lifecycle": "real pinned Slip program on Surfpool: two-sided pool, exact atomic buy, proof resolution, claim, idempotent retry passing",
    "dependency_audit": "passes at moderate threshold with GHSA-3gc7-fjrx-p6mg explicitly ignored only after forcing bigint-buffer to its safe JavaScript implementation",
    "replay": "synthetic replay hash chain/determinism pass; verified historical evaluation covers 100 completed fixtures, 109382 messages, 7192 quotes, and +225bps weighted CLV on both calibration and holdout",
    "historical_evaluation": "SHA-256-verified authenticated TxLINE archive replayed through local HTTP/SSE and production fetch/normalization boundaries; holdout Brier 0.197298 vs opening baseline 0.220753, calibration Brier 0.174960 vs baseline 0.161049",
    "containers": "daemon, analyst, and dashboard images build cleanly; non-root/runtime/header/fail-closed container verification passes"
  }
}
