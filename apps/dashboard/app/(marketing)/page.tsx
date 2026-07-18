import Image from "next/image";
import Link from "next/link";
import { Target, Radar, OctagonX, ShieldCheck } from "lucide-react";

const SIGNAL_CLASSES = [
  "late-reaction",
  "fast-reaction",
  "overreaction",
  "stale-line",
  "draw-compression",
  "favorite-panic",
];

const BUILT_ON = ["TxLINE", "Solana", "Poisson", "Dixon–Coles", "Hash ledger"];

const FEATURES = [
  {
    icon: Target,
    title: "Own fair value",
    body: "Opening consensus becomes scoring rates. Verified score, clock, and cards evolve the price — not a copy of the last odds tick.",
  },
  {
    icon: Radar,
    title: "Latency Radar",
    body: "Every market reaction is classified against that price: late, fast, overreacting, stale, or unexplained.",
  },
  {
    icon: OctagonX,
    title: "Halt discipline",
    body: "Unexplained movement pulls quotes. The desk refuses to trade against information it cannot see.",
  },
] as const;

const STEPS = [
  { n: "01", label: "Ingest", body: "Dual TxLINE score + odds SSE with proof gates." },
  { n: "02", label: "Price", body: "Deterministic in-play model — fixed-point, message-id ordered." },
  { n: "03", label: "Radar", body: "Classify the market move against tissue fair value." },
  { n: "04", label: "Quote · grade", body: "Publish risk-approved quotes. Hash-chain everything. Grade from evidence." },
] as const;

