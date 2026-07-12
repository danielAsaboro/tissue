"use client";

import { useState, useTransition } from "react";
import { verifyHashChainAction } from "./actions";

type VerifyResult = { ok: boolean; brokenAtSeq?: number } | null;

export function VerifyHashChainButton() {
  const [result, setResult] = useState<VerifyResult>(null);
  const [pending, startTransition] = useTransition();

  function onVerify() {
    startTransition(async () => {
      setResult(await verifyHashChainAction());
    });
  }

  return (
    <div className="controls">
      <button onClick={onVerify} disabled={pending}>
        {pending ? "Verifying…" : "Verify hash chain"}
      </button>
      {result === null ? null : result.ok ? (
        <span className="badge" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>
          CHAIN OK
        </span>
      ) : (
        <span className="badge badge-sim">
          BROKEN{result.brokenAtSeq !== undefined ? ` @ seq ${result.brokenAtSeq}` : ""}
        </span>
      )}
    </div>
  );
}
