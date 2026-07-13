import Link from "next/link";

const SIGNAL_CLASSES = [
  "late-reaction",
  "fast-reaction",
  "overreaction",
  "stale-line",
  "draw-compression",
  "favorite-panic",
];

export default function LandingPage() {
  return (
    <main>
      {/* Hero */}
      <section className="lp-hero">
        <span className="lp-chip">
          <span className="tag">THESIS</span> TxLINE prices the world. Tissue prices the game.
        </span>
        <h1 className="lp-display">An independent price for every live match market.</h1>
        <p className="lp-lede">
          Odds move the instant something happens on the pitch. Tissue reads the match itself,
          the score, the clock, the cards, the pressure, and forms its own price. When the market
          disagrees, it quotes. When a move has no cause it can see, it halts.
        </p>
        <div className="lp-cta-row">
          <Link href="/overview" className="lp-btn lp-btn-primary">
            Open the desk
          </Link>
          <Link href="/grade" className="lp-btn lp-btn-ghost">
            See the grade sheet
          </Link>
        </div>
        <div className="lp-ticker">
          <span>
            <b>98</b> tests green
          </span>
          <span>
            <b>replay(corpus) === ledger</b> in CI
          </span>
          <span>
            <b>0</b> wall-clock reads in a decision
          </span>
          <span>
            devnet activation <b>confirmed</b>
          </span>
        </div>
      </section>

      {/* 1. The problem */}
      <section className="lp-section">
        <p className="lp-kicker">The problem</p>
        <h2 className="lp-h2">Odds move the moment the ball does.</h2>
        <p className="lp-p">
          A goal, a red card, a shot on target. The screen reprices in seconds. Almost nobody has
          an independent read on whether that move is right, too far, too slow, or driven by
          something they cannot see. You end up reacting to the market instead of to the match.
        </p>
      </section>

      {/* 2. What Tissue does */}
      <div className="lp-band">
        <section className="lp-section lp-two-col">
          <div>
            <p className="lp-kicker">The price</p>
            <h2 className="lp-h2">It builds its own price from the match.</h2>
            <p className="lp-p">
              Tissue reads the scores stream, not the odds screen. Score, minute, red cards, and
              attacking pressure feed a goals model. De-vigged consensus is solved into scoring
              rates, run through Poisson with a Dixon-Coles low-score correction, then adjusted
              live for the time remaining and the current scoreline. Out comes a fair price for
              each market.
            </p>
            <p className="lp-p">
              The price is independent of the odds. That is what lets it judge whether a market
              move is information or noise.
            </p>
          </div>
          <div className="lp-grid">
            <div className="lp-card">
              <div className="lp-dot">λ</div>
              <h3>Solved, not scraped</h3>
              <p>Consensus 1X2 and totals invert into home and away scoring rates.</p>
            </div>
            <div className="lp-card">
              <div className="lp-dot">t</div>
              <h3>Live-adjusted</h3>
              <p>Remaining-time decay, the scoreline in the matrix, red cards, bounded pressure.</p>
            </div>
            <div className="lp-card">
              <div className="lp-dot">#</div>
              <h3>Deterministic</h3>
              <p>Fixed-point basis points. Message-id ordering. No wall-clock in any decision.</p>
            </div>
            <div className="lp-card">
              <div className="lp-dot">§</div>
              <h3>Cited</h3>
              <p>Dixon-Coles 1997 for the goals model. Avellaneda-Stoikov 2008 for the quoting.</p>
            </div>
          </div>
        </section>
      </div>

      {/* 3. The Radar */}
      <section className="lp-section">
        <p className="lp-kicker">Latency Radar</p>
        <h2 className="lp-h2">Every market reaction, classified against that price.</h2>
        <p className="lp-p">
          For each match event the Radar measures the gap from the event to the first reaction to
          the point the line stabilizes, plus the size of the move. It sorts each reaction into a
          class from empirical percentile bands. Deterministic, no model of the future.
        </p>
        <div className="lp-classes">
          {SIGNAL_CLASSES.map((c) => (
            <span key={c} className="lp-class">
              {c}
            </span>
          ))}
          <span className="lp-class halt">unexplained-movement · halts</span>
        </div>
        <p className="lp-p" style={{ marginTop: "var(--spacing-24)" }}>
          Unexplained movement is the one that matters. Odds move, no event in the trailing window:
          someone knows something the feed has not shown. The desk pulls its quotes and halts that
          market. Refusing to trade against information it cannot see is the discipline, not a
          limitation.
        </p>
      </section>

      {/* 4. The proof mechanism */}
      <div className="lp-band">
        <section className="lp-section">
          <p className="lp-kicker">The backtest that can&apos;t lie</p>
          <h2 className="lp-h2">Every decision is hash-chained and replayable.</h2>
          <p className="lp-p">
            Each decision is a record that embeds the triggering feed message hash and links to the
            one before it. Sampled inputs are anchored on-chain through the sponsor&apos;s
            validate_odds call, which is permissionless and callable today. The pricing core reads
            no wall-clock and does no I/O, so the same corpus produces the same ledger, byte for
            byte.
          </p>
          <div className="lp-code">
            replay(corpus) === ledger <span className="ok">✓ asserted in CI</span>
          </div>
          <div className="lp-stats">
            <div className="lp-stat">
              <span className="n">98</span>
              <span className="k">tests green, including replay equality and the chaos drills</span>
            </div>
            <div className="lp-stat">
              <span className="n">7</span>
              <span className="k">halt conditions, every one automated, no human in the loop</span>
            </div>
            <div className="lp-stat">
              <span className="n">1</span>
              <span className="k">module authorized to green-light execution: the risk gate</span>
            </div>
            <div className="lp-stat">
              <span className="n">0</span>
              <span className="k">wall-clock reads inside a decision, so replay is exact</span>
            </div>
          </div>
        </section>
      </div>

      {/* 5. The honest execution story */}
      <section className="lp-section">
        <p className="lp-kicker">The execution, stated plainly</p>
        <h2 className="lp-h2">The book is simulated. The anchoring is real.</h2>
        <div className="lp-note">
          <p>
            We checked the sponsor&apos;s on-chain program at commit <strong>f37473a</strong>. It is a
            data oracle: subscription, root anchoring, and validation. It has no intent-book. The
            sponsor&apos;s own README says a non-custodial orderbook is <strong>in preparation</strong>.
            So Tissue does not pretend to match on a venue that is not live yet.
          </p>
          <p>
            Matching runs through an internal <strong>simulated maker book</strong>, labeled
            simulated everywhere it appears. Provenance anchoring uses the real validate_odds call
            on devnet, the same network as the money. The execution layer is a port: when the real
            orderbook ships, it swaps in behind the same boundary, not a rewrite.
          </p>
          <p>
            Fill-independence is the point. Closing-line value grades every quote against the close
            whether it matched or not. This is engineering judgment, stated as a fact.
          </p>
        </div>
      </section>

      {/* 6. The grade sheet */}
      <div className="lp-band">
        <section className="lp-section">
          <p className="lp-kicker">Graded in public</p>
          <h2 className="lp-h2">Right or wrong, it is not hidden.</h2>
          <p className="lp-p">
            The grade sheet publishes automatically. Every metric is computed from the same
            hash-chained ledger, so the scorecard cannot drift from what the desk actually did.
          </p>
          <div className="lp-metrics">
            <span className="lp-metric-pill">Closing-line value, matched or not</span>
            <span className="lp-metric-pill">Brier score with calibration decomposition</span>
            <span className="lp-metric-pill">Reaction-latency distributions</span>
            <span className="lp-metric-pill">Hit rate per signal class</span>
            <span className="lp-metric-pill">Realized PnL, simulated label intact</span>
          </div>
        </section>
      </div>

      {/* 7. Ask Tissue */}
      <section className="lp-section">
        <p className="lp-kicker">Ask Tissue</p>
        <h2 className="lp-h2">A read-only analyst over the ledger.</h2>
        <p className="lp-p">
          Ask a question in plain language. A small agent answers from the decision ledger through
          a real MCP server with exactly three read-only tools, and cites the ledger rows it read.
          It has no tool that can place a trade, and it runs nowhere near the decision path. It
          narrates. It never decides.
        </p>
      </section>

      {/* 8. Into the desk */}
      <div className="lp-band">
        <section className="lp-section lp-final">
          <p className="lp-kicker">The desk</p>
          <h2 className="lp-h2">Open the desk.</h2>
          <p className="lp-p" style={{ marginLeft: "auto", marginRight: "auto" }}>
            The live tissue-vs-market chart, the quote tape, the decision feed with hash-chain
            verify, the grade sheet, and the replay lab.
          </p>
          <div className="lp-routes">
            <Link href="/quotes" className="lp-route">
              Quotes
            </Link>
            <Link href="/decisions" className="lp-route">
              Decisions
            </Link>
            <Link href="/grade" className="lp-route">
              Grade
            </Link>
            <Link href="/replay" className="lp-route">
              Replay
            </Link>
            <Link href="/analyst" className="lp-route">
              Ask Tissue
            </Link>
          </div>
          <div className="lp-cta-row" style={{ marginTop: "var(--spacing-32)" }}>
            <Link href="/overview" className="lp-btn lp-btn-primary">
              Open the desk
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