export default function LandingPage() {
  return (
    <main>
      {/* T1 · Hero only — tissue-desk-hero.jpg (light desk, left free for type) */}
      <section className="lp-section" style={{ paddingTop: "var(--spacing-24)", paddingBottom: "var(--spacing-24)" }}>
        <div className="lp-hero-frame lp-hero-frame-light">
          <Image
            src="/images/tissue-desk-hero.jpg"
            alt="Desk monitor showing Fair Value vs Market price curves"
            fill
            priority
            sizes="(max-width: 767px) 100vw, 1400px"
            className="object-cover object-[70%_center] sm:object-center"
          />
          <div className="lp-hero-frame-scrim lp-hero-frame-scrim-light" aria-hidden />
          <div className="lp-hero-frame-copy lp-hero-frame-copy-dark">
            <span className="lp-chip" style={{ marginBottom: "var(--spacing-16)" }}>
              <span className="tag">THESIS</span> TxLINE prices the world. Tissue prices the game.
            </span>
            <h1 className="lp-display lp-display-left lp-display-ink">
              An independent price
              <br />
              for every live market.
            </h1>
            <p className="lp-lede lp-lede-left lp-lede-ink">
              Odds move the instant the ball does. Tissue builds its own fair value from verified
              match state, quotes when the market disagrees, and halts when a move has no cause it
              can see.
            </p>
            <div className="lp-cta-row lp-cta-left">
              <Link href="/overview" className="lp-btn lp-btn-primary">
                Open the desk
              </Link>
              <Link href="/grade" className="lp-btn lp-btn-ghost">
                See the grade sheet
              </Link>
              <Link href="#how-it-works" className="lp-btn lp-btn-ghost">
                How it works
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section" style={{ paddingTop: "var(--spacing-32)", paddingBottom: "var(--spacing-32)" }}>
        <div className="lp-built">
          <span className="lp-kicker" style={{ margin: 0 }}>
            Built on
          </span>
          <div className="lp-built-list">
            {BUILT_ON.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section" style={{ paddingTop: 0, paddingBottom: "var(--spacing-32)" }}>
        <div className="lp-note">
          <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={16} strokeWidth={2} aria-hidden style={{ flexShrink: 0, color: "var(--accent)" }} />
            <span>
              <strong>For judges.</strong> No login, no setup — everything below is live devnet
              data or an explicit replay run.
            </span>
          </p>
          <p style={{ marginBottom: 0 }}>
            <Link href="/overview" className="evidence-link">Open the live desk</Link>
            {" · "}
            <Link href="/verify" className="evidence-link">Verify a decision yourself</Link>
            {" · "}
            <Link href="/grade" className="evidence-link">Read the grade sheet</Link>
          </p>
        </div>
      </section>

      <section id="why-tissue" className="lp-section">
        <p className="lp-kicker">Why Tissue</p>
        <h2 className="lp-h2">Signal bots flag. Desks price.</h2>
        <p className="lp-p">
          Almost nobody has an independent read on whether a live move is right, too far, too slow,
          or driven by something they cannot see. Tissue is that read — deterministic, proof-gated,
          and graded in public.
        </p>
        <div className="lp-grid" style={{ marginTop: "var(--spacing-32)" }}>
          {FEATURES.map((f) => (
            <div key={f.title} className="lp-card">
              <div className="lp-dot" aria-hidden>
                <f.icon size={20} strokeWidth={2} />
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* T2 · Product proof — one desktop capture */}
      <div className="lp-band">
        <section id="product" className="lp-section">
          <div className="lp-product-head">
            <div>
              <p className="lp-kicker">The desk in action</p>
              <h2 className="lp-h2">Tissue vs market. Radar. Grade.</h2>
            </div>
            <p className="lp-p" style={{ margin: 0 }}>
              Dual-line fair value against the live market, halt state, and hash preview — the desk
              product, not a mood board.
            </p>
          </div>
          <div className="lp-product-frame">
            <Image
              src="/images/tissue-desktop-overview.jpg"
              alt="Tissue desk overview: Fair Value vs Market chart, halt badge, hash preview"
              fill
              sizes="(max-width: 1023px) 100vw, 1100px"
              className="object-cover object-top"
            />
          </div>
        </section>
      </div>

      {/* T3 · How-it-works strip — human + dual-curve moment */}
      <section id="how-it-works" className="lp-section">
        <div className="lp-how-grid">
          <div>
            <p className="lp-kicker">One loop</p>
            <h2 className="lp-h2">Ingest, price, classify, quote.</h2>
            <p className="lp-p" style={{ marginTop: "var(--spacing-16)" }}>
              Fair value against the market — then decide: quote, or halt when the move has no
              cause you can see.
            </p>
          </div>
          <div className="lp-how-art">
            <Image
              src="/images/tissue-radar-moment.jpg"
              alt="Analyst at a desk watching two price curves on a monitor during a live match"
              fill
              sizes="(max-width: 1023px) 100vw, 720px"
              className="object-cover object-center"
            />
          </div>
        </div>
        <ol className="lp-steps">
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="n">{s.n}</span>
              <span className="t">{s.label}</span>
              <span className="b">{s.body}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="lp-band">
        <section className="lp-section">
          <p className="lp-kicker">Latency Radar</p>
          <h2 className="lp-h2">Every reaction, classified.</h2>
          <p className="lp-p">
            For each match event the Radar measures the gap from the event to the first reaction to
            the point the line stabilizes. Unexplained movement is the one that matters — and it
            halts.
          </p>
          <div className="lp-classes">
            {SIGNAL_CLASSES.map((c) => (
              <span key={c} className="lp-class">
                {c}
              </span>
            ))}
            <span className="lp-class halt">unexplained-movement · halts</span>
          </div>
        </section>
      </div>

      <section className="lp-section">
        <p className="lp-kicker">The backtest that can&apos;t lie</p>
        <h2 className="lp-h2">replay(corpus) === ledger</h2>
        <p className="lp-p">
          Each decision embeds the triggering feed message hash and links to the one before it.
          Odds inputs pass validate_odds; goals and red cards pass validate_stat. Same corpus,
          same ledger, byte for byte — asserted in CI.
        </p>
        <div className="lp-code">
          replay(corpus) === ledger <span className="ok">✓ asserted in CI</span>
        </div>
      </section>

      {/* T4 · Closing CTA */}
      <section className="lp-section" style={{ paddingTop: 0 }}>
        <div className="lp-closing">
          <Image
            src="/images/tissue-closing-desk.jpg"
            alt="Empty trading desk after the session — laptop, notebook, coffee"
            fill
            sizes="(max-width: 767px) 100vw, 1400px"
            className="object-cover object-[72%_center] sm:object-center"
          />
          <div className="lp-closing-scrim lp-closing-scrim-light" aria-hidden />
          <div className="lp-closing-copy">
            <h2 className="lp-h2 lp-display-ink" style={{ maxWidth: "18ch" }}>
              Open the desk. Grade yourself from evidence.
            </h2>
            <div className="lp-cta-row lp-cta-left" style={{ marginTop: "var(--spacing-24)" }}>
              <Link href="/overview" className="lp-btn lp-btn-primary">
                Open the desk
              </Link>
              <Link href="/analyst" className="lp-btn lp-btn-ghost">
                Ask Tissue
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
