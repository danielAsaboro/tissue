"use client";

import { useEffect } from "react";

export default function DeskError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Tissue desk route failed", error);
  }, [error]);
  return (
    <section className="panel error-state" role="alert">
      <h2>Live desk unavailable</h2>
      <p>The live desk could not be loaded. Retry the connection in a moment.</p>
      <button type="button" onClick={reset}>Retry connection</button>
    </section>
  );
}
