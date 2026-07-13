"use client";

import { useState, useTransition } from "react";
import { askAnalyst, type AskResult } from "./actions";

const SUGGESTIONS = [
  "What did the desk do on SYN-QF1?",
  "Show the most recent decisions and why it halted.",
  "How did the late-reaction signal class perform?",
];

export function AnalystPanel() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(q: string) {
    if (!q.trim()) return;
    setQuestion(q);
    startTransition(async () => setResult(await askAnalyst(q)));
  }

  const answer = result && !("error" in result) ? result : null;
  const error = result && "error" in result ? result.error : null;

  return (
    <div className="analyst">
      <p className="muted">
        Ask about the desk&apos;s already-decided, hash-chained ledger. The analyst narrates.
        it reads the record read-only and <strong>never decides or places a trade</strong>.
      </p>

      <div className="controls">
        <input
          type="text"
          value={question}
          placeholder="Ask Tissue…"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask(question)}
          style={{ flex: 1, minWidth: 260 }}
        />
        <button onClick={() => ask(question)} disabled={pending}>
          {pending ? "Reading ledger…" : "Ask"}
        </button>
      </div>

      <div className="controls" style={{ flexWrap: "wrap" }}>
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chip" onClick={() => ask(s)} disabled={pending}>
            {s}
          </button>
        ))}
      </div>

      {error ? <p className="badge badge-sim" style={{ display: "inline-block" }}>{error}</p> : null}

      {answer ? (
        <div className="answer">
          <p style={{ whiteSpace: "pre-wrap" }}>{answer.answer}</p>

          <div className="controls" style={{ flexWrap: "wrap" }}>
            {answer.providers.map((p, i) => (
              <span key={i} className="badge" style={{ borderColor: p.fellBack ? "var(--accent)" : undefined, color: p.fellBack ? "var(--accent)" : undefined }}>
                {p.provider}{p.fellBack ? " (fallback)" : ""}
              </span>
            ))}
          </div>

          {answer.citations.length > 0 ? (
            <div className="citations">
              <span className="muted">grounded in ledger:</span>
              {dedupe(answer.citations).map((c) => (
                <span key={`${c.fixtureId}:${c.seq}`} className="badge" title={c.hash}>
                  {c.fixtureId} seq {c.seq} · {c.hash.slice(0, 8)}…
                </span>
              ))}
            </div>
          ) : (
            <p className="muted">No ledger rows cited.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function dedupe(citations: { seq: number; hash: string; fixtureId: string }[]) {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const k = `${c.fixtureId}:${c.seq}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
